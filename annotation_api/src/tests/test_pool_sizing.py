"""The connection budget must fit inside Postgres.

Each uvicorn worker is a separate process with its own SQLAlchemy pool, so
demand is multiplicative in the worker count. Getting this wrong does not fail
at startup -- it surfaces as intermittent "too many clients already" under
load, which is exactly the kind of thing that only shows up in production
during an import. Hence an assertion rather than a comment.
"""

from app.core.config import settings


def test_worker_connection_budget_fits_postgres():
    demand = settings.UVICORN_WORKERS * (
        settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW
    )
    # Postgres keeps superuser_reserved_connections (default 3) back for
    # superusers, so they are not available to the application.
    budget = settings.POSTGRES_MAX_CONNECTIONS - 3
    assert demand <= budget, (
        f"{settings.UVICORN_WORKERS} workers x ("
        f"{settings.DB_POOL_SIZE} pool + {settings.DB_MAX_OVERFLOW} overflow) "
        f"= {demand} connections, but only {budget} are available"
    )


def test_engine_uses_the_configured_pool_size():
    """db.py must read the settings, not hardcode its own numbers.

    The pre-change engine hardcoded 20/30; if it drifts back to literals the
    budget assertion above silently stops describing reality.
    """
    from app.db import engine

    pool = engine.sync_engine.pool
    assert pool.size() == settings.DB_POOL_SIZE
    assert pool._max_overflow == settings.DB_MAX_OVERFLOW
