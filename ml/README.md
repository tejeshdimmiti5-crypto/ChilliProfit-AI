# ChilliProfit AI — ML training

## Dataset

The default training script uses the **raw COLD chilli-leaf dataset** from Hugging Face:

`Project-AgML/COLD_chili_leaf_disease_classification`

The raw subset contains 532 original images in five classes: `cercospora`, `healthy`, `mites_and_trips`, `nutritional`, and `powdery mildew`. The source also provides a much larger augmented subset, but this project starts from original images and performs augmentation only on the training split to reduce validation/test leakage.

## Multi-crop candidate training (experimental)

The separate candidate pipeline combines COLD chilli data with [PlantVillage full](https://huggingface.co/datasets/geraldmc/plantvillage-full), a public dataset listing 54,304 images across 14 crop species and 38 crop/disease classes. Together, these sources should provide up to 15 crop species and 43 crop-specific classes. Rice is not in PlantVillage and is not included in the first candidate.

Run locally from the repository root:

```bash
python -m pytest -q ml/test_multicrop.py
python ml/train_multicrop.py --epochs 4 --batch-size 32 --samples-per-class-per-epoch 80
```

The candidate trainer uses the published PlantVillage train/test metadata split. It separates a validation subset from the published training side using leaf-group IDs where available, then reports held-out metrics and per-class results. The output is isolated at `ml/artifacts/multicrop_model.pt` and `ml/artifacts/multicrop_model.json`; it does not overwrite the deployed chilli checkpoint.

GitHub Actions workflow: `.github/workflows/train-multicrop-candidate.yml`. The workflow saves candidate artifacts for review; it does not publish a production release or deploy to Render.

PlantVillage images have mostly controlled backgrounds and lighting. A good benchmark score does not mean equal accuracy on field photos. The Krishna River Basin dataset remains reserved for later external validation after label mapping and duplicates are checked. Field photos from Andhra Pradesh would be valuable for real-world evaluation.

A second dataset is available from the Krishna River Basin, covering districts including Guntur, Prakasam, Krishna and Kurnool in Andhra Pradesh. It reports 1,856 original images across six classes and is licensed CC BY 4.0. We can add this as the next training source after verifying its downloadable file structure.

## Train locally

```bash
cd ml
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
python train.py
```

For Linux/macOS:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python train.py
```

The best checkpoint is written to:

`ml/artifacts/chilli_model.pt`

Metrics metadata is written beside it as:

`ml/artifacts/chilli_model.json`

## Important

The model is a research prototype, not a clinical/agricultural diagnostic authority. Test performance must be measured on held-out images, and later we should validate with field images collected by the project team before making treatment recommendations.
