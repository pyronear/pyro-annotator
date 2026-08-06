import { SequenceOutcome } from '@/utils/modelAccuracy';

/** A dot-less outcome (fn) renders the ⚑ glyph instead. */
interface OutcomeDisplay {
  code: string;
  dotClass?: string;
  title: string;
}

/**
 * Code, dot color and tooltip per outcome. Shared by the OutcomeCode table
 * cell and the Result filter, so a filter chip reads exactly like the column
 * it filters.
 */
export const OUTCOMES: Record<SequenceOutcome, OutcomeDisplay> = {
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
