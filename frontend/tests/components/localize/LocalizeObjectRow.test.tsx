/**
 * The rail row's actions. `Accept boxes` is covered through the page; these
 * cover `Reclassify` — which rows get it, and that it doesn't double as a
 * row activation.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalizeObjectRow } from '@/components/localize';

function renderRow(overrides: Partial<React.ComponentProps<typeof LocalizeObjectRow>> = {}) {
  const onActivate = vi.fn();
  const onReclassify = vi.fn();
  render(
    <LocalizeObjectRow
      label="Object 1"
      color="#E4572E"
      confirmedCount={0}
      presentCount={2}
      workable
      smokeType="wildfire"
      isActive={false}
      onActivate={onActivate}
      onReclassify={onReclassify}
      {...overrides}
    />
  );
  return { onActivate, onReclassify };
}

describe('LocalizeObjectRow reclassify action', () => {
  it('renders Reclassify alongside Accept boxes on a workable row', () => {
    renderRow({ onAcceptBoxes: vi.fn() });

    expect(screen.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Accept Object 1's boxes" })).toBeInTheDocument();
  });

  it('calls onReclassify without also activating the row', () => {
    const { onActivate, onReclassify } = renderRow({ onAcceptBoxes: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Reclassify Object 1' }));

    expect(onReclassify).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders Reclassify on an already-localized context row, which has no Accept boxes', () => {
    renderRow({ workable: false, onAcceptBoxes: undefined });

    expect(screen.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });

  it('renders no action strip at all when the page withholds both actions', () => {
    renderRow({
      isFalsePositive: true,
      workable: false,
      smokeType: undefined,
      falsePositiveTypes: ['cloud'],
      onAcceptBoxes: undefined,
      onReclassify: undefined,
    });

    expect(screen.queryByRole('button', { name: /Reclassify/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });
});
