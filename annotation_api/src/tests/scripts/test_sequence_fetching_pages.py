"""Alert API sequence listing: page size cap and HTTP error handling.

The alert API rejects `limit` above 100 on `/sequences/all/fromdate` with a
422 whose body is a `{"detail": ...}` dict. Returning that dict as data let
`list.extend` turn it into a phantom "detail" sequence (`'str' object has no
attribute 'get'` downstream), so the error must be raised and fail the day
instead of being swallowed into an empty or partial import.
"""

from datetime import date

import pytest
import requests

from scripts.data_transfer.ingestion.alert_api import client, sequence_fetching

API = "https://alertapi.example.org"
DAY = date(2026, 7, 15)


class _Response:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self.ok = status_code < 400
        self.text = str(payload)
        self._payload = payload

    def json(self):
        return self._payload


def test_fetch_fails_the_day_when_the_api_rejects_the_request(monkeypatch):
    detail = {"detail": [{"loc": ["query", "limit"], "msg": "Input should be <= 100"}]}
    monkeypatch.setattr(requests, "get", lambda *a, **k: _Response(422, detail))

    with pytest.raises(Exception, match="API Error: 422"):
        sequence_fetching.fetch_sequences_for_date(API, DAY, "token")


def test_fetch_pages_within_the_alert_api_limit(monkeypatch):
    calls: list[dict] = []

    def fake_list(api_endpoint, date, limit, offset, access_token, risk_score=None):
        calls.append({"limit": limit, "offset": offset})
        total = 150
        return [{"id": i} for i in range(offset, min(offset + limit, total))]

    monkeypatch.setattr(client, "list_sequences_for_date", fake_list)

    sequences = sequence_fetching.fetch_sequences_for_date(API, DAY, "token")

    assert [s["id"] for s in sequences] == list(range(150))
    assert all(c["limit"] <= 100 for c in calls)
    assert [c["offset"] for c in calls] == [0, 100]
