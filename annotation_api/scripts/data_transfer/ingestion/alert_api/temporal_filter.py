"""
Pre-import filter: score each alert sequence with the temporal model and keep
only those above a threshold.

Runs the released `pyronear/temporal-model` (torch backend, bundled YOLO) on
the frames the import already fetched, and keeps a sequence when its score —
the largest calibrated kept-tube probability, same quantity the temporal API
returns as `probability` — exceeds the threshold.

Needs the optional deps: `uv sync --group temporal`.
"""

import concurrent.futures
import logging
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from rich.console import Console
from rich.progress import BarColumn, Progress, TaskProgressColumn, TextColumn

HF_REPO = "pyronear/temporal-model"


def load_model(version: str):
    # Lazy: torch is only needed when the filter is on.
    from huggingface_hub import hf_hub_download
    from temporal_model.core.model import BboxTubeTemporalModel  # type: ignore[import-untyped]

    model_zip = hf_hub_download(HF_REPO, "model.zip", revision=version)
    return BboxTubeTemporalModel.from_package(Path(model_zip), device=None)


def sequence_score(details: Optional[Dict[str, Any]]) -> float:
    """Largest calibrated probability across kept tubes; 0.0 if none."""
    kept = (details or {}).get("tubes", {}).get("kept", [])
    probs = [t["probability"] for t in kept if t.get("probability") is not None]
    return max(probs) if probs else 0.0


def _download(url: str, path: Path) -> Path:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    path.write_bytes(response.content)
    return path


def score_sequence(model, records: List[Dict[str, Any]]) -> float:
    """Download a sequence's frames (oldest first) and score them."""
    records = sorted(records, key=lambda r: r["detection_created_at"])
    with tempfile.TemporaryDirectory() as tmp:
        # `<idx>_<YYYY-MM-DDTHH-MM-SS>.jpg`: the model's filename convention
        # for timestamps; the index keeps names unique and in time order.
        paths = [
            Path(tmp)
            / f"{i:03d}_{r['detection_created_at'][:19].replace(':', '-')}.jpg"
            for i, r in enumerate(records)
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_download, [r["detection_url"] for r in records], paths))
        return sequence_score(model.predict_sequence(paths).details)


def filter_records(
    records: List[Dict[str, Any]],
    threshold: float,
    model_version: str,
    console: Console,
) -> tuple[List[Dict[str, Any]], Dict[int, float]]:
    """Keep the records of alert sequences scoring > threshold.

    A sequence that fails to score (download or predict error) is dropped and
    logged: the filter's job is to keep noise out, so failing closed is safe —
    re-running the import picks it up.
    """
    by_sequence: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_sequence[record["sequence_id"]].append(record)

    console.print(f"[blue]🧠 Loading temporal model {HF_REPO}@{model_version}...[/]")
    model = load_model(model_version)

    scores: Dict[int, float] = {}
    with Progress(
        TextColumn("[bold blue]Temporal scoring"),
        BarColumn(bar_width=40),
        TaskProgressColumn(),
        console=console,
        transient=True,
    ) as progress:
        task = progress.add_task("score", total=len(by_sequence))
        for sequence_id, sequence_records in by_sequence.items():
            try:
                scores[sequence_id] = score_sequence(model, sequence_records)
            except Exception as exc:
                logging.warning("temporal scoring failed for %s: %s", sequence_id, exc)
            progress.advance(task)

    kept_ids = {sid for sid, score in scores.items() if score > threshold}
    console.print(
        f"[blue]🧠 Temporal filter (> {threshold}): kept {len(kept_ids)}/"
        f"{len(by_sequence)} sequence(s) "
        f"({len(by_sequence) - len(scores)} failed to score)[/]"
    )
    return [r for r in records if r["sequence_id"] in kept_ids], scores


if __name__ == "__main__":
    assert sequence_score(None) == 0.0
    assert sequence_score({"tubes": {"kept": []}}) == 0.0
    assert (
        sequence_score(
            {
                "tubes": {
                    "kept": [
                        {"probability": 0.2},
                        {"probability": None},
                        {"probability": 0.7},
                    ]
                }
            }
        )
        == 0.7
    )
    print("ok")
