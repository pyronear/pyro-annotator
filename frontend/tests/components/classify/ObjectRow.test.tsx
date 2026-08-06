import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectRow, getObjectRowStatus } from '@/components/classify';
import type { SequenceBbox } from '@/types/api';

const baseBbox: SequenceBbox = { is_smoke: false, false_positive_types: [], bboxes: [] };

function renderRow(overrides: Partial<React.ComponentProps<typeof ObjectRow>> = {}) {
  const onRowClick = vi.fn();
  render(
    <ObjectRow
      objectNumber={1}
      cardKey="101:0"
      color="#E4572E"
      bbox={baseBbox}
      classification="unselected"
      unsure={false}
      isActive={false}
      locked={false}
      onRowClick={onRowClick}
      onBboxChange={vi.fn()}
      onClassificationChange={vi.fn()}
      onUnsureChange={vi.fn()}
      {...overrides}
    />
  );
  return { onRowClick };
}

describe('getObjectRowStatus', () => {
  it('maps states to labels and tones', () => {
    expect(
      getObjectRowStatus({ bbox: baseBbox, classification: 'unselected', unsure: false })
    ).toEqual({ label: 'Pending', tone: 'pending' });
    expect(
      getObjectRowStatus({
        bbox: { ...baseBbox, is_smoke: true, smoke_type: 'wildfire' },
        classification: 'smoke',
        unsure: false,
      })
    ).toEqual({ label: 'Smoke · Wildfire', tone: 'positive' });
    expect(
      getObjectRowStatus({
        bbox: { ...baseBbox, is_smoke: true },
        classification: 'smoke',
        unsure: false,
      })
    ).toEqual({ label: 'Type needed', tone: 'pending' });
    expect(
      getObjectRowStatus({
        bbox: { ...baseBbox, false_positive_types: ['high_cloud', 'sky'] },
        classification: 'false_positive',
        unsure: false,
      })
    ).toEqual({ label: 'FP · High cloud +1', tone: 'neutral' });
    expect(
      getObjectRowStatus({ bbox: baseBbox, classification: 'unselected', unsure: true })
    ).toEqual({ label: 'Unsure', tone: 'unsure' });
  });
});

describe('ObjectRow', () => {
  it('collapsed row shows name + status chip and no chips', () => {
    renderRow();
    expect(screen.getByText('Object 1')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Smoke' })).not.toBeInTheDocument();
  });

  it('active unlocked row renders classification chips', () => {
    renderRow({ isActive: true });
    expect(screen.getByRole('radio', { name: 'Smoke' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'False positive' })).toBeInTheDocument();
  });

  it('locked row never renders chips, even when active, but still activates on click (to view its media)', () => {
    const { onRowClick } = renderRow({
      locked: true,
      isActive: true,
      stageBadge: 'Fully annotated',
      bbox: { ...baseBbox, is_smoke: true, smoke_type: 'wildfire' },
      classification: 'smoke',
    });
    expect(screen.queryByRole('radio', { name: 'Smoke' })).not.toBeInTheDocument();
    // Stage badge AND the data-derived classification summary both render.
    expect(screen.getByText('Fully annotated')).toBeInTheDocument();
    expect(screen.getByText('Smoke · Wildfire')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('object-card-101:0'));
    expect(onRowClick).toHaveBeenCalledWith('101:0');
  });

  it('click activates via onRowClick', () => {
    const { onRowClick } = renderRow();
    fireEvent.click(screen.getByTestId('object-card-101:0'));
    expect(onRowClick).toHaveBeenCalledWith('101:0');
  });

  it('is a tab stop and activates when focused directly', () => {
    const { onRowClick } = renderRow();
    const row = screen.getByTestId('object-card-101:0');
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.focus(row);
    expect(onRowClick).toHaveBeenCalledWith('101:0');
  });

  it('shows the changed dot only when changed', () => {
    renderRow({ changed: true });
    expect(screen.getByTestId('object-row-changed-101:0')).toBeInTheDocument();
  });

  it('omits the changed dot by default', () => {
    renderRow();
    expect(screen.queryByTestId('object-row-changed-101:0')).not.toBeInTheDocument();
  });

  it('renders the frame timeline when timeline data is given', () => {
    renderRow({
      color: '#3b82f6',
      timeline: {
        frameTimestamps: ['t1', 't2'],
        statusByTimestamp: { t1: 'confirmed' },
        onFrameClick: () => {},
      },
    });
    expect(screen.getByTestId('object-timeline-101:0')).toBeInTheDocument();
    expect(screen.getByTestId('frame-segment-101:0-0')).toHaveStyle({
      backgroundColor: '#3b82f6',
    });
  });

  it('segment clicks reach onFrameClick without re-firing onRowClick', () => {
    const onFrameClick = vi.fn();
    const { onRowClick } = renderRow({
      color: '#3b82f6',
      timeline: { frameTimestamps: ['t1'], statusByTimestamp: {}, onFrameClick },
    });
    fireEvent.click(screen.getByTestId('frame-segment-101:0-0'));
    expect(onFrameClick).toHaveBeenCalledWith('t1', 0);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders no timeline when timeline data is omitted', () => {
    renderRow({ color: '#3b82f6' });
    expect(screen.queryByTestId('object-timeline-101:0')).not.toBeInTheDocument();
  });
});
