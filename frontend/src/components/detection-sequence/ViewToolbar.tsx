/**
 * Compact view controls for the detection grid: S/M/L card size plus icon
 * toggles for predictions, crop mode, and the cropped flipbook. One shared
 * button style — the header and flipbook speak the same visual language.
 *
 * The predictions toggle is opt-in (`onTogglePredictions`): it drives
 * `DetectionGrid`'s overlays on the legacy per-lane page, but `AlertFrameGrid`
 * on the collocated localize screen never reads `showPredictions`, so the
 * cockpit omits it rather than showing a control that moves nothing on
 * screen.
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
  showPredictions?: boolean;
  /** Omit to hide the predictions toggle entirely (see the note above). */
  onTogglePredictions?: (show: boolean) => void;
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
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded p-1.5 transition-colors ${
        pressed ? 'bg-paper text-char' : 'text-haze hover:text-char'
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
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-ash p-0.5">
      {CARD_SIZES.map(s => (
        <button
          key={s.value}
          type="button"
          title={s.title}
          aria-pressed={cardSize === s.value}
          onClick={() => onCardSizeChange(s.value)}
          className={`rounded px-2 py-0.5 font-body text-xs font-semibold transition-colors ${
            cardSize === s.value ? 'bg-paper text-char' : 'text-haze hover:text-char'
          }`}
        >
          {s.label}
        </button>
      ))}
      <div className="mx-0.5 w-px self-stretch bg-line" />
      {onTogglePredictions && (
        <IconToggle
          title="Show predictions (P)"
          pressed={showPredictions ?? false}
          onClick={() => onTogglePredictions(!showPredictions)}
        >
          <Eye className="w-3.5 h-3.5" />
        </IconToggle>
      )}
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
