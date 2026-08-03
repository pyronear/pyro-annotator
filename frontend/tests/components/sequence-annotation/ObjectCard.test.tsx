/**
 * Tests for ObjectCard: the per-object classification card extracted out of
 * SequenceAnnotationGrid. Covers title numbering, classification/unsure
 * callbacks keyed by cardKey, and the read-only (locked) rendering used by
 * ClassifyAlertPage for lanes that aren't editable.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectCard } from '@/components/sequence-annotation/ObjectCard';
import type { SequenceBbox } from '@/types/api';

vi.mock('@/components/annotation/FullImageSequence', () => ({
  default: () => <div data-testid="full-image-sequence" />,
}));
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));

const makeBbox = (overrides: Partial<SequenceBbox> = {}): SequenceBbox => ({
  is_smoke: false,
  false_positive_types: [],
  bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
  ...overrides,
});

describe('ObjectCard', () => {
  const noop = () => {};

  it('renders "Object 3" title for objectNumber={3}', () => {
    render(
      <ObjectCard
        objectNumber={3}
        cardKey="55:0"
        bbox={makeBbox()}
        sequenceId={55}
        classification="unselected"
        isActive={false}
        isAnnotated={false}
        onBboxChange={noop}
        onClassificationChange={noop}
      />
    );

    expect(screen.getByText('Object 3')).toBeInTheDocument();
    expect(screen.queryByText(/Detection/)).not.toBeInTheDocument();
  });

  it('calls onClassificationChange and onBboxChange with the card key when the smoke radio is selected', () => {
    const onClassificationChange = vi.fn();
    const onBboxChange = vi.fn();

    render(
      <ObjectCard
        objectNumber={1}
        cardKey="55:0"
        bbox={makeBbox()}
        sequenceId={55}
        classification="unselected"
        isActive={false}
        isAnnotated={false}
        onBboxChange={onBboxChange}
        onClassificationChange={onClassificationChange}
      />
    );

    fireEvent.click(screen.getByText('🔥 This is smoke'));

    expect(onClassificationChange).toHaveBeenCalledWith('55:0', 'smoke');
    expect(onBboxChange).toHaveBeenCalledWith(
      '55:0',
      expect.objectContaining({ is_smoke: true, false_positive_types: [] })
    );
  });

  it('calls onClassificationChange and onBboxChange with the card key when the false positive radio is selected', () => {
    const onClassificationChange = vi.fn();
    const onBboxChange = vi.fn();

    render(
      <ObjectCard
        objectNumber={1}
        cardKey="55:1"
        bbox={makeBbox({ is_smoke: true, smoke_type: 'wildfire' })}
        sequenceId={55}
        classification="smoke"
        isActive={false}
        isAnnotated={false}
        onBboxChange={onBboxChange}
        onClassificationChange={onClassificationChange}
      />
    );

    fireEvent.click(screen.getByText('❌ This is a false positive'));

    expect(onClassificationChange).toHaveBeenCalledWith('55:1', 'false_positive');
    expect(onBboxChange).toHaveBeenCalledWith(
      '55:1',
      expect.objectContaining({ is_smoke: false, smoke_type: undefined })
    );
  });

  it('renders an unsure checkbox and calls onUnsureChange with the card key when toggled', () => {
    const onUnsureChange = vi.fn();

    render(
      <ObjectCard
        objectNumber={1}
        cardKey="55:0"
        bbox={makeBbox()}
        sequenceId={55}
        classification="unselected"
        isActive={false}
        isAnnotated={false}
        unsure={false}
        onUnsureChange={onUnsureChange}
        onBboxChange={noop}
        onClassificationChange={noop}
      />
    );

    const checkbox = screen.getByLabelText('Unsure');
    fireEvent.click(checkbox);

    expect(onUnsureChange).toHaveBeenCalledWith('55:0', true);
  });

  it('does not render an unsure checkbox when onUnsureChange is not provided (SequenceAnnotationGrid usage)', () => {
    render(
      <ObjectCard
        objectNumber={1}
        cardKey="0"
        bbox={makeBbox()}
        sequenceId={55}
        classification="unselected"
        isActive={false}
        isAnnotated={false}
        onBboxChange={noop}
        onClassificationChange={noop}
      />
    );

    expect(screen.queryByLabelText('Unsure')).not.toBeInTheDocument();
  });

  it('disables inputs and shows the stage badge in read-only (locked) mode', () => {
    render(
      <ObjectCard
        objectNumber={2}
        cardKey="60:0"
        bbox={makeBbox({ is_smoke: true, smoke_type: 'wildfire' })}
        sequenceId={60}
        classification="smoke"
        isActive={false}
        isAnnotated={true}
        locked
        stageBadge="Fully annotated"
        unsure={false}
        onUnsureChange={noop}
        onBboxChange={noop}
        onClassificationChange={noop}
      />
    );

    expect(screen.getByText('Fully annotated')).toBeInTheDocument();
    expect(
      screen.getByText('🔥 This is smoke').closest('label')?.querySelector('input')
    ).toBeDisabled();
    expect(screen.getByLabelText('Unsure')).toBeDisabled();
  });
});
