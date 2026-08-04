import { ModelAccuracyType, SequenceOutcome } from '@/utils/modelAccuracy';
import { OUTCOMES } from '@/components/sequences/outcomeDisplay';

interface ModelAccuracyFilterProps {
  selectedAccuracy: ModelAccuracyType | 'all';
  onSelectionChange: (accuracy: ModelAccuracyType | 'all') => void;
  label?: string;
  className?: string;
}

// Chip options in table-column order. `outcome` pulls the dot and code from
// OUTCOMES so the filter reads exactly like the Result column it filters.
const OPTIONS: Array<{
  value: ModelAccuracyType | 'all';
  label: string;
  outcome?: SequenceOutcome;
}> = [
  { value: 'all', label: 'All' },
  { value: 'true_positive', label: 'True positive', outcome: 'tp' },
  { value: 'false_positive', label: 'False positive', outcome: 'fp' },
  { value: 'false_negative', label: 'False negative', outcome: 'fn' },
];

// Selection is a darker border plus a tinted fill rather than a solid one:
// a filled chip would swallow the outcome dot, which is the whole point here.
const chipClasses = (selected: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors ${
    selected ? 'border-char bg-ash text-char' : 'border-line bg-paper text-haze hover:bg-ash'
  }`;

export default function ModelAccuracyFilter({
  selectedAccuracy,
  onSelectionChange,
  label = 'Result',
  className = '',
}: ModelAccuracyFilterProps) {
  return (
    <div className={className}>
      {label && <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {OPTIONS.map(option => {
          const selected = selectedAccuracy === option.value;
          const display = option.outcome ? OUTCOMES[option.outcome] : null;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={display?.title}
              onClick={() => onSelectionChange(option.value)}
              className={chipClasses(selected)}
            >
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
              {display && <span className="font-data font-semibold text-char">{display.code}</span>}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
