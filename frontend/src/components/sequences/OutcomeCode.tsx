import { SequenceOutcome } from '@/utils/modelAccuracy';

interface OutcomeCodeProps {
  outcome: SequenceOutcome;
  /** Number of other objects in the alert, rendered as a muted "+N" (multi-object rollup). */
  extraCount?: number;
}

const OUTCOMES: Record<SequenceOutcome, { code: string; dotClass?: string; title: string }> = {
  tp: {
    code: 'TP',
    dotClass: 'bg-pine',
    title: 'True positive — model correctly detected smoke',
  },
  fp: {
    code: 'FP',
    dotClass: 'bg-haze',
    title: 'False positive — model flagged non-smoke',
  },
  fn: {
    code: 'FN',
    title: 'False negative — smoke was missed',
  },
  unsure: {
    code: '?',
    dotClass: 'bg-ember',
    title: 'Unsure — needs review',
  },
};

/**
 * Compact model-outcome code for table rows: colored dot (or ⚑ for missed
 * smoke) + mono code. See docs/specs/2026-08-03-outcome-codes-tables-design.md.
 */
export function OutcomeCode({ outcome, extraCount }: OutcomeCodeProps) {
  const { code, dotClass, title } = OUTCOMES[outcome];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 font-data text-detail font-semibold text-char"
    >
      {dotClass ? (
        <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${dotClass}`} />
      ) : (
        <span aria-hidden className="text-signal">
          ⚑
        </span>
      )}
      {code}
      {extraCount !== undefined && extraCount > 0 && (
        <span className="font-medium text-haze">+{extraCount}</span>
      )}
    </span>
  );
}
