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
      getObjectRowStatus({
        bbox: baseBbox,
        classification: 'unselected',
        unsure: false,
        locked: false,
      })
    ).toEqual({ label: 'Pending', tone: 'pending' });
    expect(
      getObjectRowStatus({
        bbox: { ...baseBbox, is_smoke: true, smoke_type: 'wildfire' },
        classification: 'smoke',
        unsure: false,
        locked: false,
      })
    ).toEqual({ label: 'Smoke · Wildfire', tone: 'positive' });
    expect(
      getObjectRowStatus({
        bbox: { ...baseBbox, is_smoke: true },
        classification: 'smoke',
        unsure: false,
        locked: false,
      })
    ).toEqual({ label: 'Type needed', tone: 'pending' });
    expect(
      getObjectRowStatus({
        bbox: { ...baseBbox, false_positive_types: ['high_cloud', 'sky'] },
        classification: 'false_positive',
        unsure: false,
        locked: false,
      })
    ).toEqual({ label: 'FP · High cloud +1', tone: 'neutral' });
    expect(
      getObjectRowStatus({
        bbox: baseBbox,
        classification: 'unselected',
        unsure: true,
        locked: false,
      })
    ).toEqual({ label: 'Unsure', tone: 'unsure' });
    expect(
      getObjectRowStatus({
        bbox: baseBbox,
        classification: 'unselected',
        unsure: false,
        locked: true,
        stageBadge: 'Fully annotated',
      })
    ).toEqual({ label: 'Fully annotated', tone: 'neutral' });
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
    });
    expect(screen.queryByRole('radio', { name: 'Smoke' })).not.toBeInTheDocument();
    expect(screen.getByText('Fully annotated')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('object-card-101:0'));
    expect(onRowClick).toHaveBeenCalledWith('101:0');
  });

  it('click activates via onRowClick', () => {
    const { onRowClick } = renderRow();
    fireEvent.click(screen.getByTestId('object-card-101:0'));
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
});
