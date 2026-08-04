/**
 * Compact view controls for the collocated localize screen's frame grid:
 * S/M/L card size plus icon toggles for crop mode and the cropped flipbook.
 * One shared button style — the header and flipbook speak the same visual
 * language.
 *
 * The pressed state is pine-on-pine-soft rather than the old white pill: the
 * toolbar moved onto a white control panel, where "white pill on a pale ash
 * track" was two near-identical neutrals and you could no longer tell which
 * size was selected. Soft rather than a solid fill, so a view preference
 * doesn't shout as loudly as the actions beside it.
 *
 * It used to carry a predictions toggle and an `isLocalize` switch, both for
 * the legacy per-lane page's `DetectionGrid`. That page is gone, and
 * `AlertFrameGrid` never read `showPredictions` (only `ImageModal` does, and
 * it owns its own toggle), so both went with it rather than lingering as
 * controls that move nothing on screen.
 */

import { Crop, Film } from 'lucide-react';

export type CardSize = 'sm' | 'md' | 'lg';

const CARD_SIZES: { value: CardSize; label: string; title: string }[] = [
  { value: 'sm', label: 'S', title: 'Small cards' },
  { value: 'md', label: 'M', title: 'Medium cards' },
  { value: 'lg', label: 'L', title: 'Large cards' },
];

interface ViewToolbarProps {
  cardSize: CardSize;
  onCardSizeChange: (size: CardSize) => void;
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
        pressed ? 'bg-pine-soft text-pine' : 'text-haze hover:text-char'
      }`}
    >
      {children}
    </button>
  );
}

export function ViewToolbar({
  cardSize,
  onCardSizeChange,
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
            cardSize === s.value ? 'bg-pine-soft text-pine' : 'text-haze hover:text-char'
          }`}
        >
          {s.label}
        </button>
      ))}
      <div className="mx-0.5 w-px self-stretch bg-line" />
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
    </div>
  );
}
