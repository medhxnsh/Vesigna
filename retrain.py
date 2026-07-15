#!/usr/bin/env python3
"""Retrain Vesigna keypoint classifier from collected CSV and export TF.js model."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.model_selection import train_test_split

# Keep fixed output order used by the app runtime.
CLASS_ORDER = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def load_data(csv_path: Path) -> tuple[np.ndarray, np.ndarray]:
    df = pd.read_csv(csv_path)

    expected_cols = ["label"]
    for i in range(21):
        expected_cols.extend([f"x{i}", f"y{i}"])
    if list(df.columns) != expected_cols:
        raise ValueError(
            "Unexpected CSV header. "
            f"Expected first 6 columns like {expected_cols[:6]}, got {list(df.columns)[:6]}"
        )

    labels = df["label"].astype(str).str.strip().str.upper()
    valid = labels.isin(CLASS_ORDER)
    if not valid.all():
        bad = sorted(labels[~valid].unique())
        raise ValueError(f"Found invalid labels in CSV: {bad}")

    x = df.drop(columns=["label"]).to_numpy(dtype=np.float32)
    y_idx = np.array([CLASS_ORDER.index(lbl) for lbl in labels], dtype=np.int32)

    return x, y_idx


def build_model(input_dim: int = 42, num_classes: int = 26) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(input_dim,)),
            tf.keras.layers.BatchNormalization(),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dropout(0.5),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dropout(0.5),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def main() -> None:
    root = Path(__file__).resolve().parent
    csv_path = root / "training_data.csv"
    model_dir = root / "model"
    keras_export_dir = root / "_keras_export_tmp"
    keras_h5_path = root / "_keras_export_tmp.h5"

    if not csv_path.exists():
        raise FileNotFoundError(f"Missing dataset: {csv_path}")

    x, y = load_data(csv_path)

    x_train, x_val, y_train, y_val = train_test_split(
        x, y, test_size=0.2, random_state=42, stratify=y
    )

    model = build_model(input_dim=x.shape[1], num_classes=len(CLASS_ORDER))

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy", mode="max", patience=12, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=5, min_lr=1e-5
        ),
    ]

    history = model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=80,
        batch_size=32,
        callbacks=callbacks,
        verbose=2,
    )

    val_loss, val_acc = model.evaluate(x_val, y_val, verbose=0)
    print(f"Validation accuracy: {val_acc:.4f}")
    print(f"Validation loss: {val_loss:.4f}")

    if keras_export_dir.exists():
        shutil.rmtree(keras_export_dir)
    if keras_h5_path.exists():
        keras_h5_path.unlink()

    # Export to Keras H5 then convert with tensorflowjs converter.
    model.save(str(keras_h5_path), include_optimizer=False)

    model_dir.mkdir(parents=True, exist_ok=True)
    converter_cmd = [
        "tensorflowjs_converter",
        "--input_format",
        "keras",
        "--output_format",
        "tfjs_layers_model",
        str(keras_h5_path),
        str(model_dir),
    ]
    subprocess.run(converter_cmd, check=True)

    classes_path = model_dir / "classes.json"
    classes_path.write_text(json.dumps(CLASS_ORDER, indent=2), encoding="utf-8")

    stats_path = model_dir / "training_stats.json"
    stats = {
        "samples": int(x.shape[0]),
        "features": int(x.shape[1]),
        "classes": CLASS_ORDER,
        "final_val_accuracy": float(val_acc),
        "final_val_loss": float(val_loss),
        "epochs_ran": int(len(history.history.get("loss", []))),
    }
    stats_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")

    print(f"Saved TF.js model to: {model_dir}")
    print(f"Saved class map to: {classes_path}")
    print(f"Saved training stats to: {stats_path}")

    shutil.rmtree(keras_export_dir, ignore_errors=True)
    if keras_h5_path.exists():
        keras_h5_path.unlink()


if __name__ == "__main__":
    # Deterministic enough for repeatable local retraining.
    tf.keras.utils.set_random_seed(42)
    main()
