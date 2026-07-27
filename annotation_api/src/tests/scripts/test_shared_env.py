import logging

from scripts.data_transfer.ingestion.alert_api.shared import getenv_with_fallback

VARS = [
    ("ALERT_API_LOGIN", "PLATFORM_LOGIN"),
    ("ALERT_API_PASSWORD", "PLATFORM_PASSWORD"),
    ("ALERT_API_ADMIN_LOGIN", "PLATFORM_ADMIN_LOGIN"),
    ("ALERT_API_ADMIN_PASSWORD", "PLATFORM_ADMIN_PASSWORD"),
]


def test_new_name_wins(monkeypatch):
    monkeypatch.setenv("ALERT_API_LOGIN", "new")
    monkeypatch.setenv("PLATFORM_LOGIN", "old")
    assert getenv_with_fallback("ALERT_API_LOGIN") == "new"


def test_fallback_to_legacy_warns(monkeypatch, caplog):
    for new, old in VARS:
        monkeypatch.delenv(new, raising=False)
        monkeypatch.setenv(old, "legacy-value")
        with caplog.at_level(logging.WARNING):
            assert getenv_with_fallback(new) == "legacy-value"
        assert old in caplog.text and new in caplog.text
        caplog.clear()


def test_unset_returns_none(monkeypatch):
    monkeypatch.delenv("ALERT_API_LOGIN", raising=False)
    monkeypatch.delenv("PLATFORM_LOGIN", raising=False)
    assert getenv_with_fallback("ALERT_API_LOGIN") is None
