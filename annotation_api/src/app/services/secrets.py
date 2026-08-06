# Copyright (C) 2025, Pyronear.

# This program is licensed under the Apache License 2.0.
# See LICENSE or go to <https://www.apache.org/licenses/LICENSE-2.0> for full license details.

"""Symmetric encryption for credentials the system must be able to replay.

Alert-API passwords cannot be hashed: we need the plaintext to log in. They are
therefore encrypted with a key held outside the database, so a database dump — a
backup, a copy pulled for debugging — carries nothing usable on its own.
"""

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

__all__ = ["SecretKeyMissingError", "decrypt_secret", "encrypt_secret"]

_KEY_HELP = (
    "CONNECTOR_SECRET_KEY is not set to a valid Fernet key. Generate one with: "
    'python -c "from cryptography.fernet import Fernet; '
    'print(Fernet.generate_key().decode())"'
)


class SecretKeyMissingError(RuntimeError):
    """CONNECTOR_SECRET_KEY is unset, malformed, or does not match a token."""


def _fernet() -> Fernet:
    # Read settings at call time, not import time, so tests and runtime
    # reconfiguration both work.
    key = settings.CONNECTOR_SECRET_KEY
    if not key:
        raise SecretKeyMissingError(_KEY_HELP)
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise SecretKeyMissingError(_KEY_HELP) from exc


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        # Never echo the token or any plaintext.
        raise SecretKeyMissingError(
            "Stored credential could not be decrypted with the current "
            "CONNECTOR_SECRET_KEY. If the key was rotated or lost, re-enter the "
            "connector credentials."
        ) from exc
