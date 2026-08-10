#!/usr/bin/env python3
"""Prepare the developer-owned invoice set for the OCR annotation workflow.

The canonical dataset is written to the repository's gitignored ocr-dataset/
directory. This command normalizes the source images, creates the proposal's
SQLite catalog, and generates assisted PaddleOCR detection/recognition
pre-labels. Pre-labels are staging artifacts only: reviewed=0 and they must be
checked in PPOCRLabel before they can be used as training ground truth.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort

from ocr_benchmark_truth import parse_extracted_data, write_private_truth


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPO_ROOT / "invoices"
DEFAULT_DATASET_ROOT = REPO_ROOT / "ocr-dataset"
MODEL_ROOT = REPO_ROOT / "modules/paddle-ocr/android/src/main/assets/paddle_ocr"
DATASET_VERSION = "dataset-v001"
DETECTION_LONG_EDGE = 960
DETECTION_THRESHOLD = 0.30
BOX_THRESHOLD = 0.60
UNCLIP_RATIO = 1.5
MAX_TEXT_REGIONS = 256
MAX_RECOGNITION_WIDTH = 960


# These source photos contain three receipts that were visibly captured
# sideways/upside-down.  The rotation is applied only to the canonical copy;
# the files in invoices/ remain untouched.
ROTATIONS = {
    "IMG20260809191041": 270,
    "IMG20260809191302": 90,
    "IMG20260809191343": 180,
}


RECEIPTS: dict[str, dict[str, Any]] = {
    "IMG20260809124245": {
        "group_id": "mama_campo_layout",
        "split": "test",
        "group_kind": "layout_family",
        "display_name": "Mama Campo airport receipt",
        "locale_hint": "es-ES",
        "merchant": "Mama Campo",
        "date": "2026-07-22",
        "total_minor": 2090,
        "tax_minor": 190,
        "tax_note": "IVA 10%; printed net total is EUR 19.00 and total is EUR 20.90.",
    },
    "IMG20260809190950": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-03-06",
        "total_minor": 4001,
        "tax_minor": 748,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191020": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-06-21",
        "total_minor": 3000,
        "tax_minor": 561,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191026": {
        "group_id": "local_food_layout",
        "split": "validation",
        "group_kind": "layout_family",
        "display_name": "Local food / Pyat receipt",
        "locale_hint": "hr-HR",
        "merchant": "Local food d.o.o.",
        "date": "2026-07-23",
        "total_minor": 2000,
        "tax_minor": 230,
        "tax_note": "PDV 13%; printed tax base is EUR 17.70.",
    },
    "IMG20260809191041": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-04-07",
        "total_minor": 3610,
        "tax_minor": 675,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191137": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-06-04",
        "total_minor": 3310,
        "tax_minor": 619,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191302": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-07-08",
        "total_minor": 3420,
        "tax_minor": 640,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191315": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-04-03",
        "total_minor": 3012,
        "tax_minor": 563,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191331": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-06-19",
        "total_minor": 3021,
        "tax_minor": 565,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191343": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-05-25",
        "total_minor": 4025,
        "tax_minor": 753,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191358": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-06-26",
        "total_minor": 2140,
        "tax_minor": 400,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191386": {
        "group_id": "konoba_dalmatina_layout",
        "split": "test",
        "group_kind": "layout_family",
        "display_name": "Konoba Dalmatina receipt",
        "locale_hint": "hr-HR",
        "merchant": "KONOBA DALMATINA",
        "date": "2026-07-24",
        "total_minor": 3750,
        "tax_minor": 509,
        "tax_note": "Sum of visibly printed PDV/PNP tax amounts; retain for manual review because the printed bases are mixed.",
    },
    "IMG20260809191413": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-03-17",
        "total_minor": 2905,
        "tax_minor": 543,
        "tax_note": "IVA component; ISP is printed separately.",
    },
    "IMG20260809191424": {
        "group_id": "pingo_doce_fuel_layout",
        "split": "train",
        "group_kind": "merchant",
        "display_name": "Pingo Doce fuel receipts",
        "locale_hint": "pt-PT",
        "merchant": "Pingo Doce",
        "date": "2026-02-26",
        "total_minor": 3000,
        "tax_minor": 561,
        "tax_note": "IVA component; ISP is printed separately.",
    },
}


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS dataset_group (
  group_id TEXT PRIMARY KEY,
  group_kind TEXT NOT NULL CHECK (group_kind IN ('merchant','layout_family','synthetic_family')),
  display_name TEXT,
  split TEXT NOT NULL CHECK (split IN ('train','validation','test')),
  dataset_version TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipt_image (
  receipt_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES dataset_group(group_id),
  relative_image_path TEXT NOT NULL UNIQUE,
  image_sha256 TEXT NOT NULL UNIQUE CHECK (length(image_sha256) = 64),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('synthetic','developer_owned','licensed','consented_redacted')),
  provenance_ref TEXT NOT NULL,
  redaction_status TEXT NOT NULL CHECK (redaction_status IN ('not_required','redacted','verified')),
  locale_hint TEXT,
  capture_condition TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expected_field (
  field_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipt_image(receipt_id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN ('merchant','receipt_date','currency','subtotal_minor','tax_minor','tip_minor','total_minor')),
  field_state TEXT NOT NULL CHECK (field_state IN ('present','absent','ambiguous','illegible','unsupported')),
  normalized_text TEXT,
  normalized_minor INTEGER,
  safe_to_extract INTEGER NOT NULL CHECK (safe_to_extract IN (0,1)),
  annotation_origin TEXT NOT NULL DEFAULT 'manual' CHECK (annotation_origin IN ('manual','ocr_prelabel','assisted')),
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0,1)),
  annotation_notes TEXT,
  UNIQUE (receipt_id, field_name)
);
CREATE TABLE IF NOT EXISTS text_region (
  region_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipt_image(receipt_id) ON DELETE CASCADE,
  annotation_level TEXT NOT NULL CHECK (annotation_level IN ('field_source','full_transcription')),
  transcription TEXT,
  x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
  x3 REAL NOT NULL, y3 REAL NOT NULL, x4 REAL NOT NULL, y4 REAL NOT NULL,
  reading_order INTEGER,
  annotation_origin TEXT NOT NULL DEFAULT 'manual' CHECK (annotation_origin IN ('manual','ocr_prelabel','assisted')),
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0,1))
);
CREATE TABLE IF NOT EXISTS field_region_link (
  field_id TEXT NOT NULL REFERENCES expected_field(field_id) ON DELETE CASCADE,
  region_id TEXT NOT NULL REFERENCES text_region(region_id) ON DELETE CASCADE,
  region_role TEXT NOT NULL CHECK (region_role IN ('label','value','combined','supporting_evidence')),
  PRIMARY KEY (field_id, region_id, region_role)
);
CREATE TABLE IF NOT EXISTS benchmark_case (
  case_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipt_image(receipt_id) ON DELETE CASCADE,
  group_currency TEXT NOT NULL CHECK (group_currency IN ('EUR','USD','GBP')),
  expected_description TEXT,
  expected_amount_minor INTEGER,
  expected_expense_date TEXT,
  expected_detected_currency TEXT CHECK (expected_detected_currency IS NULL OR expected_detected_currency IN ('EUR','USD','GBP')),
  expect_amount_prefill INTEGER NOT NULL CHECK (expect_amount_prefill IN (0,1)),
  expect_date_prefill INTEGER NOT NULL CHECK (expect_date_prefill IN (0,1)),
  expect_description_prefill INTEGER NOT NULL CHECK (expect_description_prefill IN (0,1)),
  expected_warning_code TEXT,
  UNIQUE (receipt_id, group_currency)
);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_sips(source: Path, destination: Path, rotation: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "100", str(source), "--out", str(destination)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if rotation:
        subprocess.run(["sips", "-r", str(rotation), str(destination)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def order_points(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32)
    if points.shape != (4, 2):
        raise ValueError("A text polygon must contain exactly four points")
    x_sorted = points[np.argsort(points[:, 0], kind="stable")]
    left = x_sorted[:2]
    right = x_sorted[2:]
    left = left[np.argsort(left[:, 1], kind="stable")]
    top_left, bottom_left = left
    distances = np.linalg.norm(right - top_left, axis=1)
    bottom_right = right[int(np.argmax(distances))]
    top_right = right[int(np.argmin(distances))]
    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)


def detect(image: np.ndarray, session: ort.InferenceSession) -> list[np.ndarray]:
    original_height, original_width = image.shape[:2]
    long_edge = max(original_width, original_height)
    ratio = DETECTION_LONG_EDGE / long_edge
    width = max(32, round(original_width * ratio / 32.0) * 32)
    height = max(32, round(original_height * ratio / 32.0) * 32)
    resized = cv2.resize(image, (width, height), interpolation=cv2.INTER_LINEAR)
    tensor = resized.astype(np.float32) / 255.0
    means = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    stds = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = ((tensor - means) / stds).transpose(2, 0, 1)[None, ...]
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    probability = np.asarray(output).reshape(height, width)
    binary = (probability > DETECTION_THRESHOLD).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    scale_x = original_width / width
    scale_y = original_height / height
    boxes: list[tuple[float, np.ndarray]] = []
    for contour in contours:
        if cv2.contourArea(contour) < 12.0:
            continue
        mask = np.zeros((height, width), dtype=np.uint8)
        cv2.drawContours(mask, [contour], 0, 255, -1)
        score = float(cv2.mean(probability, mask=mask)[0])
        if score < BOX_THRESHOLD:
            continue
        rectangle = cv2.minAreaRect(contour.astype(np.float32))
        (rw, rh) = rectangle[1]
        if min(rw, rh) < 3.0:
            continue
        perimeter = 2.0 * (rw + rh)
        distance = rw * rh * UNCLIP_RATIO / max(1.0, perimeter)
        expanded = ((rectangle[0]), (rw + 2 * distance, rh + 2 * distance), rectangle[2])
        raw = cv2.boxPoints(expanded)
        scaled = raw * np.array([scale_x, scale_y], dtype=np.float32)
        scaled[:, 0] = np.clip(scaled[:, 0], 0, original_width)
        scaled[:, 1] = np.clip(scaled[:, 1], 0, original_height)
        box = order_points(scaled)
        boxes.append((float(np.mean(box[:, 1])), box))
    boxes.sort(key=lambda item: (item[0], float(np.mean(item[1][:, 0]))))
    return [box for _, box in boxes[:MAX_TEXT_REGIONS]]


def perspective_crop(image: np.ndarray, box: np.ndarray) -> np.ndarray:
    points = order_points(box)
    width = max(np.linalg.norm(points[0] - points[1]), np.linalg.norm(points[2] - points[3]))
    height = max(np.linalg.norm(points[0] - points[3]), np.linalg.norm(points[1] - points[2]))
    width_i = max(1, round(float(width)))
    height_i = max(1, round(float(height)))
    target = np.array([[0, 0], [width_i - 1, 0], [width_i - 1, height_i - 1], [0, height_i - 1]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(points, target)
    return cv2.warpPerspective(image, transform, (width_i, height_i), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def recognize_line(crop: np.ndarray, session: ort.InferenceSession, characters: list[str]) -> tuple[str, float]:
    ratio = crop.shape[1] / max(1, crop.shape[0])
    content_width = max(1, min(MAX_RECOGNITION_WIDTH, math.ceil(48 * ratio)))
    tensor_width = max(320, math.ceil(content_width / 32) * 32)
    resized = cv2.resize(crop, (content_width, 48), interpolation=cv2.INTER_LINEAR)
    padded = np.zeros((48, tensor_width, 3), dtype=np.uint8)
    padded[:, :content_width] = resized
    tensor = padded.astype(np.float32) / 255.0
    tensor = ((tensor - 0.5) / 0.5).transpose(2, 0, 1)[None, ...]
    output = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    timesteps = np.asarray(output)[0]
    text: list[str] = []
    last_index = -1
    scores: list[float] = []
    for timestep in timesteps:
        best_index = int(np.argmax(timestep))
        best_score = float(timestep[best_index])
        if best_index != 0 and best_index != last_index:
            if best_index - 1 < len(characters):
                text.append(characters[best_index - 1])
            elif best_index == len(characters) + 1:
                text.append(" ")
            scores.append(best_score)
        last_index = best_index
    return "".join(text).strip(), (sum(scores) / len(scores) if scores else 0.0)


def field_entries(receipt_id: str, record: dict[str, Any]) -> list[dict[str, Any]]:
    entries = [
        ("merchant", "present", record["merchant"], None, True, "Merchant value selected from the receipt header."),
        ("receipt_date", "present", record["date"], None, True, "ISO-normalized from the printed receipt date."),
        ("currency", "present", "EUR", None, True, "Explicit EUR/EUR symbol evidence is visible on the receipt."),
        ("subtotal_minor", "unsupported", None, None, False, "Not used in the first OCR benchmark; receipt layouts expose mixed gross/net bases."),
        ("tax_minor", "present", None, record["tax_minor"], False, record["tax_note"]),
        ("tip_minor", "absent", None, None, False, "No tip field is present on this receipt."),
        ("total_minor", "present", None, record["total_minor"], True, "Total taken from reviewed extracted-data.txt values."),
    ]
    return [
        {
            "field_id": f"{receipt_id}_{field_name}",
            "receipt_id": receipt_id,
            "field_name": field_name,
            "field_state": state,
            "normalized_text": normalized_text,
            "normalized_minor": normalized_minor,
            "safe_to_extract": int(safe),
            "annotation_origin": "manual",
            "reviewed": 0,
            "annotation_notes": notes,
        }
        for field_name, state, normalized_text, normalized_minor, safe, notes in entries
    ]


def expected_fields_json(receipt_id: str, record: dict[str, Any]) -> dict[str, Any]:
    return {
        "merchant": {"field_state": "present", "normalized_text": record["merchant"], "safe_to_extract": True},
        "receipt_date": {"field_state": "present", "normalized_text": record["date"], "safe_to_extract": True},
        "currency": {"field_state": "present", "normalized_text": "EUR", "safe_to_extract": True},
        "subtotal_minor": {"field_state": "unsupported", "safe_to_extract": False, "annotation_notes": "Mixed gross/net receipt bases; not in first benchmark scope."},
        "tax_minor": {"field_state": "present", "normalized_minor": record["tax_minor"], "safe_to_extract": False, "annotation_notes": record["tax_note"]},
        "tip_minor": {"field_state": "absent", "safe_to_extract": False},
        "total_minor": {"field_state": "present", "normalized_minor": record["total_minor"], "safe_to_extract": True},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--skip-inference", action="store_true")
    args = parser.parse_args()
    output: Path = args.output.expanduser().resolve()
    now = utc_now()
    prelabel_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    prelabel_root = output / "prelabels" / prelabel_id
    canonical_root = output / "images" / "original"
    crop_root = output / "derived" / "recognition-crops"
    export_root = output / "exports" / DATASET_VERSION
    for directory in [canonical_root, crop_root, export_root / "field-ranking", export_root / "paddle-detection", export_root / "paddle-recognition", prelabel_root, output / "manifests", output / "predictions"]:
        directory.mkdir(parents=True, exist_ok=True)

    source_files = {path.stem: path for path in SOURCE_ROOT.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"}}
    if set(source_files) != set(RECEIPTS):
        missing = sorted(set(RECEIPTS) - set(source_files))
        extra = sorted(set(source_files) - set(RECEIPTS))
        raise SystemExit(f"Invoice metadata mismatch. missing={missing} extra={extra}")
    benchmark_truth = parse_extracted_data(SOURCE_ROOT / "extracted-data.txt")
    if set(benchmark_truth) != set(RECEIPTS):
        raise SystemExit("Private benchmark truth and receipt metadata do not contain the same receipt IDs")

    created = now
    db_path = output / "dataset.sqlite"
    existing_receipts: dict[str, dict[str, Any]] = {}
    existing_groups: dict[str, dict[str, Any]] = {}
    existing_fields: dict[str, dict[str, Any]] = {}
    receipts_with_regions: set[str] = set()
    if db_path.is_file():
        with sqlite3.connect(db_path) as existing_connection:
            existing_connection.row_factory = sqlite3.Row
            table_exists = existing_connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='receipt_image'"
            ).fetchone()
            if table_exists:
                existing_receipts = {row["receipt_id"]: dict(row) for row in existing_connection.execute("SELECT * FROM receipt_image")}
                existing_groups = {row["group_id"]: dict(row) for row in existing_connection.execute("SELECT * FROM dataset_group")}
                existing_fields = {row["field_id"]: dict(row) for row in existing_connection.execute("SELECT * FROM expected_field")}
                receipts_with_regions = {row[0] for row in existing_connection.execute("SELECT DISTINCT receipt_id FROM text_region")}
    removed_receipts = set(existing_receipts) - set(RECEIPTS)
    if removed_receipts:
        raise SystemExit("Receipt metadata removed existing canonical records; dataset updates must be append-only")

    previous_manifest_path = output / "manifests" / f"{DATASET_VERSION}.json"
    previous_sources: dict[str, str] = {}
    if previous_manifest_path.is_file():
        previous_manifest = json.loads(previous_manifest_path.read_text(encoding="utf-8"))
        previous_sources = {
            item["receipt_id"]: item["source_sha256"]
            for item in previous_manifest.get("canonical_images", [])
            if item.get("source_sha256")
        }

    canonical: dict[str, dict[str, Any]] = {}
    new_receipts: set[str] = set()
    for receipt_id, record in RECEIPTS.items():
        source_hash = sha256(source_files[receipt_id])
        previous_source_hash = previous_sources.get(receipt_id)
        if previous_source_hash and previous_source_hash != source_hash:
            raise SystemExit(f"Source image changed for immutable receipt {receipt_id}")
        existing = existing_receipts.get(receipt_id)
        if existing:
            if existing["group_id"] != record["group_id"]:
                raise SystemExit(f"Group assignment changed for immutable receipt {receipt_id}")
            destination = output / existing["relative_image_path"]
            if not destination.is_file() or sha256(destination) != existing["image_sha256"]:
                raise SystemExit(f"Canonical image is missing or changed for immutable receipt {receipt_id}")
        else:
            destination = canonical_root / f"{receipt_id}.jpg"
            if destination.exists():
                raise SystemExit(f"Uncatalogued canonical image already exists for {receipt_id}")
            run_sips(source_files[receipt_id], destination, ROTATIONS.get(receipt_id, 0))
            new_receipts.add(receipt_id)
        image = cv2.imread(str(destination), cv2.IMREAD_COLOR)
        if image is None:
            raise SystemExit(f"Could not read canonical image {destination}")
        height, width = image.shape[:2]
        if existing and (width != existing["width_px"] or height != existing["height_px"]):
            raise SystemExit(f"Canonical image dimensions changed for immutable receipt {receipt_id}")
        canonical[receipt_id] = {
            **record,
            "relative_image_path": existing["relative_image_path"] if existing else f"images/original/{receipt_id}.jpg",
            "image_sha256": sha256(destination),
            "width_px": width,
            "height_px": height,
            "source_path": str(source_files[receipt_id]),
            "source_sha256": source_hash,
        }

    with sqlite3.connect(db_path) as connection:
        connection.executescript(SCHEMA)
        connection.execute("PRAGMA foreign_keys = ON")
        for group_id in sorted({record["group_id"] for record in canonical.values()}):
            record = next(item for item in canonical.values() if item["group_id"] == group_id)
            existing_group = existing_groups.get(group_id)
            if existing_group and existing_group["split"] != record["split"]:
                raise SystemExit(f"Split changed for immutable group {group_id}")
            connection.execute(
                "INSERT INTO dataset_group VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(group_id) DO UPDATE SET group_kind=excluded.group_kind, display_name=excluded.display_name, dataset_version=excluded.dataset_version",
                (group_id, record["group_kind"], record["display_name"], record["split"], DATASET_VERSION, created),
            )
        for receipt_id, record in canonical.items():
            receipt_values = (receipt_id, record["group_id"], record["relative_image_path"], record["image_sha256"], "image/jpeg", record["width_px"], record["height_px"], "developer_owned", "private benchmark truth; developer-provided local fixture", "not_required", record["locale_hint"], f"developer capture; canonical rotation={ROTATIONS.get(receipt_id, 0)}", created)
            if receipt_id in existing_receipts:
                connection.execute(
                    "UPDATE receipt_image SET locale_hint=?, capture_condition=? WHERE receipt_id=?",
                    (record["locale_hint"], f"developer capture; canonical rotation={ROTATIONS.get(receipt_id, 0)}", receipt_id),
                )
            else:
                connection.execute("INSERT INTO receipt_image VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", receipt_values)
            for field in field_entries(receipt_id, record):
                existing_field = existing_fields.get(field["field_id"])
                if existing_field and existing_field["reviewed"]:
                    compared_keys = ["field_state", "normalized_text", "normalized_minor", "safe_to_extract"]
                    if any(existing_field[key] != field[key] for key in compared_keys):
                        raise SystemExit(f"Generated truth differs from reviewed field {field['field_id']}")
                connection.execute(
                    """
                    INSERT INTO expected_field VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(field_id) DO UPDATE SET
                      field_state=excluded.field_state,
                      normalized_text=excluded.normalized_text,
                      normalized_minor=excluded.normalized_minor,
                      safe_to_extract=excluded.safe_to_extract,
                      annotation_origin=excluded.annotation_origin,
                      annotation_notes=excluded.annotation_notes
                    WHERE expected_field.reviewed=0
                    """,
                    tuple(field[key] for key in ["field_id", "receipt_id", "field_name", "field_state", "normalized_text", "normalized_minor", "safe_to_extract", "annotation_origin", "reviewed", "annotation_notes"]),
                )
            connection.execute(
                """
                INSERT INTO benchmark_case VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(case_id) DO UPDATE SET
                  expected_description=excluded.expected_description,
                  expected_amount_minor=excluded.expected_amount_minor,
                  expected_expense_date=excluded.expected_expense_date,
                  expected_detected_currency=excluded.expected_detected_currency,
                  expect_amount_prefill=excluded.expect_amount_prefill,
                  expect_date_prefill=excluded.expect_date_prefill,
                  expect_description_prefill=excluded.expect_description_prefill,
                  expected_warning_code=excluded.expected_warning_code
                """,
                (f"{receipt_id}_eur", receipt_id, "EUR", record["merchant"], record["total_minor"], record["date"], "EUR", 1, 1, 1, None),
            )
        connection.commit()
    write_private_truth(output, benchmark_truth)

    detection_lines: list[str] = []
    recognition_lines: list[str] = []
    all_regions: list[dict[str, Any]] = []
    review_queue: list[dict[str, Any]] = []
    prelabel_receipts = new_receipts | (set(canonical) - receipts_with_regions)
    report_status = "pending_manual_review" if prelabel_receipts else "no_new_prelabels"
    report: dict[str, Any] = {"dataset_version": DATASET_VERSION, "prelabel_id": prelabel_id, "receipts": {}, "status": report_status}

    det_session = rec_session = ori_session = None
    characters = (MODEL_ROOT / "characters.txt").read_text(encoding="utf-8").splitlines()
    if prelabel_receipts and not args.skip_inference:
        det_session = ort.InferenceSession(str(MODEL_ROOT / "text_detection.onnx"), providers=["CPUExecutionProvider"])
        rec_session = ort.InferenceSession(str(MODEL_ROOT / "text_recognition.onnx"), providers=["CPUExecutionProvider"])
        ori_session = ort.InferenceSession(str(MODEL_ROOT / "text_orientation.onnx"), providers=["CPUExecutionProvider"])

    for receipt_id in sorted(prelabel_receipts):
        record = canonical[receipt_id]
        image_path = output / record["relative_image_path"]
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        boxes: list[np.ndarray] = []
        recognized: list[dict[str, Any]] = []
        if det_session is not None and rec_session is not None and ori_session is not None:
            boxes = detect(image, det_session)
            for index, box in enumerate(boxes, start=1):
                crop = perspective_crop(image, box)
                orientation_input = cv2.resize(crop, (160, 80), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
                orientation_input = ((orientation_input - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)).transpose(2, 0, 1)[None, ...]
                scores = np.asarray(ori_session.run(None, {ori_session.get_inputs()[0].name: orientation_input})[0])[0]
                if len(scores) >= 2 and scores[1] > scores[0] and scores[1] >= 0.80:
                    crop = cv2.rotate(crop, cv2.ROTATE_180)
                text, confidence = recognize_line(crop, rec_session, characters)
                crop_path = crop_root / f"{receipt_id}_region_{index:03d}.png"
                cv2.imwrite(str(crop_path), crop)
                points = [[round(float(x), 2), round(float(y), 2)] for x, y in order_points(box)]
                region_id = f"{receipt_id}_region_{index:03d}"
                recognized.append({"region_id": region_id, "points": points, "text": text, "confidence": round(confidence, 6), "crop": str(crop_path.relative_to(output))})
                all_regions.append({"receipt_id": receipt_id, "region_id": region_id, "points": points, "text": text, "reading_order": index})
                recognition_lines.append(f"{str(crop_path.relative_to(output))}\t{text}")
        label_payload = [{"transcription": item["text"] or "###", "points": item["points"]} for item in recognized]
        detection_lines.append(f"{record['relative_image_path']}\t{json.dumps(label_payload, ensure_ascii=False, separators=(',', ':'))}")
        review_queue.append({"receipt_id": receipt_id, "split": record["split"], "status": "pending_manual_review", "required_review": ["inspect every polygon", "correct every transcription", "confirm all seven expected fields", "confirm source ownership/redaction status"]})
        report["receipts"][receipt_id] = {"split": record["split"], "detected_regions": len(recognized), "low_confidence_regions": sum(item["confidence"] < 0.85 for item in recognized), "status": "pending_manual_review"}

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        for region in all_regions:
            connection.execute(
                "INSERT INTO text_region VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    region["region_id"],
                    region["receipt_id"],
                    "full_transcription",
                    region["text"] or "###",
                    region["points"][0][0], region["points"][0][1],
                    region["points"][1][0], region["points"][1][1],
                    region["points"][2][0], region["points"][2][1],
                    region["points"][3][0], region["points"][3][1],
                    region["reading_order"],
                    "ocr_prelabel",
                    0,
                ),
            )
        connection.commit()

    (prelabel_root / "Label.txt").write_text("\n".join(detection_lines) + "\n", encoding="utf-8")
    (prelabel_root / "rec_gt.txt").write_text("\n".join(recognition_lines) + ("\n" if recognition_lines else ""), encoding="utf-8")
    (prelabel_root / "ExpectedFields.auto.json").write_text(json.dumps({rid: expected_fields_json(rid, canonical[rid]) for rid in sorted(prelabel_receipts)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (prelabel_root / "ReviewQueue.json").write_text(json.dumps(review_queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (prelabel_root / "run-manifest.json").write_text(json.dumps({"dataset_version": DATASET_VERSION, "prelabel_id": prelabel_id, "created_at_utc": now, "source_commit": "working-tree", "model_bundle_version": json.loads((MODEL_ROOT / "model-bundle.json").read_text(encoding="utf-8"))["bundleVersion"], "inference_runtime": "onnxruntime 1.19.2 CPU on macOS; Android runtime remains 1.26.0", "thresholds": {"detection": DETECTION_THRESHOLD, "box": BOX_THRESHOLD}, "rotations": ROTATIONS, "reviewed": False}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (prelabel_root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with sqlite3.connect(db_path) as connection:
        unreviewed_fields = connection.execute("SELECT count(*) FROM expected_field WHERE reviewed=0").fetchone()[0]
        unreviewed_regions = connection.execute("SELECT count(*) FROM text_region WHERE reviewed=0").fetchone()[0]
    training_eligibility = (
        "eligible for split/profile readiness validation"
        if unreviewed_fields == 0 and unreviewed_regions == 0
        else f"blocked: {unreviewed_fields} expected fields and {unreviewed_regions} text regions remain unreviewed"
    )
    manifest = {"dataset_version": DATASET_VERSION, "created_at_utc": now, "source_boundary": "private gitignored dataset root; external private root preferred", "source_kind": "developer_owned", "receipt_count": len(canonical), "splits": {split: sum(record["split"] == split for record in canonical.values()) for split in ["train", "validation", "test"]}, "group_splits": {record["group_id"]: record["split"] for record in canonical.values()}, "canonical_images": [{"receipt_id": rid, "path": record["relative_image_path"], "sha256": record["image_sha256"], "source_sha256": record["source_sha256"], "width_px": record["width_px"], "height_px": record["height_px"], "rotation_applied": ROTATIONS.get(rid, 0), "ocr_profile": benchmark_truth[rid]["profile"]} for rid, record in canonical.items()], "prelabel_dir": str(prelabel_root.relative_to(output)), "new_receipt_count": len(new_receipts), "prelabel_receipt_count": len(prelabel_receipts), "training_eligibility": training_eligibility}
    (output / "manifests" / f"{DATASET_VERSION}.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    checksums = []
    for path in sorted(canonical_root.glob("*.jpg")):
        checksums.append(f"{sha256(path)}  {path.relative_to(output)}")
    (output / "manifests" / f"checksums-{DATASET_VERSION}.sha256").write_text("\n".join(checksums) + "\n", encoding="utf-8")
    (output / "README.md").write_text("# BranchBalance OCR dataset\n\nPrivate developer-owned staging dataset generated from the local invoice fixtures. This directory is gitignored and must not be shipped in application assets. The prelabels are assisted proposals only. Open the prelabel `Label.txt` in PPOCRLabel, review every polygon and transcription, complete field links, and only then export reviewed PaddleOCR training inputs.\n", encoding="utf-8")

    print(json.dumps({"dataset_root": str(output), "database": str(db_path), "prelabels": str(prelabel_root), "receipts": len(canonical), "prelabel_regions": len(all_regions), "status": report["status"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
