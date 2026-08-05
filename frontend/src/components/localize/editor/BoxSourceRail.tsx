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
import { Pencil, Eraser } from 'lucide-react';
import type { BoxCandidate } from '@/utils/annotation/objectBoxCandidates';
import { computeSquareCrop } from '@/utils/annotation/squareCropUtils';
import { SOURCE_COLOR, SOURCE_LABEL, SOURCE_ORDER } from './sourceIdentity';

const CROP_RES = 128;

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
      ctx.strokeStyle = SOURCE_COLOR[candidate.source];
      ctx.lineWidth = 3;
      ctx.strokeRect(
        toX(candidate.xyxyn[0]),
        toY(candidate.xyxyn[1]),
        toX(candidate.xyxyn[2]) - toX(candidate.xyxyn[0]),
        toY(candidate.xyxyn[3]) - toY(candidate.xyxyn[1])
      );
    };
    img.src = imageUrl;
  }, [imageUrl, region, candidate]);

  if (!candidate) return <span className="h-11 w-14 flex-none rounded bg-white/5" />;
  return (
    <canvas
      ref={canvasRef}
      width={CROP_RES}
      height={CROP_RES}
      className="h-11 w-14 flex-none rounded"
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
    <div className="w-56 flex-none border-l border-white/10 p-3 text-white">
      <p className="mb-2 text-[9px] uppercase tracking-[0.1em] text-white/50">Box for this frame</p>

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
            className={`mb-1.5 flex w-full items-center gap-2 rounded-md border p-1.5 text-left transition-colors ${
              isCommitted ? 'border-[#5bbf8f] bg-[#5bbf8f]/10' : 'border-transparent'
            } ${candidate ? 'hover:bg-white/5' : 'opacity-35'}`}
          >
            <CandidateCrop imageUrl={imageUrl} region={region} candidate={candidate} />
            <span>
              <span className="block text-[11.5px] font-semibold">
                <span style={{ color: SOURCE_COLOR[source] }}>●</span> {SOURCE_LABEL[source]}
                {isCommitted && <span className="ml-1.5 text-[#5bbf8f]">✓</span>}
              </span>
              <span className="block text-[9.5px] text-white/50">
                {!candidate
                  ? '—'
                  : candidate.confidence !== undefined
                    ? `conf ${candidate.confidence.toFixed(2).replace(/^0/, '')}`
                    : 'drawn'}
              </span>
            </span>
          </button>
        );
      })}

      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          data-testid="editor-draw"
          disabled={disabled}
          onClick={onDraw}
          className="inline-flex items-center gap-1 rounded-md bg-[#f0a24b] px-2.5 py-1.5 text-[10.5px] font-semibold text-char hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:opacity-30"
        >
          <Pencil className="h-3 w-3" /> Draw
        </button>
        <button
          type="button"
          data-testid="editor-clear"
          disabled={disabled || !committed}
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10.5px] font-medium hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:opacity-30"
        >
          <Eraser className="h-3 w-3" /> Clear
        </button>
      </div>

      <p className="mt-2.5 text-[9.5px] leading-relaxed text-white/40">
        Drawing replaces whatever is committed — one box per frame, per object.
      </p>
    </div>
  );
}
