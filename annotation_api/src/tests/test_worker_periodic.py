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
