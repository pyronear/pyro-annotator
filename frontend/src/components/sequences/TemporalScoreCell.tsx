interface TemporalScoreCellProps {
  score: number | null | undefined;
}

/**
 * The alert's platform temporal-model score, as a percentage.
 *
 * Null means the platform never scored the alert — distinct from a score of
 * zero, which is a real verdict. The check is `== null` rather than a
 * truthiness test precisely so 0 renders as "0%".
 *
 * The dash carries no colour class of its own: the enclosing cell already
 * applies DATA_CELL_TEXT, so it inherits the muted treatment of its peers.
 */
export function TemporalScoreCell({ score }: TemporalScoreCellProps) {
  if (score == null) {
    return <span title="Not scored by the platform">—</span>;
  }
  return <span>{Math.round(score * 100)}%</span>;
}
