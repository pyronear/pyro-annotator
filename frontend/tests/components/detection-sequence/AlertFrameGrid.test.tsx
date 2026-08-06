/**
 * The grid's cleared markers: a lane committed on a frame with zero smoke
 * boxes gets an eye-off corner chip — otherwise a cleared cell is
 * indistinguishable from one whose box simply isn't drawn.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertFrameGrid } from '@/components/detection-sequence/AlertFrameGrid';
import type { AlertFrame, AlertFrameCell } from '@/utils/annotation/alertLocalizeUtils';

vi.mock('@/hooks/useDetectionImage', () => ({
  useDetectionImage: () => ({ data: { url: 'https://img.example/1.jpg' }, isLoading: false }),
}));

const T1 = '2026-01-01T00:00:00Z';
const T2 = '2026-01-01T00:01:00Z';

const cell = (over: Partial<AlertFrameCell>): AlertFrameCell => ({
  laneSequenceId: 1,
  detectionId: 11,
  cellState: 'auto',
  boxes: [],
  color: '#166A5D',
  ...over,
});

describe('AlertFrameGrid cleared markers', () => {
  it('marks a committed boxless cell with an eye-off chip in the lane color', () => {
    const frames: AlertFrame[] = [
      { recordedAt: T1, cells: [cell({ cellState: 'done' })] },
      {
        recordedAt: T2,
        cells: [
          cell({
            detectionId: 12,
            cellState: 'done',
            boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2], color: '#166A5D' }],
          }),
        ],
      },
    ];

    render(<AlertFrameGrid frames={frames} activeLaneId={1} onCellClick={() => {}} />);

    expect(screen.getByTestId(`alert-frame-cleared-${T1}-1`)).toBeInTheDocument();
    expect(screen.queryByTestId(`alert-frame-cleared-${T2}-1`)).toBeNull();
  });

  it('never marks pending or false-positive cells', () => {
    const frames: AlertFrame[] = [
      { recordedAt: T1, cells: [cell({ cellState: 'auto' })] },
      {
        recordedAt: T2,
        cells: [cell({ detectionId: 12, cellState: 'done', isFalsePositive: true })],
      },
    ];

    render(<AlertFrameGrid frames={frames} activeLaneId={1} onCellClick={() => {}} />);

    expect(screen.queryByTestId(`alert-frame-cleared-${T1}-1`)).toBeNull();
    expect(screen.queryByTestId(`alert-frame-cleared-${T2}-1`)).toBeNull();
  });
});
