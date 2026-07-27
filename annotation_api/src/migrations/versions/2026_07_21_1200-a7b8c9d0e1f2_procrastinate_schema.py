"""apply procrastinate queue schema

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-21 12:00:00.000000

procrastinate's baseline schema is a multi-statement SQL script; the app's
asyncpg engine cannot run a multi-statement script in one call, so we apply it
through a short-lived psycopg connection. Idempotent: drops any pre-existing
procrastinate objects before applying, so it survives a test harness that
resets the schema by re-running migrations.
"""

from typing import Sequence, Union

import psycopg
from procrastinate.schema import SchemaManager

from app.core.config import settings

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Drop every procrastinate_* object (tables, functions, enum types) in public.
_DROP_SQL = r"""
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables
             WHERE schemaname = 'public' AND tablename LIKE 'procrastinate\_%' LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
    FOR r IN SELECT proname, oidvectortypes(proargtypes) AS args FROM pg_proc
             WHERE proname LIKE 'procrastinate\_%' LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS public.' || quote_ident(r.proname)
                || '(' || r.args || ') CASCADE';
    END LOOP;
    FOR r IN SELECT typname FROM pg_type
             WHERE typname LIKE 'procrastinate\_%' LOOP
        EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
    END LOOP;
END $$;
"""


def upgrade() -> None:
    with psycopg.connect(settings.procrastinate_dsn, autocommit=True) as conn:
        conn.execute(_DROP_SQL)
        conn.execute(SchemaManager.get_schema())


def downgrade() -> None:
    with psycopg.connect(settings.procrastinate_dsn, autocommit=True) as conn:
        conn.execute(_DROP_SQL)
