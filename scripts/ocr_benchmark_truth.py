"""Private generic/fuel benchmark truth helpers.

The generated JSON belongs under the private dataset root. It must never be
uploaded as a GitHub artifact or committed to repository history.
"""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import Any


TRUTH_RELATIVE_PATH = Path("manifests/profile-benchmark-truth.json")


def parse_extracted_data(path: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    section = "generic"
    line_items = False
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("Generic invoice line items"):
            line_items = True
            continue
        if line.startswith("Fuel type"):
            section = "fuel"
            line_items = False
            continue
        if not line.startswith("IMG"):
            continue
        values = shlex.split(line)
        receipt_id = values[0]
        if section == "generic" and not line_items:
            result[receipt_id] = {"profile": "generic", "total": values[1], "line_items": []}
        elif section == "generic" and line_items:
            if receipt_id not in result:
                raise ValueError(f"Line item precedes generic receipt total: {receipt_id}")
            result[receipt_id]["line_items"].append(
                {
                    "quantity": int(values[1]),
                    "name": values[2],
                    "unit_price": values[3],
                    "line_total": values[4],
                }
            )
        elif section == "fuel":
            result[receipt_id] = {
                "profile": "fuel",
                "total": values[1].replace(",", "."),
                "paid": values[2].replace(",", "."),
                "discount": values[3].replace(",", "."),
                "price_per_liter": values[4].replace(",", "."),
                "liters": values[5].replace(",", "."),
            }
    if not result:
        raise ValueError("No benchmark receipts were parsed")
    return result


def write_private_truth(dataset_root: Path, expected: dict[str, dict[str, Any]]) -> Path:
    destination = dataset_root / TRUTH_RELATIVE_PATH
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps({"schema_version": 1, "receipts": expected}, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return destination


def load_private_truth(dataset_root: Path) -> dict[str, dict[str, Any]]:
    path = dataset_root / TRUTH_RELATIVE_PATH
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or not isinstance(payload.get("receipts"), dict):
        raise ValueError(f"Invalid private benchmark truth: {path}")
    receipts = payload["receipts"]
    for receipt_id, item in receipts.items():
        if not isinstance(receipt_id, str) or not isinstance(item, dict) or item.get("profile") not in {"generic", "fuel"}:
            raise ValueError(f"Invalid receipt entry in private benchmark truth: {path}")
    return receipts
