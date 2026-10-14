"""Temporal pre-import filter: a sequence that fails to score must stay
distinguishable from one scored below the threshold (the import fails the day
on it so it gets re-run)."""

from rich.console import Console

from scripts.data_transfer.ingestion.alert_api import temporal_filter


def test_failed_sequence_is_dropped_and_absent_from_scores(monkeypatch):
    monkeypatch.setattr(temporal_filter, "load_model", lambda version: object())

    def fake_score(model, records):
        sid = records[0]["sequence_id"]
        if sid == 3:
            raise RuntimeError("download failed")
        return {1: 0.5, 2: 0.1}[sid]

    monkeypatch.setattr(temporal_filter, "score_sequence", fake_score)
    records = [{"sequence_id": sid, "detection_id": sid * 10} for sid in (1, 2, 3)]

    kept, scores = temporal_filter.filter_records(
        records, threshold=0.2, model_version="v0", console=Console(quiet=True)
    )

    assert [r["sequence_id"] for r in kept] == [1]
    assert scores == {1: 0.5, 2: 0.1}  # 3 failed: missing, not scored 0.0
