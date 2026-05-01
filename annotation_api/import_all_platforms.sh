#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREDS_FILE="${SCRIPT_DIR}/../creds.json"

if [ ! -f "$CREDS_FILE" ]; then
    echo "ERROR: creds.json not found at $CREDS_FILE"
    exit 1
fi

for login in $(jq -r 'keys[]' "$CREDS_FILE"); do
    password=$(jq -r --arg k "$login" '.[$k]' "$CREDS_FILE")
    echo "========================================="
    echo "Importing for: $login"
    echo "========================================="
    export PLATFORM_LOGIN="$login"
    export PLATFORM_PASSWORD="$password"
    make -C "$SCRIPT_DIR" import-platform DATE_FROM=2025-01-01 DATE_END=2026-04-01 MAX_SEQUENCES=0 MAX_WORKERS=6 || {
        echo "WARNING: import failed for $login, continuing..."
    }
done

echo "========================================="
echo "All done."
