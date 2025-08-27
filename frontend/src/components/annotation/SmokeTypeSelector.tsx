/**
 * Reusable smoke type selector component for annotation interface.
 * Handles both default smoke type selection and selected rectangle smoke type changes.
 */

import { SmokeType } from '@/types/api';

export interface SmokeTypeSelectorProps {
  /** Currently selected smoke type (for new rectangles or default) */
  selectedSmokeType: SmokeType;
  /** Smoke type of the currently selected rectangle (if any) */
  selectedRectangleSmokeType?: SmokeType;
  /** Whether a rectangle is currently selected */
  hasSelectedRectangle: boolean;
  /** Handler for changing default smoke type */
  onSmokeTypeChange: (smokeType: SmokeType) => void;
  /** Handler for changing selected rectangle's smoke type */
  onSelectedRectangleSmokeTypeChange?: (smokeType: SmokeType) => void;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

const SMOKE_TYPES: readonly SmokeType[] = ['wildfire', 'industrial', 'other'] as const;

const SMOKE_TYPE_DISPLAY = {
  wildfire: { emoji: '🔥', label: 'Wildfire', shortcut: '1/W' },
  industrial: { emoji: '🏭', label: 'Industrial', shortcut: '2/I' },
  other: { emoji: '💨', label: 'Other', shortcut: '3/O' }
} as const;

const SMOKE_TYPE_COLORS = {
  wildfire: {
    active: 'bg-red-500 text-white',
    inactive: 'text-red-300 hover:bg-red-500 hover:bg-opacity-20'
  },
  industrial: {
    active: 'bg-purple-500 text-white', 
    inactive: 'text-purple-300 hover:bg-purple-500 hover:bg-opacity-20'
  },
  other: {
    active: 'bg-blue-500 text-white',
    inactive: 'text-blue-300 hover:bg-blue-500 hover:bg-opacity-20'
  }
} as const;

const SIZE_CLASSES = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-1 text-xs',
  lg: 'px-3 py-1.5 text-sm'
} as const;

/**
 * Pure smoke type selector component following functional programming principles.
 * 
 * @example
 * ```typescript
 * <SmokeTypeSelector
 *   selectedSmokeType="wildfire"
 *   selectedRectangleSmokeType="industrial"
 *   hasSelectedRectangle={true}
 *   onSmokeTypeChange={(type) => setDefaultSmokeType(type)}
 *   onSelectedRectangleSmokeTypeChange={(type) => updateRectangle(type)}
 * />
 * ```
 */
export const SmokeTypeSelector: React.FC<SmokeTypeSelectorProps> = ({
  selectedSmokeType,
  selectedRectangleSmokeType,
  hasSelectedRectangle,
  onSmokeTypeChange,
  onSelectedRectangleSmokeTypeChange,
  className = '',
  size = 'md'
}) => {
  const handleSmokeTypeClick = (smokeType: SmokeType) => {
    if (hasSelectedRectangle && onSelectedRectangleSmokeTypeChange) {
      // Update selected rectangle's smoke type
      onSelectedRectangleSmokeTypeChange(smokeType);
    } else {
      // Update default smoke type
      onSmokeTypeChange(smokeType);
    }
  };

  return (
    <div className={`flex items-center space-x-1 bg-white bg-opacity-10 backdrop-blur-sm rounded-md p-1 ${className}`}>
      {SMOKE_TYPES.map((smokeType) => {
        // Determine if this smoke type is selected
        const isSelected = hasSelectedRectangle 
          ? selectedRectangleSmokeType === smokeType
          : selectedSmokeType === smokeType;
        
        const display = SMOKE_TYPE_DISPLAY[smokeType];
        const colors = SMOKE_TYPE_COLORS[smokeType];
        const sizeClass = SIZE_CLASSES[size];
        
        return (
          <button
            key={smokeType}
            onClick={() => handleSmokeTypeClick(smokeType)}
            className={`${sizeClass} font-medium rounded transition-colors ${
              isSelected 
                ? colors.active
                : `${colors.inactive} text-white`
            }`}
            title={`${display.label} smoke (${display.shortcut})`}
            type="button"
          >
            {display.emoji} {display.label}
          </button>
        );
      })}
    </div>
  );
};