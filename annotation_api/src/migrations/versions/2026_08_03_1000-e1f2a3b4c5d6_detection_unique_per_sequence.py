"""detections: replace vacuous (alert_api_id, id) unique with (sequence_id, alert_api_id)

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-08-03
"""

from typing import Sequence as TypingSequence, Union

from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels: Union[str, TypingSequence[str], None] = None
depends_on: Union[str, TypingSequence[str], None] = None


def upgrade() -> None:
    # The old constraint included the primary key, so duplicates of the same
    # alert detection within a sequence were never rejected (retries after a
    # gateway timeout created them). Dedupe before the real constraint lands:
    # keep the earliest row per (sequence_id, alert_api_id) and preserve any
    # human annotation by re-pointing it at the survivor.
    op.execute(
        """
        CREATE TEMP TABLE _dup_detections AS
        SELECT d.id AS dup_id, k.keep_id
        FROM detections d
        JOIN (
            SELECT sequence_id, alert_api_id, MIN(id) AS keep_id
            FROM detections
            GROUP BY sequence_id, alert_api_id
            HAVING COUNT(*) > 1
        ) k
          ON d.sequence_id = k.sequence_id AND d.alert_api_id = k.alert_api_id
        WHERE d.id <> k.keep_id
        """
    )
    # Annotations on doomed rows: drop them when the survivor already has one
    # (detections_annotations.detection_id is unique) ...
    op.execute(
        """
        DELETE FROM detections_annotations da
        USING _dup_detections dup, detections_annotations surv
        WHERE da.detection_id = dup.dup_id AND surv.detection_id = dup.keep_id
        """
    )
    # ... keep only the earliest annotation when several doomed rows of the
    # same key are annotated ...
    op.execute(
        """
        DELETE FROM detections_annotations da
        USING _dup_detections dup
        WHERE da.detection_id = dup.dup_id
          AND EXISTS (
            SELECT 1
            FROM detections_annotations da2
            JOIN _dup_detections dup2 ON da2.detection_id = dup2.dup_id
            WHERE dup2.keep_id = dup.keep_id AND da2.id < da.id
          )
        """
    )
    # ... and re-point the remaining one at the survivor.
    op.execute(
        """
        UPDATE detections_annotations da
        SET detection_id = dup.keep_id
        FROM _dup_detections dup
        WHERE da.detection_id = dup.dup_id
        """
    )
    op.execute(
        "DELETE FROM detections d USING _dup_detections dup WHERE d.id = dup.dup_id"
    )
    op.execute("DROP TABLE _dup_detections")

    op.drop_constraint("uq_detection_alert_id", "detections", type_="unique")
    op.create_unique_constraint(
        "uq_detection_sequence_alert_api_id",
        "detections",
        ["sequence_id", "alert_api_id"],
    )


def downgrade() -> None:
    # Deleted duplicate rows are not restorable; only the constraint swap
    # reverses.
    op.drop_constraint(
        "uq_detection_sequence_alert_api_id", "detections", type_="unique"
    )
    op.create_unique_constraint(
        "uq_detection_alert_id", "detections", ["alert_api_id", "id"]
    )
