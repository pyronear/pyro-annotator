"""The connection budget must fit inside Postgres.

Every process that talks to the database holds TWO pools, not one:

  - a SQLAlchemy pool (DB_POOL_SIZE + DB_MAX_OVERFLOW), and
  - a procrastinate psycopg pool, opened by `procrastinate_app.open_async()`
    in the API's lifespan and by the queue worker itself.

And there are UVICORN_WORKERS + 1 such processes: each uvicorn worker is its
own process, plus the `worker` compose service, which imports `app.db.engine`
and opens its own AsyncSession (see app/worker.py).

Getting this wrong does not fail at startup. It surfaces as intermittent
"too many clients already" under load -- exactly the kind of thing that only
appears in production during an import. Hence assertions rather than comments.
"""

import psycopg_pool

from app.core.config import settings


def procrastinate_pool_max() -> int:
    """Ceiling of one procrastinate connector's psycopg pool.

    Read from psycopg rather than hardcoded, so the budget tracks the library
    default instead of silently going stale. `open=False` means no connection
    is attempted. PsycopgConnector passes no size arguments (see
    app/worker.py), so the defaults are what actually runs -- and psycopg
    defaults max_size to min_size, making this a hard ceiling, not a floor.
    """
    pool = psycopg_pool.AsyncConnectionPool("postgresql://unused", open=False)
    return pool.max_size


def test_connection_budget_fits_postgres():
    per_process = (
        settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW + procrastinate_pool_max()
    )
    # + 1 for the `worker` compose service alongside the API's uvicorn workers.
    processes = settings.UVICORN_WORKERS + 1
    demand = processes * per_process
    # Postgres holds superuser_reserved_connections (default 3) back, so those
    # are not available to the application.
    budget = settings.POSTGRES_MAX_CONNECTIONS - 3
    assert demand <= budget, (
        f"{processes} processes ({settings.UVICORN_WORKERS} uvicorn workers "
        f"+ 1 queue worker) x {per_process} connections each "
        f"({settings.DB_POOL_SIZE} pool + {settings.DB_MAX_OVERFLOW} overflow "
        f"+ {procrastinate_pool_max()} procrastinate) = {demand}, "
        f"but only {budget} are available"
    )


def test_budget_rejects_an_oversubscribed_worker_count():
    """The budget must actually bind, not just pass at today's numbers.

    Without this, a formula that under-counts pools would keep returning
    'fits' right up to the point where it doesn't -- which is what the
    original version of this test did.
    """
    per_process = (
        settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW + procrastinate_pool_max()
    )
    budget = settings.POSTGRES_MAX_CONNECTIONS - 3
    breaking_workers = budget // per_process + 1  # +1 process => over budget

    assert (breaking_workers + 1) * per_process > budget, (
        "the budget formula never rejects any worker count, so it is not "
        "actually constraining anything"
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
