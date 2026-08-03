/**
 * Tests for ClassifyDoneTable: Result column (outcome code + detail text),
 * absolute timestamps, untinted rows, and row click handling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassifyDoneTable } from '@/components/sequences/ClassifyDoneTable';
import type { SequenceAnnotation, SequenceWithAnnotation } from '@/types/api';

vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: ({ sequenceId, className }: { sequenceId: number; className?: string }) => (
    <div data-testid="detection-thumbnail" data-sequence-id={sequenceId} className={className} />
  ),
}));

const createAnnotation = (overrides: Partial<SequenceAnnotation> = {}): SequenceAnnotation => ({
  id: 1,
  sequence_id: 1,
  has_smoke: true,
  has_false_positives: false,
  false_positive_types: '',
  smoke_types: ['wildfire'],
  has_missed_smoke: false,
  is_unsure: false,
  annotation: { sequences_bbox: [] },
  processing_stage: 'annotated',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: null,
  contributors: [],
  ...overrides,
});

const createSequence = (
  overrides: Partial<SequenceWithAnnotation> = {}
): SequenceWithAnnotation => ({
  id: 1,
  source_api: 'test-api',
  alert_api_id: 123,
  created_at: '2024-01-01T10:00:00Z',
  recorded_at: '2024-01-01T10:00:00Z',
  last_seen_at: '2024-01-01T10:00:00Z',
  camera_name: 'Camera-01',
  camera_id: 1,
  lat: 45.123456,
  lon: -122.987654,
  azimuth: 180,
  is_wildfire_alertapi: 'wildfire_smoke',
  organisation_name: 'Test Org',
  organisation_id: 1,
  platform_alert_id: 900,
  annotation: createAnnotation(),
  ...overrides,
});

describe('ClassifyDoneTable', () => {
  const onSequenceClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers including Result', () => {
    render(<ClassifyDoneTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    for (const header of [
      'Camera',
      'Organisation',
      'Recorded',
      'Alert API annotation',
      'Source',
      'Azimuth',
      'Result',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('explains the outcome codes in the Result column tooltip', () => {
    render(<ClassifyDoneTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(
      screen.getByText(
        'Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — and the classification detail'
      )
    ).toBeInTheDocument();
  });

  it('renders the code alone when the annotation has no detail text', () => {
    render(
      <ClassifyDoneTable
        sequences={[
          createSequence({
            annotation: createAnnotation({
              has_smoke: false,
              smoke_types: [],
              false_positive_types: '',
            }),
          }),
        ]}
        onSequenceClick={onSequenceClick}
      />
    );

    const cell = screen.getByTitle('False positive — model flagged non-smoke').closest('td');
    expect(cell?.querySelector('.ml-2\\.5')).toBeNull();
  });

  it('shows the absolute recorded timestamp', () => {
    render(<ClassifyDoneTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(
      screen.getByText(new Date('2024-01-01T10:00:00Z').toLocaleString())
    ).toBeInTheDocument();
  });

  it('renders the TP code with smoke types as detail text', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ is_wildfire_alertapi: 'other' })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(
      screen.getByTitle('True positive — model correctly detected smoke')
    ).toBeInTheDocument();
    expect(screen.getByText('Wildfire')).toBeInTheDocument();
  });

  it('renders the FP code with false-positive types as detail text', () => {
    render(
      <ClassifyDoneTable
        sequences={[
          createSequence({
            annotation: createAnnotation({
              has_smoke: false,
              smoke_types: [],
              false_positive_types: '["antenna", "high_cloud"]',
            }),
          }),
        ]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByTitle('False positive — model flagged non-smoke')).toBeInTheDocument();
    expect(screen.getByText('Antenna, High Cloud')).toBeInTheDocument();
  });

  it('renders the FN code with missed smoke ahead of smoke types', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ annotation: createAnnotation({ has_missed_smoke: true }) })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByTitle('False negative — smoke was missed')).toBeInTheDocument();
    expect(screen.getByText('Missed smoke · Wildfire')).toBeInTheDocument();
  });

  it('renders the unsure code without tinting the row', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ annotation: createAnnotation({ is_unsure: true }) })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByTitle('Unsure — needs review')).toBeInTheDocument();
    expect(screen.getByText('Camera-01').closest('tr')).not.toHaveClass('bg-amber-50');
  });

  it('leaves rows untinted regardless of outcome', () => {
    render(<ClassifyDoneTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    const row = screen.getByText('Camera-01').closest('tr');
    expect(row).toHaveClass('hover:bg-ash');
    expect(row).not.toHaveClass('bg-green-50');
  });

  it('renders an empty Result cell when annotation is missing', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ annotation: null })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.queryByTitle(/positive|negative|Unsure/)).not.toBeInTheDocument();
  });

  it('calls onSequenceClick with the sequence when a row is clicked', () => {
    const sequence = createSequence();
    render(<ClassifyDoneTable sequences={[sequence]} onSequenceClick={onSequenceClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onSequenceClick).toHaveBeenCalledTimes(1);
    expect(onSequenceClick).toHaveBeenCalledWith(sequence);
  });
});
