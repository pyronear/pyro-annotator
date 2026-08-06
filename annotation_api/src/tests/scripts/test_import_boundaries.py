"""The importer must not reach `app.services` (#336).

`app/services/__init__.py` imports `storage`, which builds `S3Service` at
module scope and probes the configured bucket with a live `head_bucket` call.
Anything that imports `app.services` therefore needs reachable S3 credentials
just to *load*. When `object_split` started importing
`app.services.annotation_generation`, local imports died on the production
bucket before doing any work -- even with `--image-transfer url`, because the
failure is an import-time side effect rather than part of the transfer.

Every other script import stays inside `app.clients` / `app.schemas` /
`app.models`, none of which touch S3. This pins that boundary.
"""

import os
import subprocess
import sys

# Run in a clean interpreter: the pytest session has already imported
# `app.services` itself, so an in-process check could never observe the
# boundary holding.
PROBE = """
import sys

import scripts.data_transfer.ingestion.alert_api.object_split  # noqa: F401

print(
    "\\n".join(
        sorted(m for m in sys.modules if m == "app.services" or m.startswith("app.services."))
    )
)
"""


def test_object_split_does_not_import_app_services() -> None:
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))

    result = subprocess.run(
        [sys.executable, "-c", PROBE],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0, f"importing object_split failed:\n{result.stderr}"
    assert result.stdout.strip() == "", (
        "object_split reached app.services, which does live S3 I/O at import time: "
        f"{result.stdout.split()}"
    )
