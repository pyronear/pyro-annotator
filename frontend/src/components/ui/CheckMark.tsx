import { clsx } from 'clsx';
import { Check, Minus } from 'lucide-react';

/** A checkbox state, as `aria-checked` spells it. */
export type CheckState = boolean | 'mixed';

/**
 * The drawn box of a custom checkbox; the control around it carries the
 * role and label. `tone` colors the checked state (`mixed` is always ember).
 */
export default function CheckMark({
  checked,
  tone = 'ember',
}: {
  checked: CheckState;
  tone?: 'ember' | 'pine';
}) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
        checked === true &&
          (tone === 'pine' ? 'border-pine bg-pine text-white' : 'border-ember bg-ember text-white'),
        checked === 'mixed' && 'border-ember bg-ember-soft text-ember',
        checked === false && 'border-line bg-paper text-transparent'
      )}
    >
      {checked === 'mixed' ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
    </span>
  );
}
