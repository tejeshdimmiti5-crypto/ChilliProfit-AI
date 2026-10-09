"""Train a multi-crop disease screening classifier from COLD and PlantVillage.

PlantVillage is used for 14 crop species; the COLD raw subset adds chilli.
Class names are crop-specific (for example, tomato___early_blight) so disease
labels from different plants are never silently merged.
"""
import argparse
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from datasets import load_dataset
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import models, transforms
from tqdm import tqdm

SEED = 42
COLD_REPO = "Project-AgML/COLD_chili_leaf_disease_classification"
PLANTVILLAGE_REPO = "geraldmc/plantvillage-full"
PLANTVILLAGE_REVISION = "v0.1.0"
IMAGE_SIZE = 224

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)


def slug(value):
    """Convert source labels to stable, readable model-class tokens."""
    value = str(value).strip().lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_")
    aliases = {
        "pepper_bell": "bell_pepper",
        "corn": "maize",
        "corn_maize": "maize",
    }
    return aliases.get(value, value)


def crop_condition_label(crop, condition):
    return f"{slug(crop)}___{slug(condition)}"


class MultiCropLeafDataset(Dataset):
    def __init__(self, rows, sources, class_to_idx, transform):
        self.rows = rows
        self.sources = sources
        self.class_to_idx = class_to_idx
        self.transform = transform

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        row = self.rows[index]
        raw = self.sources[row["source"]][row["index"]]["image"]
        if isinstance(raw, Image.Image):
            image = raw
        else:
            image = Image.open(raw)
        image = image.convert("RGB")
        return self.transform(image), self.class_to_idx[row["class_name"]]


def build_splits():
    """Build reproducible, source-aware train/validation/test records."""
    cold = load_dataset(COLD_REPO, "raw", split="train")
    plantvillage = load_dataset(
        PLANTVILLAGE_REPO,
        revision=PLANTVILLAGE_REVISION,
        split="train",
    )
    sources = {"cold": cold, "plantvillage": plantvillage}

    cold_labels = np.asarray(cold["label"])
    cold_class_names = cold.features["label"].names
    cold_train, cold_temp = train_test_split(
        np.arange(len(cold)),
        test_size=0.30,
        random_state=SEED,
        stratify=cold_labels,
    )
    cold_val, cold_test = train_test_split(
        cold_temp,
        test_size=0.50,
        random_state=SEED,
        stratify=cold_labels[cold_temp],
    )

    def cold_rows(indices):
        return [
            {
                "source": "cold",
                "index": int(i),
                "class_name": crop_condition_label("chilli", cold_class_names[int(cold_labels[i])]),
                "group": f"cold-{int(i)}",
            }
            for i in indices
        ]

    pv_hosts = plantvillage["host"]
    pv_diseases = plantvillage["disease"]
    pv_splits = plantvillage["split"]
    pv_groups = plantvillage["leaf_id"]
    pv_classes = plantvillage["class_label"]

    pv_train_all = [i for i, split in enumerate(pv_splits) if str(split).lower() == "train"]
    pv_test_idx = [i for i, split in enumerate(pv_splits) if str(split).lower() == "test"]
    if not pv_train_all or not pv_test_idx:
        raise RuntimeError("PlantVillage data must provide its published train and test metadata splits.")

    group_names = [
        str(pv_groups[i]) if pv_groups[i] not in (None, "") else f"{pv_classes[i]}-row-{i}"
        for i in pv_train_all
    ]
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED)
    pv_train_pos, pv_val_pos = next(
        splitter.split(np.asarray(pv_train_all), groups=np.asarray(group_names))
    )
    pv_train_idx = [pv_train_all[int(pos)] for pos in pv_train_pos]
    pv_val_idx = [pv_train_all[int(pos)] for pos in pv_val_pos]

    def plantvillage_rows(indices):
        rows = []
        for i in indices:
            rows.append({
                "source": "plantvillage",
                "index": int(i),
                "class_name": crop_condition_label(pv_hosts[i], pv_diseases[i]),
                "group": str(pv_groups[i]) if pv_groups[i] not in (None, "") else f"{pv_classes[i]}-row-{i}",
            })
        return rows

    train_rows = cold_rows(cold_train) + plantvillage_rows(pv_train_idx)
    val_rows = cold_rows(cold_val) + plantvillage_rows(pv_val_idx)
    test_rows = cold_rows(cold_test) + plantvillage_rows(pv_test_idx)
    return sources, train_rows, val_rows, test_rows


