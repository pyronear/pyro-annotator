#!/usr/bin/env python3
"""
Compute TP / FP stats from the exported JSON produced by export_annotations.

Usage:
uv run python -m scripts.data_transfer.ingestion.platform.get_stats \
    --input outputs/sequences_and_annotations_20251029_090600.json
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Categories we consider "true positive fire"
TP_CATEGORIES = {"wildfire", "other", "industrial"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute TP / FP stats from Pyronear annotation export"
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to sequences_and_annotations_YYYYMMDD_HHMMSS.json",
    )
    return parser.parse_args()


def load_annotations(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    # export_annotations creates:
    # {
    #   "generated_at": "...",
    #   "annotations": {"count": ..., "items": [...]},
    #   "sequences":   {"count": ..., "items": [...]}
    # }
    return data["annotations"]["items"]


def classify_record(rec: Dict[str, Any]) -> Tuple[str, str]:
    """
    Figure out what this annotation is.

    Returns (label_type, category)

    label_type is:
      "TP"  means true positive fire smoke
      "FP"  means false positive
      "UNK" means ignored for stats

    category is:
      e.g. "wildfire", "industrial", "low_cloud", etc

    Logic:
    1. If has_smoke is True and smoke_types not empty:
         Take first smoke_types entry.
         If it is in TP_CATEGORIES, call it TP.
         Otherwise call it FP, because we saw smoke but we do not treat it as a real fire signal.
    2. Else if has_false_positives is True and false_positive_types not empty:
         Take first false_positive_types entry, call it FP.
    3. Else if is_unsure is True:
         UNK, "unsure"
    4. Else:
         UNK, "other"
    """
    has_smoke = rec.get("has_smoke", False)
    smoke_types = rec.get("smoke_types") or []
    has_fp = rec.get("has_false_positives", False)
    fp_types = rec.get("false_positive_types") or []
    is_unsure = rec.get("is_unsure", False)

    if has_smoke and smoke_types:
        cat = smoke_types[0]
        if cat in TP_CATEGORIES:
            return "TP", cat
        else:
            # Smoke present but not in the TP set, count it as FP category
            return "FP", cat

    if has_fp and fp_types:
        cat = fp_types[0]
        return "FP", cat

    if is_unsure:
        return "UNK", "unsure"

    return "UNK", "other"


def main() -> None:
    args = parse_args()
    ann_list = load_annotations(Path(args.input))

    # Global counters
    tp_counter = Counter()
    fp_counter = Counter()
    tp_total = 0
    fp_total = 0

    # Per sequence breakdown for quick debugging
    per_seq_tp = Counter()
    per_seq_fp = Counter()
    per_seq_tp_cat: Dict[Any, Counter] = {}
    per_seq_fp_cat: Dict[Any, Counter] = {}

    for rec in ann_list:
        seq_id = rec.get("sequence_id")
        label_type, cat = classify_record(rec)

        if label_type == "TP":
            tp_total += 1
            tp_counter[cat] += 1

            per_seq_tp[seq_id] += 1
            per_seq_tp_cat.setdefault(seq_id, Counter())
            per_seq_tp_cat[seq_id][cat] += 1

        elif label_type == "FP":
            fp_total += 1
            fp_counter[cat] += 1

            per_seq_fp[seq_id] += 1
            per_seq_fp_cat.setdefault(seq_id, Counter())
            per_seq_fp_cat[seq_id][cat] += 1

        # label_type == "UNK" is ignored

    grand_total = tp_total + fp_total if (tp_total + fp_total) else 1

    # Print global summary
    print("=== Global Stats ===")
    print(f"True Positives: {tp_total} ({tp_total/grand_total:.1%})")
    print(f"False Positives: {fp_total} ({fp_total/grand_total:.1%})")

    # TP detail
    print("\n=== True Positives by category ===")
    for cat, count in tp_counter.items():
        pct = count / tp_total if tp_total else 0.0
        print(f"{cat}: {count} ({pct:.1%})")

    # FP detail
    print("\n=== False Positives by category ===")
    for cat, count in fp_counter.items():
        pct = count / fp_total if fp_total else 0.0
        print(f"{cat}: {count} ({pct:.1%})")

    # Top sequences by TP and FP, so you can quickly inspect good and bad cases
    print("\n=== Top sequences by TP count ===")
    for seq_id, n in per_seq_tp.most_common(10):
        cats = dict(per_seq_tp_cat.get(seq_id, {}))
        print(f"seq {seq_id}: TP {n} {cats}")

    print("\n=== Top sequences by FP count ===")
    for seq_id, n in per_seq_fp.most_common(10):
        cats = dict(per_seq_fp_cat.get(seq_id, {}))
        print(f"seq {seq_id}: FP {n} {cats}")


if __name__ == "__main__":
    main()
