"""
Orchestrator: filter + import platform sequences via the pyro-engine predictor.

Pipeline (per date range):
  1. Light fetch: shell out to pyro-dataset's `fetch_all_platform_sequences.py`
     with `--detections-limit 10` into a temp directory, skipping sequences
     already known to the local wildfire/fp registries.
  2. Predictor filter: shell out to pyro-dataset's
     `predict_and_filter_sequences.py` (via pyro-engine's venv, which carries
     the heavy `pyro_predictor` / `ncnn` / `onnxruntime` deps). Dropped
     sequences are moved into `<temp>/dropped/`.
  3. Collect the `alert_api_id`s of the kept sequences from
     `<temp>/predictions.csv`.
  4. Heavy import: invoke the standard `import.py` with
     `--sequence-list <kept-ids> --detections-limit 30`, which re-fetches a
     30-image payload per kept sequence and POSTs it to the annotation API
     (which handles its own dedup, image upload, and auto-generation of
     sequence annotations).
  5. On success, delete the temp directory. On failure or with
     `--keep-temp`, leave it for inspection.

Sister-repo paths (`pyro-dataset`, `pyro-engine`) come from env vars
`PYRO_DATASET_DIR` / `PYRO_ENGINE_DIR` (overridable via CLI flags).

Usage:
  uv run python -m scripts.data_transfer.ingestion.platform.import_filtered \\
    --date-from 2025-03-04 --date-end 2025-03-04 \\
    --url-api-annotation http://localhost:5050 \\
    --max-sequences 10

Or via the Makefile:
  make import-platform-filtered DATE_FROM=2025-03-04 DATE_END=2025-03-04 MAX_SEQUENCES=10
"""

import argparse
import csv
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv


load_dotenv()


def _path_from_env(env_name: str) -> Optional[Path]:
    value = os.getenv(env_name)
    return Path(value).expanduser() if value else None


def valid_date(s: str) -> str:
    """Argparse type: validate YYYY-MM-DD format, return the original string."""
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"not a valid date: {s!r} (expected YYYY-MM-DD)"
        ) from exc
    return s


def make_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--date-from",
        type=valid_date,
        required=True,
        help="Start date (YYYY-MM-DD, inclusive).",
    )
    parser.add_argument(
        "--date-end",
        type=valid_date,
        default=None,
        help="End date (YYYY-MM-DD, exclusive in fetch step). Defaults to today.",
    )
    parser.add_argument(
        "--max-sequences",
        type=int,
        default=0,
        help="Cap the number of kept sequences pushed to the annotation API (0 = no cap).",
    )

    # Predictor parameters
    parser.add_argument(
        "--predictor-n-consecutive",
        type=int,
        default=6,
        help="Sliding-window size passed to the Predictor (default: 6).",
    )
    parser.add_argument(
        "--predictor-conf-threshold",
        type=float,
        default=0.1,
        help="Confidence threshold for the Predictor (default: 0.1).",
    )
    parser.add_argument(
        "--predictor-detections-limit",
        type=int,
        default=10,
        help="Number of images per sequence fetched for the predictor pass (default: 10).",
    )

    # Annotation API import parameters (forwarded to import.py)
    parser.add_argument(
        "--detections-limit",
        type=int,
        default=30,
        help="Detections per sequence sent to the annotation API for kept sequences (default: 30).",
    )
    parser.add_argument(
        "--url-api-annotation",
        type=str,
        default="http://localhost:5050",
        help="Annotation API URL.",
    )
    parser.add_argument(
        "--url-api-platform",
        type=str,
        default="https://alertapi.pyronear.org",
        help="Platform API URL.",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=4,
        help="Max workers forwarded to import.py (default: 4).",
    )

    # Sister-repo paths
    parser.add_argument(
        "--pyro-dataset-dir",
        type=Path,
        default=_path_from_env("PYRO_DATASET_DIR"),
        help="Path to the pyro-dataset repo (or set PYRO_DATASET_DIR).",
    )
    parser.add_argument(
        "--pyro-engine-dir",
        type=Path,
        default=_path_from_env("PYRO_ENGINE_DIR"),
        help="Path to the pyro-engine repo (or set PYRO_ENGINE_DIR).",
    )

    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Do not delete the temp directory on success (debugging).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Forward --dry-run to the import step (no actual POSTs).",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        help="Logging level (default: info).",
    )
    return parser


def _validate_paths(args: argparse.Namespace) -> None:
    if args.pyro_dataset_dir is None:
        raise SystemExit(
            "PYRO_DATASET_DIR is not set and --pyro-dataset-dir was not provided"
        )
    if args.pyro_engine_dir is None:
        raise SystemExit(
            "PYRO_ENGINE_DIR is not set and --pyro-engine-dir was not provided"
        )
    fetch_script = (
        args.pyro_dataset_dir
        / "scripts/platform_train_loop/fetch_all_platform_sequences.py"
    )
    predict_script = (
        args.pyro_dataset_dir
        / "scripts/platform_train_loop/predict_and_filter_sequences.py"
    )
    pyro_dataset_python = args.pyro_dataset_dir / ".venv/bin/python"
    pyro_engine_python = args.pyro_engine_dir / ".venv/bin/python"
    pyro_predictor_src = args.pyro_engine_dir / "pyro-predictor"
    for path in (
        fetch_script,
        predict_script,
        pyro_dataset_python,
        pyro_engine_python,
        pyro_predictor_src,
    ):
        if not path.exists():
            raise SystemExit(f"Expected path does not exist: {path}")


