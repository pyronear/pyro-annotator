"""retire dead sequence stages in_review, needs_manual, under_annotation

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-28
"""

from typing import Sequence as TypingSequence, Union

from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, TypingSequence[str], None] = None
depends_on: Union[str, TypingSequence[str], None] = None

# Postgres stores enum NAMES (see the initial migration's sa.Enum definition).
# No live code writes the three retired stages (issue #207); rows still in
# them are remapped to their honest state before the labels are dropped:
# review/rework stages collapse into seq_annotation_done (classification
# done, detection-level work pending), and a stale under_annotation claim is
# released back to ready_to_annotate.
LIVE_LABELS = ("IMPORTED", "READY_TO_ANNOTATE", "SEQ_ANNOTATION_DONE", "ANNOTATED")
# Downgrade appends the retired labels at the end rather than restoring the
# initial migration's declaration order; nothing orders by this enum, so the
# difference is cosmetic.
LEGACY_LABELS = LIVE_LABELS + ("UNDER_ANNOTATION", "IN_REVIEW", "NEEDS_MANUAL")


def _swap_enum(labels: tuple[str, ...]) -> None:
    op.execute(
        "ALTER TYPE sequenceannotationprocessingstage "
        "RENAME TO sequenceannotationprocessingstage_old"
    )
    quoted = ", ".join(f"'{label}'" for label in labels)
    op.execute(f"CREATE TYPE sequenceannotationprocessingstage AS ENUM ({quoted})")
    op.execute(
        "ALTER TABLE sequences_annotations "
        "ALTER COLUMN processing_stage "
        "TYPE sequenceannotationprocessingstage "
        "USING processing_stage::text::sequenceannotationprocessingstage"
    )
    op.execute("DROP TYPE sequenceannotationprocessingstage_old")


def upgrade() -> None:
    op.execute(
        "UPDATE sequences_annotations "
        "SET processing_stage = 'SEQ_ANNOTATION_DONE' "
        "WHERE processing_stage IN ('IN_REVIEW', 'NEEDS_MANUAL')"
    )
    op.execute(
        "UPDATE sequences_annotations "
        "SET processing_stage = 'READY_TO_ANNOTATE' "
        "WHERE processing_stage = 'UNDER_ANNOTATION'"
    )
    _swap_enum(LIVE_LABELS)


def downgrade() -> None:
    # Restores the legacy labels so older code can run; the remapped rows
    # stay where upgrade() put them (lossy by design — dev/staging only).
    _swap_enum(LEGACY_LABELS)
