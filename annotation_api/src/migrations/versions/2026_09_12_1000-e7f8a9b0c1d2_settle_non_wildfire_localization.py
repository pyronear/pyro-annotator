"""Settle smoke lanes that no longer need localization

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-09-12 10:00:00.000000

"""

from alembic import op

revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None

# The localization rule now boxes wildfire only (see
# app/services/localization_rule.py). Lanes parked at seq_annotation_done
# waiting to be boxed for industrial or other smoke will never be called into
# the queue again, so they would sit in an intermediate stage forever and hold
# their multi-object alerts back. Settle them as annotated: their classify work
# is complete under the new rule.
#
# Frozen predicate: spelled out here rather than imported from the rule module,
# so a later change to the rule cannot silently rewrite what this migration did.
# has_missed_smoke still localizes whatever its type, so those lanes stay put.
# An empty smoke_types means UNKNOWN and is left alone for a human to type.
#
# The column is JSONB, so a None written through the ORM lands as JSON `null`,
# not SQL NULL. Both tests below are operators rather than functions on
# purpose: jsonb_array_length would raise "cannot get array length of a
# scalar" on such a row, and a jsonb_typeof guard beside it does NOT prevent
# that -- a WHERE clause has no guaranteed evaluation order, so Postgres is
# free to run the length call first. `<> '[]'` compares and cannot throw.
#
# updated_at moves with the stage: settling an alert's last unfinished lane
# makes that alert newly exportable, and /export/alerts derives
# last_annotated_at from greatest(coalesce(updated_at, created_at), ...) and
# filters incremental pulls on it. Leaving the timestamp behind would hide the
# newly complete alert from every consumer whose watermark is already past the
# original classification.
SETTLE = """
    UPDATE sequences_annotations
    SET processing_stage = 'ANNOTATED',
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE processing_stage = 'SEQ_ANNOTATION_DONE'
      AND has_smoke IS TRUE
      AND COALESCE(has_missed_smoke, FALSE) IS FALSE
      AND COALESCE(is_unsure, FALSE) IS FALSE
      AND jsonb_typeof(smoke_types) = 'array'
      AND smoke_types <> '[]'::jsonb
      AND NOT (smoke_types @> '["wildfire"]'::jsonb)
"""


def upgrade() -> None:
    op.execute(SETTLE)


def downgrade() -> None:
    """Deliberately a no-op.

    Nothing records which annotated lanes were moved here, so sending every
    non-wildfire annotated lane back to seq_annotation_done would also drag
    back lanes a human had genuinely finished. Leaving them annotated is the
    safe direction: the old rule would simply call them into the queue again.
    """
