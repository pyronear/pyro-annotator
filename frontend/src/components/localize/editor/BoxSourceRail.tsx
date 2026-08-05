/**
 * The object editor's source rail: one row per candidate box, in priority
 * order (manual > auto > engine), each showing the SAME cropped region of the
 * frame with that candidate's box drawn on it. Sharing the region is what
 * makes "auto is tight, engine is baggy" readable — a per-row region would
 * make the rows incomparable.
 *
 * Rows for sources with no box still render (disabled), so the rail's shape
 * doesn't jump as you step frames.
 */

import { useEffect, useRef } from 'react';
import { Pencil, Eraser, Check } from 'lucide-react';
import type { BoxCandidate } from '@/utils/annotation/objectBoxCandidates';
import { computeSquareCrop } from '@/utils/annotation/squareCropUtils';
import { SOURCE_COLOR, SOURCE_LABEL, SOURCE_ORDER } from './sourceIdentity';

const CROP_RES = 128;
/**
 * One stroke weight for every row, in the crop's own 128px space (it renders
 * at ~44px, so this lands near 2 display px).
 *
 * Deliberately NOT the stage's `SOURCE_WEIGHT` ladder: scaled down by 0.35 its
 * thinnest rung falls under one display pixel and antialiases into a pale
 * line, so engine — always the lowest-confidence row — looked like it was
 * being faded by its confidence. The ladder communicates on the full-size
 * stage; here it only costs legibility, and the row's label and swatch
 * already say which source this is.
 */
const CROP_STROKE = 5;

export interface BoxSourceRailProps {
  candidates: BoxCandidate[];
  committed: BoxCandidate | null;
  /** URL of the frame image, or null while it loads. */
  imageUrl: string | null;
  /** True on a frame outside the object's range: view only. */
  disabled: boolean;
  onCommit: (candidate: BoxCandidate) => void;
  onDraw: () => void;
  onClear: () => void;
}

/** The union of every candidate box — one region shared by all rows. */
function unionBox(candidates: BoxCandidate[]): [number, number, number, number] | null {
  if (candidates.length === 0) return null;
  let x1 = 1;
  let y1 = 1;
  let x2 = 0;
  let y2 = 0;
  for (const c of candidates) {
    x1 = Math.min(x1, c.xyxyn[0]);
    y1 = Math.min(y1, c.xyxyn[1]);
    x2 = Math.max(x2, c.xyxyn[2]);
    y2 = Math.max(y2, c.xyxyn[3]);
  }
  return [x1, y1, x2, y2];
}

function CandidateCrop({
  imageUrl,
  region,
  candidate,
}: {
  imageUrl: string | null;
  region: [number, number, number, number] | null;
  candidate: BoxCandidate | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl || !region || !candidate) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const crop = computeSquareCrop(region, img.width, img.height, 1);
      ctx.clearRect(0, 0, CROP_RES, CROP_RES);
      ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, CROP_RES, CROP_RES);
      // The candidate's box, in the crop's own coordinates.
      const toX = (n: number) => ((n * img.width - crop.x) / crop.size) * CROP_RES;
      const toY = (n: number) => ((n * img.height - crop.y) / crop.size) * CROP_RES;
      const x = toX(candidate.xyxyn[0]);
      const y = toY(candidate.xyxyn[1]);
      const w = toX(candidate.xyxyn[2]) - x;
      const h = toY(candidate.xyxyn[3]) - y;
      // Dark halo first, colour over it — the same trick the stage uses, so a
      // bright stroke stays visible against a bright sky.
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = CROP_STROKE + 3;
      ctx.strokeRect(x, y, w, h);
      ctx.strokeStyle = SOURCE_COLOR[candidate.source];
      ctx.lineWidth = CROP_STROKE;
      ctx.strokeRect(x, y, w, h);
    };
    img.src = imageUrl;
  }, [imageUrl, region, candidate]);

  if (!candidate) return <span className="h-11 w-14 flex-none rounded border border-line bg-ash" />;
  return (
    <canvas
      ref={canvasRef}
      width={CROP_RES}
      height={CROP_RES}
      className="h-11 w-14 flex-none rounded border border-line"
      data-testid={`source-crop-${candidate.source}`}
    />
  );
}

export function BoxSourceRail({
  candidates,
  committed,
  imageUrl,
  disabled,
  onCommit,
  onDraw,
  onClear,
}: BoxSourceRailProps) {
  const region = unionBox(candidates);

  return (
    <div className="w-60 flex-none overflow-y-auto border-l border-line bg-paper p-4">
      <p className="mb-2.5 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
        Box for this frame
      </p>

      {SOURCE_ORDER.map(source => {
        const candidate = candidates.find(c => c.source === source);
        const isCommitted = committed?.source === source;
        return (
          <button
            key={source}
            type="button"
            data-testid={`source-row-${source}`}
            aria-pressed={isCommitted}
            disabled={disabled || !candidate || isCommitted}
            onClick={() => candidate && !isCommitted && onCommit(candidate)}
            className={`mb-1.5 flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors ${
              isCommitted ? 'border-pine bg-pine-soft' : 'border-transparent'
            } ${candidate && !isCommitted ? 'hover:bg-ash' : ''} ${candidate ? '' : 'opacity-40'}`}
          >
            <CandidateCrop imageUrl={imageUrl} region={region} candidate={candidate} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-body text-sm font-medium text-char">
                <span
                  aria-hidden
                  className="h-3 w-3 flex-none rounded-sm border border-char/25"
                  style={{ backgroundColor: SOURCE_COLOR[source] }}
                />
                {SOURCE_LABEL[source]}
                {isCommitted && <Check className="h-3.5 w-3.5 text-pine" />}
              </span>
              <span className="block font-data text-detail text-haze">
                {!candidate
                  ? 'no box'
                  : candidate.confidence !== undefined
                    ? `${(candidate.confidence * 100).toFixed(0)}% confident`
                    : 'you drew this'}
              </span>
            </span>
          </button>
        );
      })}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="editor-draw"
          disabled={disabled}
          onClick={onDraw}
          className="inline-flex items-center gap-1.5 rounded-lg bg-pine px-3 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-40"
        >
          <Pencil className="h-3.5 w-3.5" /> Draw
        </button>
        <button
          type="button"
          data-testid="editor-clear"
          disabled={disabled || !committed}
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" /> Clear
        </button>
      </div>

      <p className="mt-3 font-body text-detail leading-relaxed text-haze">
        Drawing replaces the box on this frame. Each object carries one box per frame.
      </p>
    </div>
  );
}
