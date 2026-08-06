import { useId } from 'react';
import { ModelAccuracyType, SequenceOutcome, getModelAccuracyResult } from '@/utils/modelAccuracy';
import { OUTCOMES } from '@/components/sequences/outcomeDisplay';

interface ModelAccuracyFilterProps {
  selectedAccuracy: ModelAccuracyType | 'all';
  onSelectionChange: (accuracy: ModelAccuracyType | 'all') => void;
  label?: string;
  className?: string;
}

// Chip options in table-column order. `outcome` pulls the dot and code from
// OUTCOMES so the filter reads exactly like the Result column it filters;
// names come from getModelAccuracyResult so chip and pill agree.
const OPTIONS: Array<{
  value: ModelAccuracyType | 'all';
  label: string;
  outcome?: SequenceOutcome;
}> = [
  { value: 'all', label: 'All' },
  { value: 'true_positive', label: getModelAccuracyResult('true_positive').label, outcome: 'tp' },
  { value: 'false_positive', label: getModelAccuracyResult('false_positive').label, outcome: 'fp' },
  { value: 'false_negative', label: getModelAccuracyResult('false_negative').label, outcome: 'fn' },
];

// Selection is a darker border plus a tinted fill rather than a solid one: a
// filled chip would swallow the outcome dot, which is the whole point here.
// Hover darkens the border only, so it never reads as selected.
const chipClasses = (selected: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-char peer-focus-visible:ring-offset-2 ${
    selected ? 'border-char bg-ash text-char' : 'border-line bg-paper text-haze hover:border-haze'
  }`;

export default function ModelAccuracyFilter({
  selectedAccuracy,
  onSelectionChange,
  label = 'Result',
  className = '',
}: ModelAccuracyFilterProps) {
  // Native radios rather than role="radio" buttons: arrow-key navigation and
  // the single tab stop come for free, matching the <select> this replaced.
  const id = useId();

  return (
    <div className={className}>
      {label && (
        <span id={`${id}-label`} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </span>
      )}
      <div
        role="radiogroup"
        aria-labelledby={label ? `${id}-label` : undefined}
        className="flex flex-wrap gap-1.5"
      >
        {OPTIONS.map(option => {
          const selected = selectedAccuracy === option.value;
          const display = option.outcome ? OUTCOMES[option.outcome] : null;
          return (
            <label key={option.value} className="cursor-pointer">
              <input
                type="radio"
                name={id}
                value={option.value}
                checked={selected}
                onChange={() => onSelectionChange(option.value)}
                className="peer sr-only"
              />
              <span title={display?.title} className={chipClasses(selected)}>
                {display &&
                  (display.dotClass ? (
                    <span
                      aria-hidden
                      className={`h-2 w-2 flex-none rounded-full ${display.dotClass}`}
                    />
                  ) : (
                    <span aria-hidden className="text-signal">
                      ⚑
                    </span>
                  ))}
                {display && (
                  <span className="font-data font-semibold text-char">{display.code}</span>
                )}
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
