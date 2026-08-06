"""The two new filters must cut work BEFORE the expensive per-sequence detection
fetches, which is the entire point of the short-circuit."""

from datetime import date

from scripts.data_transfer.ingestion.alert_api import runner
from scripts.data_transfer.ingestion.alert_api.runner import ImportConfig, run_import
from scripts.data_transfer.ingestion.alert_api.sequence_fetching import (
    filter_sequences,
)

CAMERA_ORG = {10: 1, 20: 2, 30: 3}
SEQUENCES = [
    {"id": 100, "camera_id": 10},
    {"id": 101, "camera_id": 20},
    {"id": 102, "camera_id": 30},
    {"id": 103, "camera_id": 10},
]


def test_organization_filter_keeps_only_enabled_orgs():
    kept = filter_sequences(
        SEQUENCES, camera_org=CAMERA_ORG, organization_ids={1, 3}, skip_ids=set()
    )
    assert [s["id"] for s in kept] == [100, 102, 103]


def test_none_organization_filter_keeps_everything():
    kept = filter_sequences(
        SEQUENCES, camera_org=CAMERA_ORG, organization_ids=None, skip_ids=set()
    )
    assert len(kept) == 4


def test_skip_ids_drop_already_imported_alerts():
    kept = filter_sequences(
        SEQUENCES, camera_org=CAMERA_ORG, organization_ids=None, skip_ids={100, 103}
    )
    assert [s["id"] for s in kept] == [101, 102]


def test_both_filters_compose():
    kept = filter_sequences(
        SEQUENCES, camera_org=CAMERA_ORG, organization_ids={1}, skip_ids={100}
    )
    assert [s["id"] for s in kept] == [103]


def test_sequence_with_unknown_camera_is_dropped_when_filtering_by_org():
    # A camera missing from the index cannot be attributed to an organization;
    # importing it would silently ingest an org the operator never enabled.
    kept = filter_sequences(
        [{"id": 200, "camera_id": 999}],
        camera_org=CAMERA_ORG,
        organization_ids={1},
        skip_ids=set(),
    )
    assert kept == []


def test_sequence_with_unknown_camera_is_kept_when_not_filtering():
    kept = filter_sequences(
        [{"id": 200, "camera_id": 999}],
        camera_org=CAMERA_ORG,
        organization_ids=None,
        skip_ids=set(),
    )
    assert [s["id"] for s in kept] == [200]


def test_import_config_defaults_match_cli_behaviour():
    config = ImportConfig(
        alert_api_url="https://alertapi.pyronear.org",
        login="u",
        password="p",
        admin_login="au",
        admin_password="ap",
        annotation_api_url="http://api:5050",
        annotation_api_token="tok",
        date_from=date(2026, 8, 5),
        date_end=date(2026, 8, 5),
        source_api="pyronear_french",
    )
    assert config.organization_ids is None
    assert config.skip_platform_alert_ids == frozenset()
    assert config.max_sequences == 0
    assert config.risk_score == "extreme"


# --- run_import wiring -------------------------------------------------------
#
# One alert sequence per organization is listed; org 2 is not enabled and alert
# 102 is already imported, so only alert 100 may reach the detection fetch.
# Object-splitting turns alert 100 into two lanes: one gets created, the other
# comes back as already existing.

LISTED = [
    {"id": 100, "camera_id": 10},
    {"id": 101, "camera_id": 20},
    {"id": 102, "camera_id": 10},
]
INDEXED_CAMERAS = {
    10: {"id": 10, "organization_id": 1},
    20: {"id": 20, "organization_id": 2},
}
SPLIT_RECORDS = [
    {"sequence_id": 100, "platform_alert_id": 100, "organization_id": 1},
    {"sequence_id": 1000100001, "platform_alert_id": 100, "organization_id": 1},
]
POST_RESULT = {
    "successful_sequences": 1,
    "failed_sequences": 0,
    "skipped_sequences": 1,
    "total_sequences": 2,
    "successful_detections": 1,
    "failed_detections": 0,
    "skipped_detections": 1,
    "total_detections": 2,
    "successful_sequence_ids": [500],
    "sequence_results": [
        {"sequence_id": 500, "alert_api_sequence_id": 100, "failed_detections": 0},
        {"sequence_id": None, "alert_api_sequence_id": 1000100001, "skipped": True},
    ],
}


