/**
 * Compact view controls for the detection grid: S/M/L card size plus icon
 * toggles for predictions, crop mode, and the cropped flipbook. One shared
 * button style — the header and flipbook speak the same visual language.
 */

import { Crop, Eye, Film } from 'lucide-react';

export type CardSize = 'sm' | 'md' | 'lg';

const CARD_SIZES: { value: CardSize; label: string; title: string }[] = [
  { value: 'sm', label: 'S', title: 'Small cards' },
  { value: 'md', label: 'M', title: 'Medium cards' },
  { value: 'lg', label: 'L', title: 'Large cards' },
];

interface ViewToolbarProps {
  cardSize: CardSize;
  onCardSizeChange: (size: CardSize) => void;
  showPredictions: boolean;
  onTogglePredictions: (show: boolean) => void;
  isLocalize?: boolean;
  cropMode?: boolean;
  onToggleCropMode?: (crop: boolean) => void;
  showCroppedView?: boolean;
  onToggleCroppedView?: (show: boolean) => void;
}

function IconToggle({
  title,
  pressed,
  onClick,
  children,
}: {
  title: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={`p-1.5 rounded ${
        pressed ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  );
}

export function ViewToolbar({
  cardSize,
  onCardSizeChange,
  showPredictions,
  onTogglePredictions,
  isLocalize = false,
  cropMode = false,
  onToggleCropMode,
  showCroppedView = false,
  onToggleCroppedView,
}: ViewToolbarProps) {
  return (
    <div className="inline-flex items-center rounded-md bg-gray-200 p-0.5 gap-0.5">
      {CARD_SIZES.map(s => (
        <button
          key={s.value}
          type="button"
          title={s.title}
          aria-pressed={cardSize === s.value}
          onClick={() => onCardSizeChange(s.value)}
          className={`px-2 py-0.5 rounded text-xs font-semibold ${
            cardSize === s.value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {s.label}
        </button>
      ))}
      <div className="w-px self-stretch bg-gray-300 mx-0.5" />
      <IconToggle
        title="Show predictions (P)"
        pressed={showPredictions}
        onClick={() => onTogglePredictions(!showPredictions)}
      >
        <Eye className="w-3.5 h-3.5" />
      </IconToggle>
      {isLocalize && (
        <>
          <IconToggle
            title="Crop cells (C)"
            pressed={cropMode}
            onClick={() => onToggleCropMode?.(!cropMode)}
          >
            <Crop className="w-3.5 h-3.5" />
          </IconToggle>
          <IconToggle
            title="Cropped view"
            pressed={showCroppedView}
            onClick={() => onToggleCroppedView?.(!showCroppedView)}
          >
            <Film className="w-3.5 h-3.5" />
          </IconToggle>
        </>
      )}
    </div>
  );
}
