# Alert API data ingestion utilities

from dotenv import load_dotenv

# Before any submodule: they import app.core.config, which reads POSTGRES_URL
# and S3_* from the environment at import time.
load_dotenv()
