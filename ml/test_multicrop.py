from collections import Counter

from ml.train_multicrop import cap_training_rows, crop_condition_label, slug


def test_labels_keep_crop_and_condition_together():
    assert crop_condition_label("Tomato", "Early Blight") == "tomato___early_blight"
    assert crop_condition_label("Chilli", "Powdery Mildew") == "chilli___powdery_mildew"


def test_crop_names_are_normalized_consistently():
    assert slug("Corn") == "maize"
    assert slug("Corn (maize)") == "maize"
    assert slug("Pepper, bell") == "bell_pepper"


def test_crop_specific_labels_do_not_merge_same_condition_across_crops():
    tomato = crop_condition_label("Tomato", "Healthy")
    potato = crop_condition_label("Potato", "Healthy")
    assert tomato != potato
    assert tomato == "tomato___healthy"
    assert potato == "potato___healthy"


def test_training_cap_limits_each_class_without_dropping_rare_classes():
    rows = [
        {"class_name": "tomato___healthy", "index": i, "source": "x"}
        for i in range(5)
    ] + [
        {"class_name": "chilli___healthy", "index": 10, "source": "y"}
    ]
    result = cap_training_rows(rows, max_per_class=2)
    counts = Counter(row["class_name"] for row in result)
    assert counts == {"tomato___healthy": 2, "chilli___healthy": 1}
