interface TemporalScoreCellProps {
  score: number | null | undefined;
}

/**
 * The Alert API's temporal-model score for this alert, as a percentage.
 *
 * Null means the Alert API never scored the alert — distinct from a score of
 * zero, which is a real verdict. The check is `== null` rather than a
 * truthiness test precisely so 0 renders as "0%".
 *
 * The dash carries no colour class of its own: the enclosing cell already
 * applies DATA_CELL_TEXT, so it inherits the muted treatment of its peers.
 */
export function TemporalScoreCell({ score }: TemporalScoreCellProps) {
  if (score == null) {
    return <span title="Not scored by the Alert API">—</span>;
  }
  return <span>{Math.round(score * 100)}%</span>;
}
