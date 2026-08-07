"""Fernet round-trip for connector credentials, plus the failure modes that must
produce an actionable message rather than a stack trace."""

import pytest
from cryptography.fernet import Fernet

from app.core.config import settings
from app.services.secrets import (
    SecretKeyMissingError,
    decrypt_secret,
    encrypt_secret,
)


@pytest.fixture
def secret_key(monkeypatch) -> str:
    key = Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "CONNECTOR_SECRET_KEY", key)
    return key


def test_round_trip(secret_key):
    assert decrypt_secret(encrypt_secret("hunter2")) == "hunter2"


def test_ciphertext_does_not_contain_plaintext(secret_key):
    assert "hunter2" not in encrypt_secret("hunter2")


def test_encrypt_twice_gives_different_tokens(secret_key):
    # Fernet embeds a timestamp and IV, so identical plaintext must not produce
    # identical ciphertext.
    assert encrypt_secret("hunter2") != encrypt_secret("hunter2")


def test_missing_key_raises_named_error(monkeypatch):
    monkeypatch.setattr(settings, "CONNECTOR_SECRET_KEY", "")
    with pytest.raises(SecretKeyMissingError, match="CONNECTOR_SECRET_KEY"):
        encrypt_secret("hunter2")


def test_malformed_key_raises_named_error(monkeypatch):
    monkeypatch.setattr(settings, "CONNECTOR_SECRET_KEY", "not-a-fernet-key")
    with pytest.raises(SecretKeyMissingError, match="CONNECTOR_SECRET_KEY"):
        encrypt_secret("hunter2")


def test_decrypt_with_wrong_key_raises_named_error(monkeypatch, secret_key):
    token = encrypt_secret("hunter2")
    monkeypatch.setattr(
        settings, "CONNECTOR_SECRET_KEY", Fernet.generate_key().decode()
    )
    with pytest.raises(SecretKeyMissingError):
        decrypt_secret(token)
