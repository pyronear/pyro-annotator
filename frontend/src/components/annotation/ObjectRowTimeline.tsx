/**
 * The per-frame timeline strip shared by the rails' object rows (localize's
 * `LocalizeObjectRow`, classify's `ObjectRow`): one clickable segment button
 * per alert frame, shaped by that frame's `ObjectFrameStatus` — `confirmed`
 * (solid fill in the object's color), `pending` (faded fill), `empty`
 * (outline only), `absent` (neutral track showing through). Extracted from
 * `LocalizeObjectRow`, which owned the markup first; the testids are
 * unchanged so no test had to move.
 *
 * Segment clicks stop propagation: classify's row is itself a clickable
 * container, and without the stop a segment click would re-fire the row's
 * own activation handler.
 *
 * `highlightIndex` pulses one segment — classify's click-to-seek feedback,
 * mirroring the player's hold on that frame. The ring is inset because the
 * track's `overflow-hidden` would clip an outer one; the caller owns
 * clearing the index, the strip only renders it.
 */

import React from 'react';
import type { ObjectFrameStatus } from '@/utils/annotation/alertLocalizeUtils';

const SEGMENT_BASE_CLASS =
  'h-full flex-1 rounded-sm p-0 transition-opacity focus:outline-none focus:ring-1 focus:ring-ember';

function segmentAppearance(
  status: ObjectFrameStatus,
  color: string
): { className: string; style?: React.CSSProperties } {
  if (status === 'confirmed') {
    return { className: SEGMENT_BASE_CLASS, style: { backgroundColor: color } };
  }
  if (status === 'pending') {
    return { className: `${SEGMENT_BASE_CLASS} opacity-40`, style: { backgroundColor: color } };
  }
  if (status === 'empty') {
    // Present on this frame, but nothing to show yet — no committed box and
    // no model prediction to accept. An outline in the object's own color
    // keeps it legible as "this object's frame" without the fill that would
    // imply content (a just-added object's whole timeline is this state).
    return {
      className: `${SEGMENT_BASE_CLASS} opacity-50`,
      style: { boxShadow: `inset 0 0 0 1px ${color}` },
    };
  }
  // absent — neutral track, no fill; the strip's track background shows through.
  return { className: SEGMENT_BASE_CLASS };
}

export interface ObjectRowTimelineProps {
  /** Testid slug: root `object-timeline-${slug}`, segments `frame-segment-${slug}-${i}`. */
  slug: string;
  /** Accessible-name prefix — "Object 2, frame 3: confirmed". */
  label: string;
  /** The object's own color (hex) — segment fills match its dot and box color. */
  color: string;
  /** The alert-wide ordered frame axis — identical for every row, so frame N aligns across objects. */
  frameTimestamps: string[];
  /** This object's status per frame timestamp; frames missing from the map render as `absent`. */
  statusByTimestamp: Record<string, ObjectFrameStatus>;
  onFrameClick: (timestamp: string, frameIndex: number) => void;
  /** Segment to pulse (click-to-seek feedback); null/omit for none. */
  highlightIndex?: number | null;
}

export function ObjectRowTimeline({
  slug,
  label,
  color,
  frameTimestamps,
  statusByTimestamp,
  onFrameClick,
  highlightIndex = null,
}: ObjectRowTimelineProps) {
  return (
    <div
      data-testid={`object-timeline-${slug}`}
      className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-ash"
    >
      {frameTimestamps.map((timestamp, frameIndex) => {
        const segmentStatus = statusByTimestamp[timestamp] ?? 'absent';
        const { className, style } = segmentAppearance(segmentStatus, color);
        const highlighted = highlightIndex === frameIndex;
        return (
          <button
            key={timestamp}
            type="button"
            data-testid={`frame-segment-${slug}-${frameIndex}`}
            aria-label={`${label}, frame ${frameIndex + 1}: ${segmentStatus}`}
            onClick={e => {
              e.stopPropagation();
              onFrameClick(timestamp, frameIndex);
            }}
            className={
              highlighted ? `${className} animate-pulse ring-2 ring-inset ring-ember` : className
            }
            style={style}
          />
        );
      })}
    </div>
  );
}