def cap_training_rows(rows, max_per_class):
    """Limit dominant PlantVillage classes while keeping every class represented."""
    by_class = defaultdict(list)
    for row in rows:
        by_class[row["class_name"]].append(row)
    rng = random.Random(SEED)
    capped = []
    for class_name in sorted(by_class):
        candidates = list(by_class[class_name])
        rng.shuffle(candidates)
        capped.extend(candidates[:max_per_class])
    rng.shuffle(capped)
    return capped


def evaluate(model, loader, device):
    model.eval()
    true, pred = [], []
    with torch.inference_mode():
        for images, labels in loader:
            logits = model(images.to(device))
            pred.extend(logits.argmax(1).cpu().numpy().tolist())
            true.extend(labels.numpy().tolist())
    return np.asarray(true), np.asarray(pred)


def main():
    parser = argparse.ArgumentParser(description="Train a crop-aware plant disease classifier.")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--max-train-per-class", type=int, default=1600)
    parser.add_argument("--samples-per-class-per-epoch", type=int, default=80)
    parser.add_argument("--output", default="ml/artifacts/multicrop_model.pt")
    args = parser.parse_args()

    if args.epochs < 1 or args.batch_size < 1 or args.max_train_per_class < 1 or args.samples_per_class_per_epoch < 1:
        raise SystemExit("epochs, batch size and class sampling limits must all be positive.")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    print(f"Seed: {SEED}")
    print(f"Loading COLD chilli data and PlantVillage revision {PLANTVILLAGE_REVISION}…")
    sources, train_rows, val_rows, test_rows = build_splits()
    raw_train_count = len(train_rows)
    train_rows = cap_training_rows(train_rows, args.max_train_per_class)

    class_names = sorted({
        row["class_name"]
        for split_rows in (train_rows, val_rows, test_rows)
        for row in split_rows
    })
    class_to_idx = {name: index for index, name in enumerate(class_names)}
    train_labels = [class_to_idx[row["class_name"]] for row in train_rows]
    counts = Counter(train_labels)
    if len(counts) != len(class_names):
        missing = sorted(set(class_names) - {name for name in class_names if counts.get(class_to_idx[name], 0)})
        raise RuntimeError(f"Training data has no examples for classes: {missing}")

    train_tfms = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(12),
        transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.10),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    eval_tfms = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    train_ds = MultiCropLeafDataset(train_rows, sources, class_to_idx, train_tfms)
    val_ds = MultiCropLeafDataset(val_rows, sources, class_to_idx, eval_tfms)
    test_ds = MultiCropLeafDataset(test_rows, sources, class_to_idx, eval_tfms)

    sample_weights = torch.DoubleTensor([1.0 / counts[label] for label in train_labels])
    samples_per_epoch = min(len(train_rows) * 2, len(class_names) * args.samples_per_class_per_epoch)
    sampler = WeightedRandomSampler(sample_weights, num_samples=samples_per_epoch, replacement=True)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size, shuffle=False, num_workers=0)

    print(f"Training sources: {len(sources)}")
    print(f"Crop species: {len({name.split('___', 1)[0] for name in class_names})}")
    print(f"Classes: {len(class_names)}")
    print(f"Training rows after class cap: {len(train_rows)} (before cap: {raw_train_count})")
    print(f"Validation rows: {len(val_rows)}; held-out test rows: {len(test_rows)}")
    print("Training rows per class:", dict(sorted(Counter(row["class_name"] for row in train_rows).items())))

    model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.DEFAULT)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, len(class_names))
    model.to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=1)

    best_f1 = -1.0
    best_epoch = 0
    stale_epochs = 0
    history = []
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(args.epochs):
        model.train()
        running_loss = 0.0
        seen = 0
        for images, labels in tqdm(train_loader, desc=f"Epoch {epoch + 1}/{args.epochs}"):
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()
            running_loss += loss.item() * images.size(0)
            seen += images.size(0)

        val_true, val_pred = evaluate(model, val_loader, device)
        val_accuracy = accuracy_score(val_true, val_pred)
        val_f1 = f1_score(val_true, val_pred, labels=np.arange(len(class_names)), average="macro", zero_division=0)
        train_loss = running_loss / max(seen, 1)
        scheduler.step(val_f1)
        record = {
            "epoch": epoch + 1,
            "train_loss": train_loss,
            "val_accuracy": float(val_accuracy),
            "val_macro_f1": float(val_f1),
            "learning_rate": float(optimizer.param_groups[0]["lr"]),
        }
        history.append(record)
        print(f"loss={train_loss:.4f} val_acc={val_accuracy:.4f} val_macro_f1={val_f1:.4f}")

        if val_f1 > best_f1:
            best_f1 = float(val_f1)
            best_epoch = epoch + 1
            stale_epochs = 0
            torch.save({
                "model_state_dict": model.state_dict(),
                "class_names": class_names,
                "crop_names": sorted({name.split("___", 1)[0] for name in class_names}),
                "image_size": IMAGE_SIZE,
                "seed": SEED,
                "datasets": [COLD_REPO, f"{PLANTVILLAGE_REPO}@{PLANTVILLAGE_REVISION}"],
                "best_validation_macro_f1": best_f1,
                "best_epoch": best_epoch,
            }, output)
        else:
            stale_epochs += 1
            if stale_epochs >= args.patience:
                print(f"Early stopping after epoch {epoch + 1}.")
                break

    checkpoint = torch.load(output, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    test_true, test_pred = evaluate(model, test_loader, device)
    test_accuracy = accuracy_score(test_true, test_pred)
    test_f1 = f1_score(test_true, test_pred, labels=np.arange(len(class_names)), average="macro", zero_division=0)
    report = classification_report(
        test_true,
        test_pred,
        labels=np.arange(len(class_names)),
        target_names=class_names,
        zero_division=0,
        output_dict=True,
    )
    per_class = {
        name: {
            "precision": float(report[name]["precision"]),
            "recall": float(report[name]["recall"]),
            "f1": float(report[name]["f1-score"]),
            "support": int(report[name]["support"]),
        }
        for name in class_names
    }
    metrics = {
        "training_pipeline": "multi_crop_v1",
        "datasets": [
            {"name": "COLD chilli-leaf dataset", "repo": COLD_REPO, "config": "raw", "license": "CC BY 4.0"},
            {"name": "PlantVillage full", "repo": PLANTVILLAGE_REPO, "revision": PLANTVILLAGE_REVISION, "license": "CC0 1.0"},
        ],
        "classes": class_names,
        "crops": sorted({name.split("___", 1)[0] for name in class_names}),
        "crop_count": len({name.split("___", 1)[0] for name in class_names}),
        "class_count": len(class_names),
        "seed": SEED,
        "device": device,
        "training_rows_before_cap": raw_train_count,
        "training_rows_after_cap": len(train_rows),
        "validation_rows": len(val_rows),
        "test_rows": len(test_rows),
        "samples_per_class_per_epoch": args.samples_per_class_per_epoch,
        "best_epoch": best_epoch,
        "best_validation_macro_f1": best_f1,
        "test_accuracy": float(test_accuracy),
        "test_macro_f1": float(test_f1),
        "per_class": per_class,
        "confusion_matrix": confusion_matrix(test_true, test_pred, labels=np.arange(len(class_names))).tolist(),
        "history": history,
    }
    output.with_suffix(".json").write_text(json.dumps(metrics, indent=2))
    print(f"TEST accuracy={test_accuracy:.4f}")
    print(f"TEST macro_f1={test_f1:.4f}")
    print(f"Crop count={metrics['crop_count']} | class count={metrics['class_count']}")
    print(f"Saved metrics: {output.with_suffix('.json')}")


if __name__ == "__main__":
    main()
