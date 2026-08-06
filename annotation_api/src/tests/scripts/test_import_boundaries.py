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

import pytest

# Run in a clean interpreter: the pytest session has already imported
# `app.services` itself, so an in-process check could never observe the
# boundary holding.
PROBE = """
import importlib
import sys

importlib.import_module({module!r})

print(
    "\\n".join(
        sorted(m for m in sys.modules if m == "app.services" or m.startswith("app.services."))
    )
)
"""

# The entry point is what `make import-alert-api` runs, so it is the boundary
# that actually breaks users; `object_split` is pinned separately to keep the
# failure precise when the regression comes back through that module.
IMPORTER_MODULES = [
    "scripts.data_transfer.ingestion.alert_api.import",
    "scripts.data_transfer.ingestion.alert_api.object_split",
]


@pytest.mark.parametrize("module", IMPORTER_MODULES)
def test_importer_does_not_import_app_services(module: str) -> None:
    env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))

    result = subprocess.run(
        [sys.executable, "-c", PROBE.format(module=module)],
        capture_output=True,
        text=True,
        env=env,
    )

    assert result.returncode == 0, f"importing {module} failed:\n{result.stderr}"
    assert result.stdout.strip() == "", (
        f"{module} reached app.services, which does live S3 I/O at import time: "
        f"{result.stdout.split()}"
    )
