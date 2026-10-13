"""Alert API import: source_api resolution and the day-by-day loop.

The import walks the date range one day at a time (fetch, score, import,
annotate, then the next day). A failing day must not stop the range, but must
still fail the run; Ctrl+C must stop it.
"""

import importlib
from datetime import date

import pytest

# `import` is a keyword, so the module can only be loaded by name.
importer = importlib.import_module("scripts.data_transfer.ingestion.alert_api.import")


class TestSourceApi:
    def test_known_urls_resolve(self):
        assert (
            importer.resolve_source_api("https://alertapi.pyronear.org", None)
            == "pyronear_french"
        )
        assert (
            importer.resolve_source_api("https://apicenia.pyronear.org", None)
            == "api_cenia"
        )

    def test_unknown_url_needs_explicit_flag(self):
        assert importer.resolve_source_api("https://alert.example.cl", None) is None
        assert (
            importer.resolve_source_api("https://alert.example.cl", "api_cenia")
            == "api_cenia"
        )

    def test_trailing_slash_is_normalized_by_the_parser(self):
        args = importer.make_cli_parser().parse_args(
            ["--date-from", "2026-10-10", "--alert-api-url", "https://alertapi.pyronear.org/"]
        )
        assert args.alert_api_url == "https://alertapi.pyronear.org"

    def test_bucket_copy_only_for_french_api(self):
        assert (
            importer.default_image_transfer("https://alertapi.pyronear.org")
            == "bucket-copy"
        )
        assert importer.default_image_transfer("https://apicenia.pyronear.org") == "url"
        assert importer.default_image_transfer("https://alert.example.cl") == "url"


@pytest.fixture
def run_main(monkeypatch):
    """Run main() over 2026-10-01..03 with import_day replaced by `fake`."""
    monkeypatch.setattr(importer, "test_annotation_credentials", lambda *a: True)
    monkeypatch.setattr(
        importer.shared, "get_annotation_credentials", lambda url: ("u", "p")
    )

    def run(fake):
        monkeypatch.setattr(importer, "import_day", fake)
        monkeypatch.setattr(
            "sys.argv",
            ["import", "--date-from", "2026-10-01", "--date-end", "2026-10-03"],
        )
        return importer.main()

    return run


def test_days_run_in_order_and_all_succeed(run_main):
    days = []
    assert run_main(lambda args, day, **kw: days.append(day) or 0) == 0
    assert days == [date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 3)]


def test_failed_day_continues_and_fails_the_run(run_main):
    days = []

    def fake(args, day, **kw):
        days.append(day)
        return 1 if day == date(2026, 10, 2) else 0

    assert run_main(fake) == 1
    assert len(days) == 3


def test_keyboard_interrupt_stops_the_range(run_main):
    days = []

    def fake(args, day, **kw):
        days.append(day)
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        run_main(fake)
    assert days == [date(2026, 10, 1)]