def _run(cmd: list, label: str, cwd: Optional[Path] = None,
         env: Optional[dict] = None) -> None:
    logging.info(f"[{label}] {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if result.returncode != 0:
        raise RuntimeError(f"[{label}] exited with code {result.returncode}")


def step_fetch_light(args: argparse.Namespace, temp_dir: Path) -> None:
    """Step 1: download the predictor-only payload via fetch_all_platform_sequences.py.

    The pyro-dataset fetch script reads `PLATFORM_API_ENDPOINT` and the four
    PLATFORM_*_LOGIN/PASSWORD vars from os.environ (it does not load a .env
    on its own). We inject PLATFORM_API_ENDPOINT from --url-api-platform so
    the orchestrator's single CLI flag wins over any divergent .env value.
    """
    script = (
        args.pyro_dataset_dir
        / "scripts/platform_train_loop/fetch_all_platform_sequences.py"
    )
    python = args.pyro_dataset_dir / ".venv/bin/python"
    env = {**os.environ, "PLATFORM_API_ENDPOINT": args.url_api_platform}
    cmd: list = [
        str(python),
        str(script),
        "--date-from",
        args.date_from,
        "--date-end",
        args.date_end,
        "--save-dir",
        str(temp_dir),
        "--detections-limit",
        str(args.predictor_detections_limit),
        "--loglevel",
        args.loglevel,
    ]
    _run(cmd, label="fetch", cwd=args.pyro_dataset_dir, env=env)


def step_predict(args: argparse.Namespace, temp_dir: Path) -> None:
    """Step 2: run the predictor + move dropped folders, via pyro-engine's venv."""
    script = (
        args.pyro_dataset_dir
        / "scripts/platform_train_loop/predict_and_filter_sequences.py"
    )
    python = args.pyro_engine_dir / ".venv/bin/python"
    pythonpath = str(args.pyro_engine_dir / "pyro-predictor")
    env = {**os.environ, "PYTHONPATH": pythonpath}
    cmd: list = [
        str(python),
        str(script),
        "--save-dir",
        str(temp_dir),
        "--n-consecutive",
        str(args.predictor_n_consecutive),
        "--conf-threshold",
        str(args.predictor_conf_threshold),
        "--loglevel",
        args.loglevel,
    ]
    _run(cmd, label="predict", env=env)


def collect_kept_alert_ids(temp_dir: Path) -> List[int]:
    """Step 3: parse predictions.csv -> list of platform alert_api_ids for kept sequences."""
    csv_path = temp_dir / "predictions.csv"
    if not csv_path.exists():
        logging.info(f"No {csv_path} found — predictor produced no output")
        return []
    kept: List[int] = []
    with open(csv_path) as f:
        for row in csv.DictReader(f):
            if row.get("status") != "kept":
                continue
            raw = row.get("sequence_id", "")
            try:
                kept.append(int(raw))
            except ValueError:
                logging.warning(f"Skipping non-integer sequence_id={raw!r} in {csv_path}")
    return kept


def step_push_to_annotation_api(
    args: argparse.Namespace, kept_ids: List[int]
) -> None:
    """Step 4: invoke import.py with --sequence-list to import only kept sequences."""
    if not kept_ids:
        logging.info("No kept sequences after predictor — skipping annotation API push")
        return
    # Pass kept ids via a temp file so we never bump into shell-arg length limits.
    list_file = Path(tempfile.mkstemp(prefix="kept_ids_", suffix=".txt")[1])
    try:
        list_file.write_text("\n".join(str(i) for i in kept_ids) + "\n")
        logging.info(
            f"Importing {len(kept_ids)} kept sequence(s) into annotation API "
            f"({args.url_api_annotation})"
        )
        # platform/ → ingestion/ → data_transfer/ → scripts/ → annotation_api/
        annotation_api_dir = Path(__file__).resolve().parents[4]
        cmd: list = [
            "uv",
            "run",
            "python",
            "-m",
            "scripts.data_transfer.ingestion.platform.import",
            "--date-from",
            args.date_from,
            "--date-end",
            args.date_end,
            "--url-api-annotation",
            args.url_api_annotation,
            "--url-api-platform",
            args.url_api_platform,
            "--sequence-list",
            str(list_file),
            "--detections-limit",
            str(args.detections_limit),
            "--max-workers",
            str(args.max_workers),
            "--loglevel",
            args.loglevel,
        ]
        if args.max_sequences > 0:
            cmd += ["--max-sequences", str(args.max_sequences)]
        if args.dry_run:
            cmd.append("--dry-run")
        _run(cmd, label="import-api", cwd=annotation_api_dir)
    finally:
        list_file.unlink(missing_ok=True)


def main() -> int:
    args = make_cli_parser().parse_args()
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.date_end is None:
        args.date_end = datetime.now().date().strftime("%Y-%m-%d")

    _validate_paths(args)

    temp_dir = Path(tempfile.mkdtemp(prefix="import_filtered_"))
    logging.info(f"Temp dir: {temp_dir}")
    success = False
    try:
        step_fetch_light(args, temp_dir)
        step_predict(args, temp_dir)
        kept_ids = collect_kept_alert_ids(temp_dir)
        logging.info(f"Predictor kept {len(kept_ids)} sequence(s)")
        step_push_to_annotation_api(args, kept_ids)
        success = True
        return 0
    finally:
        if success and not args.keep_temp:
            shutil.rmtree(temp_dir, ignore_errors=True)
            logging.info(f"Cleaned up temp dir {temp_dir}")
        else:
            logging.info(f"Temp dir kept at {temp_dir}")


if __name__ == "__main__":
    sys.exit(main())
