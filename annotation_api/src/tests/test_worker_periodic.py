"""Smoke tests: the periodic group-assignment task is registered on the
procrastinate app with the expected cron schedule."""

from app.worker import app as procrastinate_app


def test_assign_sequence_groups_task_registered():
    assert "assign_sequence_groups" in procrastinate_app.tasks


def test_assign_sequence_groups_periodic_cron():
    entries = [
        pt
        for pt in procrastinate_app.periodic_registry.periodic_tasks.values()
        if pt.task.name == "assign_sequence_groups"
    ]
    assert len(entries) == 1
    assert entries[0].cron == "*/5 * * * *"


def test_connector_import_tasks_registered():
    assert "schedule_connector_imports" in procrastinate_app.tasks
    assert "run_connector_import" in procrastinate_app.tasks


def test_schedule_connector_imports_runs_daily():
    entries = [
        pt
        for pt in procrastinate_app.periodic_registry.periodic_tasks.values()
        if pt.task.name == "schedule_connector_imports"
    ]
    assert len(entries) == 1
    assert entries[0].cron == "0 3 * * *"
