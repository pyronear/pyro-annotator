import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObjectRangeStrip } from '@/components/localize/add-object/ObjectRangeStrip';
import type { RangeStripEntry } from '@/utils/annotation/objectRangeStripEntries';

// The thumbnails draw imperatively onto a canvas jsdom does not implement,
// and fetch their image through the detection-image query. Neither is what
// these tests are about — they assert on range membership, anchors and
// selection.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
});

vi.mock('@/services/api', () => ({
  apiClient: { getDetectionImageUrl: vi.fn(() => Promise.resolve('blob:image')) },
}));

const entry = (over: Partial<RangeStripEntry> & { recordedAt: string }): RangeStripEntry => ({
  detectionId: 1,
  inRange: false,
  isAnchor: false,
  xyxyn: null,
  ...over,
});

const ENTRIES: RangeStripEntry[] = [
  entry({ recordedAt: '2026-08-11T12:00:00Z', detectionId: 101 }),
  entry({ recordedAt: '2026-08-11T12:00:30Z', detectionId: 102, inRange: true, isAnchor: true }),
  entry({ recordedAt: '2026-08-11T12:01:00Z', detectionId: 103, inRange: true }),
  entry({ recordedAt: '2026-08-11T12:01:30Z', detectionId: 104, inRange: true, isAnchor: true }),
];

function renderStrip(props: Partial<React.ComponentProps<typeof ObjectRangeStrip>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ObjectRangeStrip
        entries={ENTRIES}
        currentRecordedAt="2026-08-11T12:00:30Z"
        objectColor="#1baf7a"
        onSelect={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('ObjectRangeStrip', () => {
  it('renders one cell per alert frame, in range or not', () => {
    renderStrip();
    expect(screen.getAllByTestId(/^range-strip-cell-/)).toHaveLength(4);
  });

  it('marks in-range, anchor and current cells so each is addressable', () => {
    renderStrip({ currentRecordedAt: '2026-08-11T12:01:00Z' });
    const out = screen.getByTestId('range-strip-cell-2026-08-11T12:00:00Z');
    const anchor = screen.getByTestId('range-strip-cell-2026-08-11T12:00:30Z');
    const interior = screen.getByTestId('range-strip-cell-2026-08-11T12:01:00Z');

    expect(out).not.toHaveAttribute('data-in-range');
    expect(out).not.toHaveAttribute('data-anchor');

    expect(anchor).toHaveAttribute('data-in-range', 'true');
    expect(anchor).toHaveAttribute('data-anchor', 'true');

    // In the range but not an end of it: no anchor weight, and it is the
    // frame currently on the stage.
    expect(interior).toHaveAttribute('data-in-range', 'true');
    expect(interior).not.toHaveAttribute('data-anchor');
    expect(interior).toHaveAttribute('data-current', 'true');
  });

  it('marks only one cell as current', () => {
    renderStrip();
    expect(screen.getAllByTestId(/^range-strip-cell-/).filter(
      el => el.getAttribute('data-current') === 'true'
    )).toHaveLength(1);
  });

  it('reports the clicked entry', async () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });
    fireEvent.click(screen.getByTestId('range-strip-cell-2026-08-11T12:01:00Z'));
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[2]);
  });

  it('lets an out-of-range cell be clicked, so the range can be widened', () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });
    fireEvent.click(screen.getByTestId('range-strip-cell-2026-08-11T12:00:00Z'));
    expect(onSelect).toHaveBeenCalledWith(ENTRIES[0]);
  });

  it('names each cell by its clock time for screen readers', () => {
    renderStrip();
    // Rendered through utils/datetime, which is viewer-local: assert the
    // label exists per cell rather than pinning a timezone-dependent string.
    expect(screen.getAllByRole('button', { name: /^Frame at / })).toHaveLength(4);
  });
});
