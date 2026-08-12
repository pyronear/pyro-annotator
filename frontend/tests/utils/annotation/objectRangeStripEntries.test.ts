import { describe, it, expect } from 'vitest';
import { buildRangeStripEntries } from '@/utils/annotation/objectRangeStripEntries';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';

const frame = (recordedAt: string, detectionId: number): AlertFrame => ({
  recordedAt,
  cells: [
    {
      laneSequenceId: 1,
      detectionId,
      cellState: 'auto',
      color: '#2a78d6',
      boxes: [],
    },
  ],
});

const FRAMES: AlertFrame[] = [
  frame('2026-08-11T12:00:00Z', 101),
  frame('2026-08-11T12:00:30Z', 102),
  frame('2026-08-11T12:01:00Z', 103),
  frame('2026-08-11T12:01:30Z', 104),
];

const SMALL: [number, number, number, number] = [0, 0, 0.2, 0.2];

describe('buildRangeStripEntries', () => {
  it('marks every frame out of range when no range is set yet', () => {
    const entries = buildRangeStripEntries(FRAMES, null, null);
    expect(entries).toHaveLength(4);
    expect(entries.every(e => !e.inRange)).toBe(true);
    expect(entries.every(e => !e.isAnchor)).toBe(true);
    expect(entries.every(e => e.xyxyn === null)).toBe(true);
  });

  it('borrows a sibling lane detection id for the photograph', () => {
    // The object being added has no lane of its own yet, so every frame's
    // image comes from whichever lane is already on that frame.
    expect(buildRangeStripEntries(FRAMES, null, null).map(e => e.detectionId)).toEqual([
      101, 102, 103, 104,
    ]);
  });

  it('flags the range and its two anchors', () => {
    const entries = buildRangeStripEntries(
      FRAMES,
      { firstRecordedAt: '2026-08-11T12:00:30Z', lastRecordedAt: '2026-08-11T12:01:00Z' },
      null
    );
    expect(entries.map(e => e.inRange)).toEqual([false, true, true, false]);
    expect(entries.map(e => e.isAnchor)).toEqual([false, true, true, false]);
  });

  it('flags interior frames as in range but not anchors', () => {
    const entries = buildRangeStripEntries(
      FRAMES,
      { firstRecordedAt: '2026-08-11T12:00:00Z', lastRecordedAt: '2026-08-11T12:01:30Z' },
      null
    );
    expect(entries.map(e => e.isAnchor)).toEqual([true, false, false, true]);
    expect(entries.every(e => e.inRange)).toBe(true);
  });

  it('leaves boxes null until both anchors are drawn', () => {
    const entries = buildRangeStripEntries(
      FRAMES,
      { firstRecordedAt: '2026-08-11T12:00:00Z', lastRecordedAt: '2026-08-11T12:01:30Z' },
      null
    );
    expect(entries.every(e => e.xyxyn === null)).toBe(true);
  });

  it('puts the box on every in-range frame, and none outside it', () => {
    const entries = buildRangeStripEntries(
      FRAMES,
      { firstRecordedAt: '2026-08-11T12:00:00Z', lastRecordedAt: '2026-08-11T12:01:00Z' },
      SMALL
    );
    // The box drawn on the first frame, copied across the range.
    expect(entries[0].xyxyn).toEqual(SMALL);
    expect(entries[1].xyxyn).toEqual(SMALL);
    expect(entries[2].xyxyn).toEqual(SMALL);
    // Out of range: nothing to draw, and the thumbnail stays uncropped.
    expect(entries[3].xyxyn).toBeNull();
  });

  it('handles a one-frame range', () => {
    const entries = buildRangeStripEntries(
      FRAMES,
      { firstRecordedAt: '2026-08-11T12:00:30Z', lastRecordedAt: '2026-08-11T12:00:30Z' },
      SMALL
    );
    expect(entries[1].xyxyn).toEqual(SMALL);
    expect(entries[1].isAnchor).toBe(true);
    expect(entries.filter(e => e.inRange)).toHaveLength(1);
  });

  it('survives a frame no lane is on', () => {
    // Defensive: a frame with no cells has no photograph to borrow.
    const entries = buildRangeStripEntries([{ recordedAt: '2026-08-11T12:00:00Z', cells: [] }], null, null);
    expect(entries[0].detectionId).toBe(-1);
  });
});
