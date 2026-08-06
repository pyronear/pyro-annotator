from sqlalchemy.dialects import postgresql

from app.models import Sequence
from app.services.alert_skip import alert_skip_exists_clause


def test_clause_compiles_to_correlated_exists():
    clause = alert_skip_exists_clause(Sequence)
    sql = str(
        clause.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "EXISTS" in sql
    assert "alert_skips" in sql
    assert "source_api" in sql
    assert "platform_alert_id" in sql
