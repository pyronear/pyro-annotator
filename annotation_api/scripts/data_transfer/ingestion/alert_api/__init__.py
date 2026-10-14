# Alert API data ingestion utilities

import os

from dotenv import load_dotenv

# Before any submodule: they import app.core.config, which reads POSTGRES_URL
# and S3_* from the environment at import time.
load_dotenv()

# The scripts only talk to the APIs over HTTP and never use these settings, so
# a placeholder keeps users from having to put fake DB/S3 values in their .env.
for _name in (
    "POSTGRES_URL",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_REGION",
    "S3_ENDPOINT_URL",
):
    os.environ.setdefault(_name, "unused-by-scripts")
