"""
Batch-import local YOLO sequence folders (paired with a sequences.csv metadata
file) into the annotation API.

Layout expected::

    <root-dir>/
        sequences.csv
        <sequences-subdir>/
            <sequence-folder-1>/
                images/
                labels_predictions/
            <sequence-folder-2>/
                ...

Each sequence folder name must end with ``_sequence-<ID>`` so we can join it to
the ``sequence_id`` column of ``sequences.csv`` and pull organisation / camera /
lat / lon / azimuth metadata from there.

For every folder this script invokes
``scripts.data_transfer.ingestion.platform.import_yolo_sequence`` as a
subprocess, so each import is isolated.
"""

from __future__ import annotations

import argparse
import csv
import logging
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Optional

from dotenv import load_dotenv

load_dotenv()

SEQUENCE_ID_RE = re.compile(r"_sequence-(\d+)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root-dir",
        required=True,
        help="Directory containing sequences.csv and the sequences subfolder.",
    )
    parser.add_argument(
        "--sequences-subdir",
        default="sdis-77",
        help="Subdirectory under --root-dir holding per-sequence folders.",
    )
    parser.add_argument(
        "--csv",
        default=None,
        help="sequences.csv path (default: <root-dir>/sequences.csv).",
    )
    parser.add_argument(
        "--labels-dir-name",
        default="labels_predictions",
        help="Labels subfolder name inside each sequence folder.",
    )
    parser.add_argument(
        "--api-base",
        default="http://localhost:5050",
        help="Annotation API base URL.",
    )
    parser.add_argument(
        "--source-api",
        default="pyronear_french",
        help="source_api value stored on each sequence.",
    )
    parser.add_argument(
        "--sequence-stage",
        default="ready_to_annotate",
        help="Processing stage to assign to imported sequence annotations.",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Parallel import workers (subprocesses).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only import the first N folders (0 = all).",
    )
    parser.add_argument(
        "--skip",
        type=int,
        default=0,
        help="Skip the first N folders (useful for resuming).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the commands that would run without executing them.",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
    )
    return parser.parse_args()


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(levelname)s - %(message)s",
    )


def load_metadata(csv_path: Path) -> Dict[int, Dict[str, str]]:
    meta: Dict[int, Dict[str, str]] = {}
    with csv_path.open(newline="") as fp:
        for row in csv.DictReader(fp):
            try:
                seq_id = int(row["sequence_id"])
            except (KeyError, TypeError, ValueError):
                continue
            meta.setdefault(seq_id, row)
    return meta


def extract_sequence_id(folder_name: str) -> Optional[int]:
    match = SEQUENCE_ID_RE.search(folder_name)
    return int(match.group(1)) if match else None


def build_command(
    folder: Path,
    seq_id: int,
    row: Dict[str, str],
    args: argparse.Namespace,
) -> list[str]:
    cmd = [
        sys.executable,
        "-m",
        "scripts.data_transfer.ingestion.platform.import_yolo_sequence",
        "--sequence-dir",
        str(folder),
        "--api-base",
        args.api_base,
        "--alert-api-id",
        str(seq_id),
        "--source-api",
        args.source_api,
        "--sequence-stage",
        args.sequence_stage,
        "--labels-dir-name",
        args.labels_dir_name,
        "--organisation-id",
        row["organization_id"],
        "--organisation-name",
        row["organization_name"],
        "--camera-id",
        row["camera_id"],
        "--camera-name",
        row["camera_name"],
        "--lat",
        row["camera_lat"],
        "--lon",
        row["camera_lon"],
        "--loglevel",
        args.loglevel,
    ]
    azimuth_raw = (
        row.get("camera_azimuth")
        or row.get("sequence_azimuth")  # legacy CSVs
        or row.get("detection_azimuth")
        or ""
    )
    try:
        cmd.extend(["--azimuth", str(int(float(azimuth_raw)))])
    except ValueError:
        pass
    return cmd


def run_one(cmd: list[str], label: str) -> tuple[str, int, str]:
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return label, result.returncode, result.stdout


def main() -> int:
    args = parse_args()
    setup_logging(args.loglevel)

    root = Path(args.root_dir).resolve()
    csv_path = Path(args.csv) if args.csv else root / "sequences.csv"
    seq_root = root / args.sequences_subdir

    if not csv_path.exists():
        logging.error("sequences.csv not found at %s", csv_path)
        return 1
    if not seq_root.is_dir():
        logging.error("Sequences directory not found at %s", seq_root)
        return 1

    metadata = load_metadata(csv_path)
    logging.info("Loaded metadata for %d sequences from %s", len(metadata), csv_path)

    folders = sorted(p for p in seq_root.iterdir() if p.is_dir())
    if args.skip:
        folders = folders[args.skip:]
    if args.limit:
        folders = folders[: args.limit]

    jobs: list[tuple[Path, int, Dict[str, str]]] = []
    skipped = 0
    for folder in folders:
        seq_id = extract_sequence_id(folder.name)
        if seq_id is None:
            logging.warning("%s: cannot parse sequence_id — skipping", folder.name)
            skipped += 1
            continue
        row = metadata.get(seq_id)
        if row is None:
            logging.warning(
                "%s: sequence_id=%d not in CSV — skipping", folder.name, seq_id
            )
            skipped += 1
            continue
        jobs.append((folder, seq_id, row))

    logging.info(
        "Planning %d imports (%d skipped) with %d worker(s)",
        len(jobs),
        skipped,
        args.max_workers,
    )

    if args.dry_run:
        for folder, seq_id, row in jobs:
            cmd = build_command(folder, seq_id, row, args)
            logging.info("[DRY-RUN] %s", " ".join(cmd))
        return 0

    successes = 0
    failures = 0
    total = len(jobs)
    with ThreadPoolExecutor(max_workers=max(1, args.max_workers)) as pool:
        futures = {
            pool.submit(
                run_one,
                build_command(folder, seq_id, row, args),
                folder.name,
            ): (folder, seq_id)
            for folder, seq_id, row in jobs
        }
        for idx, future in enumerate(as_completed(futures), start=1):
            folder, seq_id = futures[future]
            try:
                label, rc, output = future.result()
            except Exception as exc:
                failures += 1
                logging.error(
                    "[%d/%d] %s (seq_id=%d) crashed: %s",
                    idx,
                    total,
                    folder.name,
                    seq_id,
                    exc,
                )
                continue
            if rc == 0:
                successes += 1
                logging.info(
                    "[%d/%d] OK   %s (seq_id=%d)", idx, total, label, seq_id
                )
            else:
                failures += 1
                logging.error(
                    "[%d/%d] FAIL %s (seq_id=%d, rc=%d)\n%s",
                    idx,
                    total,
                    label,
                    seq_id,
                    rc,
                    output.strip(),
                )

    logging.info(
        "Done. success=%d failure=%d skipped=%d total_folders=%d",
        successes,
        failures,
        skipped,
        len(folders),
    )
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