def _stub_pipeline(monkeypatch) -> dict:
    """Replace every network-touching stage of run_import with a canned result.

    Returns what the stubs observed: the sequences the detection fetch was asked
    for, and the tokens the posting and annotation stages were handed.
    """
    captured: dict = {"fetched": [], "post_token": None, "annotate_tokens": []}
    fetched = captured["fetched"]
    annotate_tokens = captured["annotate_tokens"]
    monkeypatch.setattr(
        runner.alert_api_client, "get_api_access_token", lambda **kwargs: "token"
    )
    monkeypatch.setattr(
        runner,
        "load_alert_api_metadata",
        lambda **kwargs: (INDEXED_CAMERAS, {1: {"name": "org1"}, 2: {"name": "org2"}}),
    )
    monkeypatch.setattr(runner, "list_sequences_within", lambda **kwargs: list(LISTED))

    def fake_fetch_detections(*, sequences, **kwargs):
        fetched.extend(sequences)
        return list(SPLIT_RECORDS)

    monkeypatch.setattr(runner, "fetch_detections_for_sequences", fake_fetch_detections)
    monkeypatch.setattr(
        runner.object_split,
        "split_all_records",
        lambda records: (
            list(SPLIT_RECORDS),
            {
                "alert_api_sequences": 1,
                "objects": 2,
                "sibling_objects": 1,
                "fallback_sequences": 0,
                "cross_deduped_siblings": 0,
            },
        ),
    )

    def fake_post(*args, **kwargs):
        captured["post_token"] = kwargs.get("auth_token")
        return POST_RESULT

    monkeypatch.setattr(runner.shared, "post_records_to_annotation_api", fake_post)

    def fake_annotate(*, seq_result, annotation_api_url, dry_run, auth_token):
        annotate_tokens.append(auth_token)
        return {
            "sequence_id": seq_result["sequence_id"],
            "annotation_created": True,
            "annotation_id": 1,
            "errors": [],
            "final_stage": "ready_to_annotate",
        }

    monkeypatch.setattr(runner, "annotate_split_sequence", fake_annotate)
    return captured


def _config(**overrides) -> ImportConfig:
    kwargs = dict(
        alert_api_url="https://alertapi.pyronear.org",
        login="u",
        password="p",
        admin_login="au",
        admin_password="ap",
        annotation_api_url="http://api:5050",
        annotation_api_token="tok",
        date_from=date(2026, 8, 5),
        date_end=date(2026, 8, 5),
        source_api="pyronear_french",
    )
    kwargs.update(overrides)
    return ImportConfig(**kwargs)


def test_run_import_filters_before_fetching_detections(monkeypatch):
    captured = _stub_pipeline(monkeypatch)

    result = run_import(
        _config(organization_ids={1}, skip_platform_alert_ids=frozenset({102}))
    )

    assert result.ok
    # The whole point: the disabled org and the already-imported alert never
    # reach the per-sequence detection fetch.
    assert [s["id"] for s in captured["fetched"]] == [100]


def test_run_import_passes_the_configured_token_to_every_stage(monkeypatch):
    # The worker self-mints a JWT precisely so no plaintext annotation-API
    # password has to exist in its environment; a config token that never
    # reaches the annotation API calls would silently defeat that.
    captured = _stub_pipeline(monkeypatch)

    run_import(_config(annotation_api_token="worker-jwt", organization_ids={1}))

    assert captured["post_token"] == "worker-jwt"
    assert captured["annotate_tokens"] == ["worker-jwt"]


def test_run_import_reports_per_organization_stats(monkeypatch):
    _stub_pipeline(monkeypatch)

    result = run_import(
        _config(organization_ids={1}, skip_platform_alert_ids=frozenset({102}))
    )

    org1 = result.per_organization[1]
    assert org1.alerts_fetched == 2  # alerts 100 and 102 belong to org 1
    assert org1.alerts_skipped == 1  # alert 102 was filtered as already imported
    assert org1.alerts_imported == 1  # alert 100 had a lane created
    assert org1.alerts_failed == 0
    assert org1.lanes_created == 1  # its sibling lane already existed

    org2 = result.per_organization[2]
    assert org2.alerts_fetched == 1
    assert org2.alerts_imported == 0
    assert org2.lanes_created == 0


def test_run_import_counts_unreported_lanes_as_failures(monkeypatch):
    # post_records_to_annotation_api only reports lanes it created or skipped,
    # so a lane missing from sequence_results is one that failed.
    _stub_pipeline(monkeypatch)
    monkeypatch.setattr(
        runner.shared,
        "post_records_to_annotation_api",
        lambda *args, **kwargs: {
            **POST_RESULT,
            "sequence_results": [POST_RESULT["sequence_results"][0]],
        },
    )

    result = run_import(_config(organization_ids={1}))

    org1 = result.per_organization[1]
    assert org1.alerts_failed == 1
    assert org1.alerts_imported == 0
    assert org1.lanes_created == 1
