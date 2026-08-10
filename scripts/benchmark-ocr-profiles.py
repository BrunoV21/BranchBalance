#!/usr/bin/env python3
"""Tune and benchmark generic/fuel OCR profiles on the private local dataset.

This is an exploratory inference benchmark. It reuses the approved PP-OCRv5
ONNX artifacts and selects profile-specific preprocessing/detection parameters.
It does not fine-tune model weights from unreviewed prelabels.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sqlite3
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort

from ocr_benchmark_truth import load_private_truth


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET_ROOT = REPO_ROOT / "ocr-dataset"
MODEL_ROOT = REPO_ROOT / "modules/paddle-ocr/android/src/main/assets/paddle_ocr"
PREPARE_SCRIPT = REPO_ROOT / "scripts/prepare-ocr-dataset.py"
PROFILE_CONFIG_ROOT = REPO_ROOT / "config/ocr/profiles"
PREPARED_LONG_EDGE = 1800
PREPARED_JPEG_QUALITY = 90


def load_prepare_module():
    spec = importlib.util.spec_from_file_location("branchbalance_prepare_ocr", PREPARE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load OCR preparation helpers")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_profile_candidates(config_root: Path) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for profile in ["generic", "fuel"]:
        path = config_root / f"{profile}.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("profile") != profile or not payload.get("benchmark_candidates"):
            raise RuntimeError(f"Invalid OCR profile configuration: {path}")
        result[profile] = payload["benchmark_candidates"]
    return result


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(character for character in decomposed if not unicodedata.combining(character) and character.isalnum()).upper()


def parse_dates(texts: list[str]) -> set[str]:
    dates: set[str] = set()
    month_names = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6, "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}
    for text in texts:
        for match in re.finditer(r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b", text):
            dates.add(f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}")
        for match in re.finditer(r"\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b", text):
            year = int(match.group(3)) + (2000 if len(match.group(3)) == 2 else 0)
            dates.add(f"{year:04d}-{int(match.group(2)):02d}-{int(match.group(1)):02d}")
        for match in re.finditer(r"\b(0?[1-9]|[12]\d|3[01])\s+([A-Za-z]{3})[' ]?(\d{2}|20\d{2})\b", text):
            month = month_names.get(match.group(2).upper())
            if month:
                year = int(match.group(3)) + (2000 if len(match.group(3)) == 2 else 0)
                dates.add(f"{year:04d}-{month:02d}-{int(match.group(1)):02d}")
    return dates


def decimal_tokens(texts: list[str]) -> set[str]:
    values: set[str] = set()
    for text in texts:
        for match in re.finditer(r"(?<!\d)(\d+(?:[.,]\d{2,3}))(?!\d)", text):
            raw = match.group(1).replace(",", ".")
            whole, fraction = raw.split(".")
            values.add(f"{int(whole)}.{fraction}")
    return values


def prepare_images(dataset: Path, receipt_ids: list[str]) -> Path:
    prepared_root = dataset / "derived" / "prepared-images"
    prepared_root.mkdir(parents=True, exist_ok=True)
    for receipt_id in receipt_ids:
        source = cv2.imread(str(dataset / "images/original" / f"{receipt_id}.jpg"), cv2.IMREAD_COLOR)
        if source is None:
            raise RuntimeError(f"Could not read canonical image for {receipt_id}")
        height, width = source.shape[:2]
        long_edge = max(width, height)
        if long_edge > PREPARED_LONG_EDGE:
            scale = PREPARED_LONG_EDGE / long_edge
            source = cv2.resize(source, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
        destination = prepared_root / f"{receipt_id}.jpg"
        if not cv2.imwrite(str(destination), source, [cv2.IMWRITE_JPEG_QUALITY, PREPARED_JPEG_QUALITY]):
            raise RuntimeError(f"Could not write prepared image for {receipt_id}")
    return prepared_root


def recognize_image(image_path: Path, helper, sessions: dict[str, ort.InferenceSession], characters: list[str], config: dict[str, Any]) -> dict[str, Any]:
    helper.DETECTION_LONG_EDGE = config["long_edge"]
    helper.DETECTION_THRESHOLD = config["detection_threshold"]
    helper.BOX_THRESHOLD = config["box_threshold"]
    helper.UNCLIP_RATIO = config["unclip_ratio"]
    helper.MAX_TEXT_REGIONS = config["max_regions"]
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not read {image_path}")
    started = time.perf_counter()
    boxes = helper.detect(image, sessions["detection"])
    blocks = []
    for box in boxes:
        crop = helper.perspective_crop(image, box)
        orientation_input = cv2.resize(crop, (160, 80), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
        orientation_input = ((orientation_input - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)).transpose(2, 0, 1)[None, ...]
        orientation_scores = np.asarray(sessions["orientation"].run(None, {sessions["orientation"].get_inputs()[0].name: orientation_input})[0])[0]
        if len(orientation_scores) >= 2 and orientation_scores[1] > orientation_scores[0] and orientation_scores[1] >= 0.80:
            crop = cv2.rotate(crop, cv2.ROTATE_180)
        text, confidence = helper.recognize_line(crop, sessions["recognition"], characters)
        if text:
            points = [[round(float(x), 2), round(float(y), 2)] for x, y in helper.order_points(box)]
            blocks.append({"text": text, "confidence": round(confidence, 6), "points": points})
    return {"width": image.shape[1], "height": image.shape[0], "blocks": blocks, "latency_ms": round((time.perf_counter() - started) * 1000, 2)}


def evaluate_receipt(ocr: dict[str, Any], expected: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
    texts = [block["text"] for block in ocr["blocks"]]
    joined = normalized_text(" ".join(texts))
    tokens = decimal_tokens(texts)
    merchant = normalized_text(fields["merchant"])
    core = {
        "merchant_text_hit": merchant in joined,
        "date_hit": fields["date"] in parse_dates(texts),
        "currency_hit": any(re.search(r"(?:€|\bEUR\b)", text, re.IGNORECASE) for text in texts),
        "total_hit": expected["total"] in tokens,
    }
    task: dict[str, bool] = {}
    if expected["profile"] == "generic":
        for index, item in enumerate(expected["line_items"], start=1):
            task[f"item_{index}_name_hit"] = normalized_text(item["name"]) in joined
            task[f"item_{index}_price_hit"] = item["line_total"] in tokens
    else:
        for field in ["paid", "discount", "price_per_liter", "liters"]:
            if field == "discount" and expected[field] == "0.00":
                task["discount_absent_hit"] = not any(token in joined for token in ["POUPA", "DESCONTO", "DISCOUNT"])
            else:
                task[f"{field}_hit"] = expected[field] in tokens
    confidences = [block["confidence"] for block in ocr["blocks"]]
    return {
        "core": core,
        "task": task,
        "recognized_regions": len(ocr["blocks"]),
        "mean_confidence": round(sum(confidences) / len(confidences), 6) if confidences else 0.0,
        "latency_ms": ocr["latency_ms"],
        "decimal_tokens": sorted(tokens),
        "parsed_dates": sorted(parse_dates(texts)),
    }


def summarize(results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not results:
        return {
            "receipt_count": 0,
            "core_hits": 0,
            "core_total": 0,
            "core_recall": 0.0,
            "task_hits": 0,
            "task_total": 0,
            "task_recall": 0.0,
            "mean_regions": 0.0,
            "mean_latency_ms": 0.0,
        }
    core_values = [value for receipt in results.values() for value in receipt["metrics"]["core"].values()]
    task_values = [value for receipt in results.values() for value in receipt["metrics"]["task"].values()]
    return {
        "receipt_count": len(results),
        "core_hits": sum(core_values),
        "core_total": len(core_values),
        "core_recall": round(sum(core_values) / len(core_values), 4) if core_values else 0.0,
        "task_hits": sum(task_values),
        "task_total": len(task_values),
        "task_recall": round(sum(task_values) / len(task_values), 4) if task_values else 0.0,
        "mean_regions": round(sum(item["metrics"]["recognized_regions"] for item in results.values()) / len(results), 2),
        "mean_latency_ms": round(sum(item["metrics"]["latency_ms"] for item in results.values()) / len(results), 2),
    }


def selection_key(candidate: dict[str, Any]) -> tuple[float, float, float, float]:
    summary = candidate["summary"]
    return (summary["core_recall"], summary["task_recall"], -summary["mean_regions"], -summary["mean_latency_ms"])


def model_sessions(model_root: Path) -> tuple[dict[str, Any], list[str], dict[str, ort.InferenceSession]]:
    manifest_path = model_root / "model-bundle.json"
    if not manifest_path.is_file():
        raise RuntimeError(f"Missing model manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dictionary_path = model_root / manifest["dictionary"]["file"]
    characters = dictionary_path.read_text(encoding="utf-8").splitlines()
    sessions = {
        role: ort.InferenceSession(
            str(model_root / manifest["models"][role]["file"]),
            providers=["CPUExecutionProvider"],
        )
        for role in ["detection", "recognition", "orientation"]
    }
    return manifest, characters, sessions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--generic-model-root", type=Path, default=MODEL_ROOT)
    parser.add_argument("--fuel-model-root", type=Path, default=MODEL_ROOT)
    parser.add_argument("--profiles-config-root", type=Path, default=PROFILE_CONFIG_ROOT)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    dataset = args.dataset.resolve()
    model_roots = {
        "generic": args.generic_model_root.expanduser().resolve(),
        "fuel": args.fuel_model_root.expanduser().resolve(),
    }
    profile_candidates = load_profile_candidates(args.profiles_config_root.expanduser().resolve())
    expected = load_private_truth(dataset)
    prepared_root = prepare_images(dataset, list(expected))
    helper = load_prepare_module()
    with sqlite3.connect(dataset / "dataset.sqlite") as connection:
        expected_fields = {
            receipt_id: {
                "merchant": connection.execute("SELECT normalized_text FROM expected_field WHERE receipt_id=? AND field_name='merchant'", (receipt_id,)).fetchone()[0],
                "date": connection.execute("SELECT normalized_text FROM expected_field WHERE receipt_id=? AND field_name='receipt_date'", (receipt_id,)).fetchone()[0],
            }
            for receipt_id in expected
        }
        receipt_splits = {
            row[0]: row[1]
            for row in connection.execute(
                "SELECT ri.receipt_id, dg.split FROM receipt_image ri JOIN dataset_group dg USING(group_id)"
            )
        }
        unreviewed_regions = connection.execute("SELECT count(*) FROM text_region WHERE reviewed=0").fetchone()[0]
        reviewed_regions = connection.execute("SELECT count(*) FROM text_region WHERE reviewed=1").fetchone()[0]

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_root = dataset / "benchmarks" / run_id
    profiles_root = dataset / "model-profiles"
    run_root.mkdir(parents=True, exist_ok=True)
    benchmark: dict[str, Any] = {"run_id": run_id, "created_at_utc": utc_now(), "dataset_version": "dataset-v001", "reviewed_regions": reviewed_regions, "unreviewed_regions": unreviewed_regions, "evaluation_kind": "exploratory in-sample profile benchmark", "runtime": {"python": sys.version.split()[0], "onnxruntime": ort.__version__, "opencv": cv2.__version__, "numpy": np.__version__, "provider": "CPUExecutionProvider"}, "prepared_images": {"long_edge": PREPARED_LONG_EDGE, "jpeg_quality": PREPARED_JPEG_QUALITY, "path": "derived/prepared-images"}, "profiles": {}}

    for profile, candidates in profile_candidates.items():
        model_root = model_roots[profile]
        base_manifest, characters, sessions = model_sessions(model_root)
        receipt_ids = [receipt_id for receipt_id, item in expected.items() if item["profile"] == profile]
        evaluated_candidates = []
        for config in candidates:
            if not args.quiet:
                print(f"Running {profile}/{config['name']} on {len(receipt_ids)} receipts...", flush=True)
            config_results: dict[str, Any] = {}
            prediction_root = run_root / "predictions" / profile / config["name"]
            prediction_root.mkdir(parents=True, exist_ok=True)
            for receipt_id in receipt_ids:
                ocr = recognize_image(prepared_root / f"{receipt_id}.jpg", helper, sessions, characters, config)
                metrics = evaluate_receipt(ocr, expected[receipt_id], expected_fields[receipt_id])
                config_results[receipt_id] = {"metrics": metrics}
                (prediction_root / f"{receipt_id}.json").write_text(json.dumps({"receipt_id": receipt_id, "profile": profile, "config": config, "ocr": ocr, "expected": expected[receipt_id], "metrics": metrics}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            candidate = {"config": config, "summary": summarize(config_results), "receipts": config_results}
            evaluated_candidates.append(candidate)
            if not args.quiet:
                print(f"  core={candidate['summary']['core_recall']:.4f} task={candidate['summary']['task_recall']:.4f} regions={candidate['summary']['mean_regions']:.2f} latency={candidate['summary']['mean_latency_ms']:.2f}ms", flush=True)
        selected = max(evaluated_candidates, key=selection_key)
        selected_split_summaries = {
            split: summarize(
                {
                    receipt_id: result
                    for receipt_id, result in selected["receipts"].items()
                    if receipt_splits.get(receipt_id) == split
                }
            )
            for split in ["train", "validation", "test"]
        }
        selected_heldout_summary = summarize(
            {
                receipt_id: result
                for receipt_id, result in selected["receipts"].items()
                if receipt_splits.get(receipt_id) in {"validation", "test"}
            }
        )
        benchmark["profiles"][profile] = {
            "receipt_ids": receipt_ids,
            "candidates": evaluated_candidates,
            "selected_config": selected["config"],
            "selected_summary": selected["summary"],
            "selected_split_summaries": selected_split_summaries,
            "selected_heldout_summary": selected_heldout_summary,
            "model_bundle_version": base_manifest["bundleVersion"],
            "model_artifacts": {
                role: {"file": item["file"], "sha256": sha256(model_root / item["file"])}
                for role, item in base_manifest["models"].items()
            },
        }

        profile_root = profiles_root / profile
        profile_root.mkdir(parents=True, exist_ok=True)
        model_location = "modules/paddle-ocr/android/src/main/assets/paddle_ocr" if model_root == MODEL_ROOT.resolve() else "private candidate model root"
        manifest = {
            "profile_version": f"{profile}-experimental-v001",
            "profile_kind": profile,
            "status": "experimental_inference_profile",
            "weights": {"kind": "benchmark model bundle", "bundle_version": base_manifest["bundleVersion"], "location": model_location, "artifacts": {name: {"file": data["file"], "sha256": sha256(model_root / data["file"])} for name, data in base_manifest["models"].items()}, "dictionary": {**base_manifest["dictionary"], "sha256": sha256(model_root / base_manifest["dictionary"]["file"])}},
            "inference": {**selected["config"], "prepared_image_long_edge": PREPARED_LONG_EDGE, "prepared_jpeg_quality": PREPARED_JPEG_QUALITY},
            "deployment": {"android_integrated": False, "required_change": "Load this profile's detector limits and thresholds in PaddleOcrEngine before device testing.", "weights_contract_changed": False},
            "dataset": {"version": "dataset-v001", "receipt_ids": receipt_ids, "benchmark_run": f"benchmarks/{run_id}/benchmark.json"},
            "training": {"enabled": False, "blocked_by": [f"{unreviewed_regions} text regions remain unreviewed", "no reviewed full-transcription export", "generic receipts have no training split" if profile == "generic" else "fuel receipts have no held-out merchant/layout group"], "future_detection_export": f"exports/dataset-v001/{profile}/paddle-detection", "future_recognition_export": f"exports/dataset-v001/{profile}/paddle-recognition"},
            "selected_metrics": selected["summary"],
        }
        (profile_root / "profile.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (profile_root / "training-plan.json").write_text(json.dumps({"profile": profile, "base_detection_checkpoint": "PP-OCRv5_mobile_det", "base_recognition_checkpoint": "latin_PP-OCRv5_mobile_rec", "character_dictionary_sha256": base_manifest["dictionary"]["sha256"], "detection_annotations_required": "reviewed full-transcription polygons for every text line", "recognition_annotations_required": "reviewed perspective crops with exact transcriptions", "split_policy": "merchant/layout group; no descendants may cross splits", "train_now": False}, indent=2) + "\n", encoding="utf-8")

    benchmark_path = run_root / "benchmark.json"
    benchmark_path.write_text(json.dumps(benchmark, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    latest_path = dataset / "benchmarks" / "latest.json"
    latest_path.write_text(json.dumps({"run_id": run_id, "benchmark": str(benchmark_path.relative_to(dataset)), "profiles": {profile: data["selected_summary"] for profile, data in benchmark["profiles"].items()}}, indent=2) + "\n", encoding="utf-8")
    if not args.quiet:
        print(json.dumps({"run_id": run_id, "benchmark": str(benchmark_path), "selected": {profile: {"config": data["selected_config"], "summary": data["selected_summary"]} for profile, data in benchmark["profiles"].items()}}, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
