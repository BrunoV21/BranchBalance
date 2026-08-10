#!/usr/bin/env python3
"""Fail-closed local/CI orchestration for the private BranchBalance OCR dataset.

The pipeline deliberately keeps receipt images, annotations, predictions, and
candidate weights under the private dataset root. GitHub Actions may observe a
pass/fail exit code, but it must never upload those generated files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from ocr_benchmark_truth import load_private_truth


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET_ROOT = Path(os.environ.get("BRANCHBALANCE_OCR_DATASET_ROOT", REPO_ROOT / "ocr-dataset"))
DEFAULT_CONFIG = REPO_ROOT / "config/ocr/pipeline.json"
DEFAULT_MODEL_ROOT = REPO_ROOT / "modules/paddle-ocr/android/src/main/assets/paddle_ocr"
BENCHMARK_SCRIPT = REPO_ROOT / "scripts/benchmark-ocr-profiles.py"
EXPECTED_FIELDS = {
    "merchant",
    "receipt_date",
    "currency",
    "subtotal_minor",
    "tax_minor",
    "tip_minor",
    "total_minor",
}
TEXT_FIELDS = {"merchant", "receipt_date", "currency"}
MINOR_FIELDS = {"subtotal_minor", "tax_minor", "tip_minor", "total_minor"}
MODEL_ROLES = {"detection", "recognition", "orientation"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not load JSON file {path}: {error}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected a JSON object in {path}")
    return value


def validate_pipeline_config(config: dict[str, Any], checks: "Checks") -> None:
    try:
        maximum_bytes = config["model_assets"]["maximum_bundle_bytes"]
        if not isinstance(maximum_bytes, int) or maximum_bytes <= 0:
            raise ValueError("model bundle size must be a positive integer")
        quality_gates = config["quality_gates"]
        if set(quality_gates) != {"generic", "fuel"}:
            raise ValueError("quality_gates must define generic and fuel")
        for profile, gate in quality_gates.items():
            if not isinstance(gate["minimum_receipts"], int) or gate["minimum_receipts"] < 1:
                raise ValueError(f"{profile} minimum_receipts must be positive")
            for key in [
                "minimum_core_recall",
                "minimum_task_recall",
                "minimum_heldout_core_recall",
                "minimum_heldout_task_recall",
            ]:
                if not 0 <= float(gate[key]) <= 1:
                    raise ValueError(f"{profile} {key} must be between zero and one")
            if float(gate["maximum_mean_latency_ms"]) <= 0:
                raise ValueError(f"{profile} latency gate must be positive")
        split_requirements = config["training_readiness"]["minimum_groups_per_profile"]
        if set(split_requirements) != {"train", "validation", "test"}:
            raise ValueError("training readiness must define train, validation, and test group floors")
        if any(not isinstance(value, int) or value < 1 for value in split_requirements.values()):
            raise ValueError("training group floors must be positive integers")
    except (KeyError, TypeError, ValueError) as error:
        checks.error("pipeline_config", f"Invalid OCR pipeline configuration: {error}")


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def image_dimensions(path: Path) -> tuple[int, int]:
    """Return image dimensions without importing training/runtime dependencies."""
    with path.open("rb") as handle:
        header = handle.read(32)
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return struct.unpack(">II", header[16:24])
        if header.startswith(b"\xff\xd8"):
            handle.seek(2)
            start_of_frame = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
            while True:
                marker_start = handle.read(1)
                if not marker_start:
                    break
                if marker_start != b"\xff":
                    continue
                marker = handle.read(1)
                while marker == b"\xff":
                    marker = handle.read(1)
                if not marker:
                    break
                marker_number = marker[0]
                if marker_number in {0xD8, 0xD9}:
                    continue
                length_bytes = handle.read(2)
                if len(length_bytes) != 2:
                    break
                segment_length = struct.unpack(">H", length_bytes)[0]
                if segment_length < 2:
                    break
                if marker_number in start_of_frame:
                    payload = handle.read(5)
                    if len(payload) != 5:
                        break
                    height, width = struct.unpack(">HH", payload[1:5])
                    return width, height
                handle.seek(segment_length - 2, 1)
        if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
            handle.seek(12)
            while True:
                chunk_header = handle.read(8)
                if len(chunk_header) != 8:
                    break
                chunk_type, chunk_size = chunk_header[:4], struct.unpack("<I", chunk_header[4:])[0]
                payload = handle.read(chunk_size)
                if chunk_type == b"VP8X" and len(payload) >= 10:
                    width = int.from_bytes(payload[4:7], "little") + 1
                    height = int.from_bytes(payload[7:10], "little") + 1
                    return width, height
                if chunk_type == b"VP8 " and len(payload) >= 10 and payload[3:6] == b"\x9d\x01\x2a":
                    width = int.from_bytes(payload[6:8], "little") & 0x3FFF
                    height = int.from_bytes(payload[8:10], "little") & 0x3FFF
                    return width, height
                if chunk_type == b"VP8L" and len(payload) >= 5 and payload[0] == 0x2F:
                    bits = int.from_bytes(payload[1:5], "little")
                    return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
                if chunk_size % 2:
                    handle.seek(1, 1)
    raise RuntimeError(f"Unsupported or invalid image: {path}")


def polygon_area(points: list[tuple[float, float]]) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]))) / 2.0


def is_convex_quad(points: list[tuple[float, float]]) -> bool:
    cross_products = []
    for index in range(4):
        a = points[index]
        b = points[(index + 1) % 4]
        c = points[(index + 2) % 4]
        cross_products.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    nonzero = [value for value in cross_products if abs(value) > 1e-5]
    return len(nonzero) == 4 and (all(value > 0 for value in nonzero) or all(value < 0 for value in nonzero))


class Checks:
    def __init__(self) -> None:
        self.errors: list[dict[str, str]] = []
        self.warnings: list[dict[str, str]] = []

    def error(self, code: str, message: str) -> None:
        self.errors.append({"code": code, "message": message})

    def warning(self, code: str, message: str) -> None:
        self.warnings.append({"code": code, "message": message})


def confined_path(root: Path, relative_path: str) -> Path:
    if Path(relative_path).is_absolute():
        raise RuntimeError("Dataset paths must be relative")
    candidate = (root / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise RuntimeError("Dataset path escapes the private dataset root")
    return candidate


def open_dataset(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def validate_model_bundle(model_root: Path, maximum_bytes: int, checks: Checks, label: str) -> dict[str, Any]:
    summary: dict[str, Any] = {"label": label, "valid": False, "bytes": 0}
    manifest_path = model_root / "model-bundle.json"
    if not manifest_path.is_file():
        checks.error("model_manifest_missing", f"{label}: model-bundle.json is missing")
        return summary
    try:
        manifest = load_json(manifest_path)
        if set(manifest.get("models", {})) != MODEL_ROLES:
            checks.error("model_roles", f"{label}: detection, recognition, and orientation model roles are required")
        bundle_files = [manifest_path]
        for role in sorted(MODEL_ROLES):
            item = manifest.get("models", {}).get(role, {})
            artifact = model_root / str(item.get("file", ""))
            if not artifact.is_file():
                checks.error("model_artifact_missing", f"{label}: {role} artifact is missing")
                continue
            bundle_files.append(artifact)
            if sha256(artifact) != item.get("sha256"):
                checks.error("model_hash", f"{label}: {role} SHA-256 does not match its manifest")
        dictionary = manifest.get("dictionary", {})
        dictionary_path = model_root / str(dictionary.get("file", ""))
        if not dictionary_path.is_file():
            checks.error("dictionary_missing", f"{label}: recognition dictionary is missing")
        else:
            bundle_files.append(dictionary_path)
            if sha256(dictionary_path) != dictionary.get("sha256"):
                checks.error("dictionary_hash", f"{label}: recognition dictionary SHA-256 does not match")
            entry_count = len(dictionary_path.read_text(encoding="utf-8").splitlines())
            if entry_count != dictionary.get("entries"):
                checks.error("dictionary_entries", f"{label}: recognition dictionary entry count does not match")
        summary["bytes"] = sum(path.stat().st_size for path in set(bundle_files) if path.is_file())
        if summary["bytes"] > maximum_bytes:
            checks.error("model_size", f"{label}: model bundle exceeds the approved raw-asset size gate")
        summary["bundle_version"] = manifest.get("bundleVersion")
        summary["valid"] = not any(item["message"].startswith(f"{label}:") for item in checks.errors)
    except (KeyError, OSError, RuntimeError, TypeError, UnicodeError) as error:
        checks.error("model_manifest_invalid", f"{label}: invalid model bundle ({error})")
    return summary


def validate_dataset(dataset: Path, config: dict[str, Any], checks: Checks) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "receipt_count": 0,
        "group_count": 0,
        "expected_field_count": 0,
        "region_count": 0,
        "reviewed_expected_fields": 0,
        "reviewed_regions": 0,
        "splits": {},
        "profiles": {},
    }
    database = dataset / "dataset.sqlite"
    manifest_path = dataset / "manifests/dataset-v001.json"
    checksum_path = dataset / "manifests/checksums-dataset-v001.sha256"
    if not dataset.is_dir():
        checks.error("dataset_missing", "Private dataset root does not exist")
        return summary
    if not database.is_file():
        checks.error("database_missing", "dataset.sqlite is missing")
        return summary
    try:
        private_truth = load_private_truth(dataset)
        profile_truth = {receipt_id: item["profile"] for receipt_id, item in private_truth.items()}
    except (OSError, ValueError) as error:
        checks.error("profile_truth", f"Could not parse private benchmark truth: {error}")
        profile_truth = {}

    try:
        with open_dataset(database) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                checks.error("sqlite_integrity", "SQLite integrity_check failed")
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                checks.error("foreign_keys", f"SQLite has {len(foreign_keys)} foreign-key violation(s)")
            required_tables = {"dataset_group", "receipt_image", "expected_field", "text_region", "field_region_link", "benchmark_case"}
            actual_tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            missing_tables = required_tables - actual_tables
            if missing_tables:
                checks.error("schema_tables", f"SQLite is missing {len(missing_tables)} required table(s)")
                return summary

            groups = {row["group_id"]: dict(row) for row in connection.execute("SELECT * FROM dataset_group")}
            receipts = {row["receipt_id"]: dict(row) for row in connection.execute("SELECT * FROM receipt_image")}
            fields_by_receipt: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for row in connection.execute("SELECT * FROM expected_field"):
                fields_by_receipt[row["receipt_id"]].append(dict(row))
            regions_by_receipt: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for row in connection.execute("SELECT * FROM text_region ORDER BY receipt_id, reading_order"):
                regions_by_receipt[row["receipt_id"]].append(dict(row))
            links = connection.execute("SELECT count(*) FROM field_region_link").fetchone()[0]
            cases_by_receipt = Counter(row[0] for row in connection.execute("SELECT receipt_id FROM benchmark_case"))

            summary["receipt_count"] = len(receipts)
            summary["group_count"] = len(groups)
            summary["expected_field_count"] = sum(len(value) for value in fields_by_receipt.values())
            summary["region_count"] = sum(len(value) for value in regions_by_receipt.values())
            summary["reviewed_expected_fields"] = sum(field["reviewed"] for values in fields_by_receipt.values() for field in values)
            summary["reviewed_regions"] = sum(region["reviewed"] for values in regions_by_receipt.values() for region in values)
            summary["field_region_links"] = links
            split_counts = Counter(groups[receipt["group_id"]]["split"] for receipt in receipts.values())
            summary["splits"] = dict(sorted(split_counts.items()))

            if set(profile_truth) != set(receipts):
                checks.error("profile_coverage", "Benchmark truth and SQLite receipt membership differ")
            profile_counts = Counter(profile_truth.values())
            summary["profiles"] = dict(sorted(profile_counts.items()))
            configured_profiles = set(config["quality_gates"])
            if set(profile_counts) != configured_profiles:
                checks.error("profile_set", "Dataset profile set differs from pipeline configuration")

            duplicate_orders = 0
            invalid_polygons = 0
            invalid_transcriptions = 0
            image_errors = 0
            field_errors = 0
            case_errors = 0
            for receipt_id, receipt in receipts.items():
                try:
                    image_path = confined_path(dataset, receipt["relative_image_path"])
                    if not image_path.is_file():
                        raise RuntimeError("canonical image is missing")
                    if sha256(image_path) != receipt["image_sha256"]:
                        raise RuntimeError("canonical image SHA-256 differs from SQLite")
                    width, height = image_dimensions(image_path)
                    if (width, height) != (receipt["width_px"], receipt["height_px"]):
                        raise RuntimeError("canonical image dimensions differ from SQLite")
                except (OSError, RuntimeError, struct.error):
                    image_errors += 1

                fields = fields_by_receipt.get(receipt_id, [])
                names = {field["field_name"] for field in fields}
                if names != EXPECTED_FIELDS or len(fields) != len(EXPECTED_FIELDS):
                    field_errors += 1
                for field in fields:
                    state = field["field_state"]
                    name = field["field_name"]
                    if field["safe_to_extract"] and state != "present":
                        field_errors += 1
                    if state == "present" and name in TEXT_FIELDS and not field["normalized_text"]:
                        field_errors += 1
                    if state == "present" and name in MINOR_FIELDS and field["normalized_minor"] is None:
                        field_errors += 1
                    if state != "present" and (field["normalized_text"] is not None or field["normalized_minor"] is not None or field["safe_to_extract"]):
                        field_errors += 1
                if cases_by_receipt[receipt_id] < 1:
                    case_errors += 1

                seen_orders: set[int] = set()
                for region in regions_by_receipt.get(receipt_id, []):
                    points = [(float(region[f"x{index}"]), float(region[f"y{index}"])) for index in range(1, 5)]
                    if (
                        polygon_area(points) < 1.0
                        or not is_convex_quad(points)
                        or any(x < 0 or y < 0 or x > receipt["width_px"] or y > receipt["height_px"] for x, y in points)
                    ):
                        invalid_polygons += 1
                    reading_order = region["reading_order"]
                    if reading_order is None or reading_order in seen_orders:
                        duplicate_orders += 1
                    else:
                        seen_orders.add(reading_order)
                    if region["reviewed"] and not (region["transcription"] or "").strip():
                        invalid_transcriptions += 1

            if image_errors:
                checks.error("canonical_images", f"{image_errors} canonical image(s) failed path/hash/dimension validation")
            if field_errors:
                checks.error("expected_fields", f"{field_errors} expected-field invariant(s) failed")
            if case_errors:
                checks.error("benchmark_cases", f"{case_errors} receipt(s) have no benchmark case")
            if invalid_polygons:
                checks.error("polygons", f"{invalid_polygons} text polygon(s) are invalid or out of bounds")
            if duplicate_orders:
                checks.error("reading_order", f"{duplicate_orders} text region(s) have missing or duplicate reading order")
            if invalid_transcriptions:
                checks.error("reviewed_transcriptions", f"{invalid_transcriptions} reviewed text region(s) have empty transcriptions")

            for group in groups.values():
                if group["dataset_version"] != "dataset-v001":
                    checks.error("dataset_version", "All groups must use dataset-v001 until an explicit version migration")
                    break

            if summary["reviewed_expected_fields"] < summary["expected_field_count"]:
                checks.warning("unreviewed_fields", "Dataset contains expected fields pending manual review")
            if summary["reviewed_regions"] < summary["region_count"]:
                checks.warning("unreviewed_regions", "Dataset contains OCR regions pending manual review")
    except sqlite3.Error as error:
        checks.error("sqlite", f"Could not validate SQLite dataset: {error}")
        return summary

    if not manifest_path.is_file():
        checks.error("dataset_manifest", "Dataset manifest is missing")
    else:
        try:
            manifest = load_json(manifest_path)
            canonical = manifest.get("canonical_images", [])
            if manifest.get("receipt_count") != summary["receipt_count"] or len(canonical) != summary["receipt_count"]:
                checks.error("manifest_receipts", "Dataset manifest receipt count differs from SQLite")
            manifest_splits = manifest.get("splits", {})
            if manifest_splits != summary["splits"]:
                checks.error("manifest_splits", "Dataset manifest split counts differ from SQLite")
            manifest_images = {
                item.get("receipt_id"): item
                for item in canonical
                if isinstance(item, dict) and item.get("receipt_id")
            }
            manifest_image_errors = 0
            if set(manifest_images) != set(receipts):
                manifest_image_errors += 1
            for receipt_id, receipt in receipts.items():
                item = manifest_images.get(receipt_id, {})
                if (
                    item.get("path") != receipt["relative_image_path"]
                    or item.get("sha256") != receipt["image_sha256"]
                    or item.get("width_px") != receipt["width_px"]
                    or item.get("height_px") != receipt["height_px"]
                    or (profile_truth and item.get("ocr_profile") != profile_truth.get(receipt_id))
                ):
                    manifest_image_errors += 1
            if manifest_image_errors:
                checks.error("manifest_images", f"{manifest_image_errors} canonical manifest image entry/entries differ from SQLite or profile truth")
        except RuntimeError as error:
            checks.error("dataset_manifest", str(error))

    if not checksum_path.is_file():
        checks.error("checksum_manifest", "Canonical-image checksum manifest is missing")
    else:
        checksum_errors = 0
        checksum_lines = [line for line in checksum_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        if len(checksum_lines) != summary["receipt_count"]:
            checksum_errors += 1
        for line in checksum_lines:
            try:
                expected_hash, relative_path = line.split(maxsplit=1)
                path = confined_path(dataset, relative_path.strip())
                if not path.is_file() or sha256(path) != expected_hash:
                    checksum_errors += 1
            except (OSError, RuntimeError, ValueError):
                checksum_errors += 1
        if checksum_errors:
            checks.error("checksum_manifest", f"{checksum_errors} canonical checksum entry/entries failed")
    return summary


def profile_split_groups(dataset: Path, profile_truth: dict[str, str]) -> dict[str, Counter[str]]:
    result: dict[str, Counter[str]] = defaultdict(Counter)
    with open_dataset(dataset / "dataset.sqlite") as connection:
        rows = connection.execute(
            "SELECT ri.receipt_id, ri.group_id, dg.split FROM receipt_image ri JOIN dataset_group dg USING(group_id)"
        ).fetchall()
    groups_by_profile_split: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in rows:
        profile = profile_truth.get(row["receipt_id"])
        if profile:
            groups_by_profile_split[(profile, row["split"])].add(row["group_id"])
    for (profile, split), group_ids in groups_by_profile_split.items():
        result[profile][split] = len(group_ids)
    return result


def check_training_readiness(dataset: Path, config: dict[str, Any], profiles: Iterable[str], checks: Checks) -> dict[str, Any]:
    private_truth = load_private_truth(dataset)
    profile_truth = {receipt_id: item["profile"] for receipt_id, item in private_truth.items()}
    requested = set(profiles)
    receipt_ids = {receipt_id for receipt_id, profile in profile_truth.items() if profile in requested}
    summary: dict[str, Any] = {"profiles": sorted(requested), "eligible": False, "profile_splits": {}}
    split_groups = profile_split_groups(dataset, profile_truth)
    summary["profile_splits"] = {profile: dict(split_groups[profile]) for profile in sorted(requested)}

    placeholders = ",".join("?" for _ in receipt_ids)
    if not placeholders:
        checks.error("readiness_profile", "Selected profile has no receipts")
        return summary
    with open_dataset(dataset / "dataset.sqlite") as connection:
        unreviewed_fields = connection.execute(
            f"SELECT count(*) FROM expected_field WHERE receipt_id IN ({placeholders}) AND reviewed=0", tuple(receipt_ids)
        ).fetchone()[0]
        unreviewed_regions = connection.execute(
            f"SELECT count(*) FROM text_region WHERE receipt_id IN ({placeholders}) AND reviewed=0", tuple(receipt_ids)
        ).fetchone()[0]
        incomplete_regions = connection.execute(
            f"SELECT count(*) FROM text_region WHERE receipt_id IN ({placeholders}) AND (annotation_level!='full_transcription' OR transcription IS NULL OR trim(transcription)='')",
            tuple(receipt_ids),
        ).fetchone()[0]
        missing_source_links = connection.execute(
            f"""
            SELECT count(*) FROM expected_field ef
            WHERE ef.receipt_id IN ({placeholders})
              AND ef.field_state='present' AND ef.safe_to_extract=1
              AND NOT EXISTS (
                SELECT 1 FROM field_region_link frl
                JOIN text_region tr ON tr.region_id=frl.region_id
                WHERE frl.field_id=ef.field_id AND tr.reviewed=1
                  AND frl.region_role IN ('value','combined','supporting_evidence')
              )
            """,
            tuple(receipt_ids),
        ).fetchone()[0]
        regions = connection.execute(
            f"SELECT transcription FROM text_region WHERE receipt_id IN ({placeholders}) AND reviewed=1",
            tuple(receipt_ids),
        ).fetchall()

    if unreviewed_fields:
        checks.error("training_unreviewed_fields", f"Selected profiles contain {unreviewed_fields} unreviewed expected field(s)")
    if unreviewed_regions:
        checks.error("training_unreviewed_regions", f"Selected profiles contain {unreviewed_regions} unreviewed text region(s)")
    if incomplete_regions:
        checks.error("training_transcriptions", f"Selected profiles contain {incomplete_regions} incomplete full-transcription region(s)")
    if missing_source_links:
        checks.error("training_source_links", f"Selected profiles contain {missing_source_links} extractable field(s) without a reviewed source link")

    dictionary_manifest = load_json(DEFAULT_MODEL_ROOT / "model-bundle.json")
    dictionary_path = DEFAULT_MODEL_ROOT / dictionary_manifest["dictionary"]["file"]
    allowed_characters = set(dictionary_path.read_text(encoding="utf-8").splitlines()) | {" "}
    unsupported_characters = {
        character
        for row in regions
        for character in (row["transcription"] or "")
        if row["transcription"] != "###" and character not in allowed_characters
    }
    if unsupported_characters:
        checks.error("training_dictionary", f"Reviewed transcriptions use {len(unsupported_characters)} unsupported character(s)")

    requirements = config["training_readiness"]
    for profile in sorted(requested):
        counts = split_groups[profile]
        for split, minimum in requirements["minimum_groups_per_profile"].items():
            if counts[split] < minimum:
                checks.error("training_splits", f"{profile} profile requires at least {minimum} {split} group(s); found {counts[split]}")
    summary.update(
        {
            "unreviewed_expected_fields": unreviewed_fields,
            "unreviewed_regions": unreviewed_regions,
            "incomplete_regions": incomplete_regions,
            "missing_source_links": missing_source_links,
            "unsupported_character_count": len(unsupported_characters),
        }
    )
    summary["eligible"] = not checks.errors
    return summary


def run_benchmark(
    dataset: Path,
    config: dict[str, Any],
    checks: Checks,
    model_roots: dict[str, Path],
    quiet: bool,
    heldout_profiles: set[str] | None = None,
) -> dict[str, Any]:
    heldout_profiles = heldout_profiles or set()
    command = [
        sys.executable,
        str(BENCHMARK_SCRIPT),
        "--dataset",
        str(dataset),
        "--generic-model-root",
        str(model_roots["generic"]),
        "--fuel-model-root",
        str(model_roots["fuel"]),
    ]
    if quiet:
        command.append("--quiet")
    completed = subprocess.run(command, cwd=REPO_ROOT, check=False)
    if completed.returncode != 0:
        checks.error("benchmark_execution", "OCR benchmark command failed")
        return {}
    try:
        latest = load_json(dataset / "benchmarks/latest.json")
        benchmark_path = confined_path(dataset, latest["benchmark"])
        benchmark = load_json(benchmark_path)
    except (KeyError, RuntimeError) as error:
        checks.error("benchmark_output", f"Benchmark output is invalid: {error}")
        return {}

    quality_summary: dict[str, Any] = {"run_id": benchmark.get("run_id"), "profiles": {}}
    for profile, gate in config["quality_gates"].items():
        profile_result = benchmark.get("profiles", {}).get(profile)
        if not profile_result:
            checks.error("benchmark_profile", f"Benchmark did not produce the {profile} profile")
            continue
        metrics = profile_result["selected_summary"]
        heldout = profile_result.get("selected_heldout_summary", {})
        quality_summary["profiles"][profile] = {**metrics, "heldout": heldout}
        if metrics["receipt_count"] < gate["minimum_receipts"]:
            checks.error("quality_receipts", f"{profile} benchmark has fewer receipts than the approved gate")
        if metrics["core_recall"] < gate["minimum_core_recall"]:
            checks.error("quality_core", f"{profile} core recall regressed below its approved gate")
        if metrics["task_recall"] < gate["minimum_task_recall"]:
            checks.error("quality_task", f"{profile} task recall regressed below its approved gate")
        if metrics["mean_latency_ms"] > gate["maximum_mean_latency_ms"]:
            checks.error("quality_latency", f"{profile} mean local inference latency exceeds its approved gate")
        if profile in heldout_profiles:
            if heldout.get("receipt_count", 0) < 1:
                checks.error("quality_heldout", f"{profile} candidate benchmark has no validation/test receipts")
            elif heldout["core_recall"] < gate["minimum_heldout_core_recall"]:
                checks.error("quality_heldout_core", f"{profile} held-out core recall regressed below its approved gate")
            elif heldout["task_recall"] < gate["minimum_heldout_task_recall"]:
                checks.error("quality_heldout_task", f"{profile} held-out task recall regressed below its approved gate")
    return quality_summary


def run_trainer(trainer: Path, dataset: Path, profile: str, output: Path, config_path: Path) -> int:
    command = [str(trainer)]
    if trainer.suffix == ".py":
        command.insert(0, sys.executable)
    command.extend(
        [
            "--dataset",
            str(dataset),
            "--profile",
            profile,
            "--output",
            str(output),
            "--pipeline-config",
            str(config_path),
        ]
    )
    return subprocess.run(command, cwd=REPO_ROOT, check=False).returncode


def command_profiles(value: str) -> list[str]:
    return ["generic", "fuel"] if value == "all" else [value]


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET_ROOT)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--summary", type=Path)
    parser.add_argument("--ci", action="store_true", help="Print only a pass/fail line; do not expose benchmark metrics in CI logs")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate", help="Validate dataset, annotations, splits, hashes, and deployed model assets")
    add_common_arguments(validate)
    for name in ["benchmark", "quality"]:
        benchmark = subparsers.add_parser(name, help="Run both profile benchmarks and enforce quality/latency gates")
        add_common_arguments(benchmark)
        benchmark.add_argument("--generic-model-root", type=Path, default=DEFAULT_MODEL_ROOT)
        benchmark.add_argument("--fuel-model-root", type=Path, default=DEFAULT_MODEL_ROOT)
    readiness = subparsers.add_parser("train-readiness", help="Fail unless annotations and profile splits are eligible for training")
    add_common_arguments(readiness)
    readiness.add_argument("--profile", choices=["generic", "fuel", "all"], default="all")
    train = subparsers.add_parser("train", help="Run an approved private trainer hook and benchmark its candidate bundle(s)")
    add_common_arguments(train)
    train.add_argument("--profile", choices=["generic", "fuel", "all"], default="all")
    train.add_argument("--trainer", type=Path, default=os.environ.get("BRANCHBALANCE_OCR_TRAINER"))
    train.add_argument("--candidate-root", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    dataset = args.dataset.expanduser().resolve()
    config_path = args.config.expanduser().resolve()
    checks = Checks()
    report: dict[str, Any] = {
        "schema_version": 1,
        "created_at_utc": utc_now(),
        "command": args.command,
        "status": "failed",
    }
    try:
        config = load_json(config_path)
        validate_pipeline_config(config, checks)
    except RuntimeError as error:
        checks.error("pipeline_config", str(error))
        config = {"quality_gates": {}, "model_assets": {"maximum_bundle_bytes": 0}, "training_readiness": {"minimum_groups_per_profile": {}}}

    if not checks.errors:
        report["dataset"] = validate_dataset(dataset, config, checks)
        report["deployed_model"] = validate_model_bundle(
            DEFAULT_MODEL_ROOT,
            config["model_assets"]["maximum_bundle_bytes"],
            checks,
            "deployed",
        )

    if not checks.errors and args.command in {"benchmark", "quality"}:
        model_roots = {
            "generic": args.generic_model_root.expanduser().resolve(),
            "fuel": args.fuel_model_root.expanduser().resolve(),
        }
        for profile, model_root in model_roots.items():
            validate_model_bundle(model_root, config["model_assets"]["maximum_bundle_bytes"], checks, profile)
        if not checks.errors:
            report["quality"] = run_benchmark(dataset, config, checks, model_roots, args.ci)

    if not checks.errors and args.command in {"train-readiness", "train"}:
        profiles = command_profiles(args.profile)
        report["training_readiness"] = check_training_readiness(dataset, config, profiles, checks)

    private_candidate_summary: Path | None = None
    if not checks.errors and args.command == "train":
        trainer = args.trainer.expanduser().resolve() if isinstance(args.trainer, Path) else None
        if trainer is None or not trainer.is_file():
            checks.error("trainer_missing", "Training is eligible, but an executable --trainer hook was not provided")
        else:
            run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            candidate_root = (
                args.candidate_root.expanduser().resolve()
                if args.candidate_root
                else dataset / "candidates" / run_id
            )
            profiles = command_profiles(args.profile)
            candidate_models: dict[str, Path] = {"generic": DEFAULT_MODEL_ROOT, "fuel": DEFAULT_MODEL_ROOT}
            for profile in profiles:
                output = candidate_root / profile
                output.mkdir(parents=True, exist_ok=True)
                if run_trainer(trainer, dataset, profile, output, config_path) != 0:
                    checks.error("trainer_failed", f"Private trainer failed for the {profile} profile")
                    break
                validate_model_bundle(output, config["model_assets"]["maximum_bundle_bytes"], checks, f"candidate-{profile}")
                candidate_models[profile] = output
            if not checks.errors:
                report["quality"] = run_benchmark(
                    dataset,
                    config,
                    checks,
                    candidate_models,
                    args.ci,
                    heldout_profiles=set(profiles),
                )
            report["candidate"] = {
                "root": str(candidate_root),
                "profiles": profiles,
                "promotion": "blocked pending physical-device acceptance and explicit asset replacement",
            }
            private_candidate_summary = candidate_root / "pipeline-summary.json"

    report["errors"] = checks.errors
    report["warnings"] = checks.warnings
    report["status"] = "passed" if not checks.errors else "failed"
    if private_candidate_summary:
        write_json(private_candidate_summary, report)
    if args.summary:
        write_json(args.summary.expanduser().resolve(), report)

    if args.ci:
        print(f"OCR pipeline {report['status']} ({args.command})")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if not checks.errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
