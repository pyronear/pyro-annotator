import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassificationChips, formatFalsePositiveLabel } from '@/components/classify';
import type { SequenceBbox } from '@/types/api';
import { FALSE_POSITIVE_TYPES } from '@/utils/constants';

const baseBbox: SequenceBbox = { is_smoke: false, false_positive_types: [], bboxes: [] };

function renderChips(overrides: Partial<React.ComponentProps<typeof ClassificationChips>> = {}) {
  const onBboxChange = vi.fn();
  const onClassificationChange = vi.fn();
  const onUnsureChange = vi.fn();
  render(
    <ClassificationChips
      cardKey="101:0"
      bbox={baseBbox}
      classification="unselected"
      unsure={false}
      onBboxChange={onBboxChange}
      onClassificationChange={onClassificationChange}
      onUnsureChange={onUnsureChange}
      {...overrides}
    />
  );
  return { onBboxChange, onClassificationChange, onUnsureChange };
}

describe('ClassificationChips', () => {
  it('marks smoke: sets is_smoke, clears FP types, keeps smoke_type', () => {
    const { onBboxChange, onClassificationChange } = renderChips({
      bbox: { ...baseBbox, false_positive_types: ['antenna'], smoke_type: 'wildfire' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Smoke' }));
    expect(onClassificationChange).toHaveBeenCalledWith('101:0', 'smoke');
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      is_smoke: true,
      false_positive_types: [],
      smoke_type: 'wildfire',
    });
  });

  it('marks false positive: clears smoke_type, keeps existing FP types', () => {
    const { onBboxChange, onClassificationChange } = renderChips({
      bbox: { ...baseBbox, is_smoke: true, smoke_type: 'wildfire', false_positive_types: ['sky'] },
      classification: 'smoke',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'False positive' }));
    expect(onClassificationChange).toHaveBeenCalledWith('101:0', 'false_positive');
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      is_smoke: false,
      smoke_type: undefined,
      false_positive_types: ['sky'],
    });
  });

  it('shows smoke-type chips only for smoke, and sets the type', () => {
    const { onBboxChange } = renderChips({
      bbox: { ...baseBbox, is_smoke: true },
      classification: 'smoke',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Industrial' }));
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      is_smoke: true,
      smoke_type: 'industrial',
    });
    expect(screen.queryByRole('checkbox', { name: 'High cloud' })).not.toBeInTheDocument();
  });

  it('renders all FP type chips for false_positive and toggles membership both ways', () => {
    const { onBboxChange } = renderChips({
      bbox: { ...baseBbox, false_positive_types: ['high_cloud'] },
      classification: 'false_positive',
    });
    // One chip per FP type (Unsure is a radio in the exclusive classification group)
    expect(screen.getAllByRole('checkbox')).toHaveLength(FALSE_POSITIVE_TYPES.length);
    expect(screen.getByRole('checkbox', { name: 'High cloud' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Antenna' }));
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      false_positive_types: ['high_cloud', 'antenna'],
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'High cloud' }));
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      false_positive_types: [],
    });
  });

  it('offers the combine_harvester FP chip and toggles it', () => {
    const { onBboxChange } = renderChips({ classification: 'false_positive' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Combine harvester' }));
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      false_positive_types: ['combine_harvester'],
    });
  });

  it('toggles unsure off and reflects checked state', () => {
    const { onUnsureChange } = renderChips({ unsure: true });
    expect(screen.getByRole('radio', { name: 'Unsure' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Unsure' }));
    expect(onUnsureChange).toHaveBeenCalledWith('101:0', false);
  });

  it('turning unsure on clears the classification and its bbox labels (mutual exclusivity)', () => {
    const { onUnsureChange, onClassificationChange, onBboxChange } = renderChips({
      bbox: { ...baseBbox, is_smoke: true, smoke_type: 'wildfire' },
      classification: 'smoke',
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Unsure' }));
    expect(onUnsureChange).toHaveBeenCalledWith('101:0', true);
    expect(onClassificationChange).toHaveBeenCalledWith('101:0', 'unselected');
    expect(onBboxChange).toHaveBeenCalledWith('101:0', {
      ...baseBbox,
      is_smoke: false,
      smoke_type: undefined,
      false_positive_types: [],
    });
  });

  it('picking a classification clears unsure (mutual exclusivity)', () => {
    const { onUnsureChange } = renderChips({ unsure: true });
    fireEvent.click(screen.getByRole('radio', { name: 'Smoke' }));
    expect(onUnsureChange).toHaveBeenCalledWith('101:0', false);
  });

  it('renders Unsure as the only selected chip when a stale classification coexists with unsure', () => {
    renderChips({
      bbox: { ...baseBbox, is_smoke: true, smoke_type: 'wildfire' },
      classification: 'smoke',
      unsure: true,
    });
    expect(screen.getByRole('radio', { name: 'Unsure' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Smoke' })).not.toBeChecked();
    // The smoke-type row stays hidden while unsure is on.
    expect(screen.queryByRole('radio', { name: 'Wildfire' })).not.toBeInTheDocument();
  });

  it('hides the Unsure chip when no handler is wired', () => {
    render(
      <ClassificationChips
        cardKey="101:0"
        bbox={baseBbox}
        classification="unselected"
        unsure={false}
        onBboxChange={vi.fn()}
        onClassificationChange={vi.fn()}
      />
    );
    expect(screen.queryByRole('radio', { name: 'Unsure' })).not.toBeInTheDocument();
  });

  it('contains no emojis anywhere', () => {
    const { container } = render(
      <ClassificationChips
        cardKey="101:0"
        bbox={{ ...baseBbox, is_smoke: true }}
        classification="smoke"
        unsure={false}
        onBboxChange={vi.fn()}
        onClassificationChange={vi.fn()}
      />
    );
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('keeps every chip out of the tab order — rows own tab navigation', () => {
    renderChips({
      bbox: { ...baseBbox, false_positive_types: ['high_cloud'] },
      classification: 'false_positive',
    });
    [...screen.getAllByRole('radio'), ...screen.getAllByRole('checkbox')].forEach(chip =>
      expect(chip).toHaveAttribute('tabindex', '-1')
    );
  });

  it('formats FP labels', () => {
    expect(formatFalsePositiveLabel('high_cloud')).toBe('High cloud');
    expect(formatFalsePositiveLabel('water_body')).toBe('Water body');
  });
});
