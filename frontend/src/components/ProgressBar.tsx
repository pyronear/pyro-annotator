interface ProgressBarProps {
  /** Current progress value (0-100) */
  value: number;
  /** Maximum value (defaults to 100) */
  max?: number;
  /** Height of the progress bar in pixels */
  height?: number;
  /** Color theme for the progress bar */
  color?: 'primary' | 'green' | 'orange' | 'red';
  /** Show percentage text inside the bar */
  showPercentage?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Accessibility label */
  ariaLabel?: string;
}

export default function ProgressBar({
  value,
  max = 100,
  height = 24,
  color = 'primary',
  showPercentage = true,
  className = '',
  ariaLabel,
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;

  const colorClasses = {
    primary: 'bg-primary-600',
    green: 'bg-green-600',
    orange: 'bg-orange-600',
    red: 'bg-red-600',
  };

  const backgroundColorClasses = {
    primary: 'bg-primary-100',
    green: 'bg-green-100',
    orange: 'bg-orange-100',
    red: 'bg-red-100',
  };

  return (
    <div
      className={`relative w-full rounded-full overflow-hidden ${backgroundColorClasses[color]} ${className}`}
      style={{ height: `${height}px` }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel || `Progress: ${Math.round(percentage)}%`}
    >
      {/* Progress fill */}
      <div
        className={`h-full ${colorClasses[color]} transition-all duration-500 ease-out`}
        style={{ width: `${percentage}%` }}
      />

      {/* Percentage text overlay */}
      {showPercentage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`text-xs font-medium px-1.5 py-0.5 rounded text-shadow-sm ${
              percentage < 50 ? 'text-gray-800 bg-white/40' : 'text-white bg-black/20'
            }`}
          >
            {Math.round(percentage)}%
          </span>
        </div>
      )}
    </div>
  );
}

interface MultiStageProgressBarProps {
  /** Array of stage data with colors and values */
  stages: Array<{
    label: string;
    value: number;
    color: 'primary' | 'green' | 'orange' | 'red' | 'gray';
  }>;
  /** Total value for calculating percentages */
  total: number;
  /** Height of the progress bar in pixels */
  height?: number;
  /** Show labels below the bar */
  showLabels?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function MultiStageProgressBar({
  stages,
  total,
  height = 32,
  showLabels = true,
  className = '',
}: MultiStageProgressBarProps) {
  const colorClasses = {
    primary: 'bg-primary-600',
    green: 'bg-green-600',
    orange: 'bg-orange-600',
    red: 'bg-red-600',
    gray: 'bg-gray-400',
  };

  return (
    <div className={className}>
      {/* Multi-segment progress bar */}
      <div
        className="relative w-full rounded-full overflow-hidden bg-gray-100"
        style={{ height: `${height}px` }}
        role="progressbar"
        aria-label={`Multi-stage progress: ${stages.map(s => `${s.label}: ${s.value}`).join(', ')}`}
      >
        {stages.map((stage, index) => {
          const stagePercentage = total > 0 ? (stage.value / total) * 100 : 0;
          const leftPosition = stages.slice(0, index).reduce((sum, s) => {
            return sum + (total > 0 ? (s.value / total) * 100 : 0);
          }, 0);

          return stagePercentage > 0 ? (
            <div
              key={stage.label}
              className={`absolute h-full ${colorClasses[stage.color]} transition-all duration-500 ease-out`}
              style={{
                left: `${leftPosition}%`,
                width: `${stagePercentage}%`,
              }}
            />
          ) : null;
        })}
      </div>

      {/* Stage labels */}
      {showLabels && (
        <div className="flex justify-between mt-2 text-xs text-gray-600">
          {stages.map(stage => (
            <div key={stage.label} className="flex items-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${colorClasses[stage.color]}`} />
              <span className="capitalize">
                {stage.label.replace('_', ' ')}: {stage.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
