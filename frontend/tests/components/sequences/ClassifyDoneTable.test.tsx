/**
 * Tests for ClassifyDoneTable: Result column (FP/smoke pills, unsure badge),
 * absolute timestamps, accuracy row coloring, and row click handling.
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

vi.mock('@/utils/modelAccuracy', () => ({
  analyzeSequenceAccuracy: vi.fn(() => ({
    label: 'High Accuracy',
    type: 'high_accuracy',
    accuracy: 0.95,
  })),
  getRowBackgroundClasses: vi.fn(() => 'bg-green-50 hover:bg-green-100'),
  parseFalsePositiveTypes: vi.fn((types: string) => (types ? types.split(',') : [])),
  getFalsePositiveEmoji: vi.fn(() => '📡'),
  formatFalsePositiveType: vi.fn((type: string) => (type === 'antenna' ? 'Antenna' : type)),
  getSmokeTypeEmoji: vi.fn(() => '🔥'),
  formatSmokeType: vi.fn((type: string) => (type === 'wildfire' ? 'Wildfire' : type)),
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
      'Prediction',
      'Source',
      'Azimuth',
      'Result',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('shows the absolute recorded timestamp', () => {
    render(<ClassifyDoneTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(
      screen.getByText(new Date('2024-01-01T10:00:00Z').toLocaleString())
    ).toBeInTheDocument();
  });

  it('renders smoke-type pills in the Result column', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ is_wildfire_alertapi: 'other' })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('🔥 Wildfire')).toBeInTheDocument();
  });

  it('renders false-positive pills in the Result column', () => {
    render(
      <ClassifyDoneTable
        sequences={[
          createSequence({
            annotation: createAnnotation({
              has_smoke: false,
              smoke_types: [],
              false_positive_types: 'antenna',
            }),
          }),
        ]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('📡 Antenna')).toBeInTheDocument();
  });

  it('renders the unsure badge and amber row background when unsure', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ annotation: createAnnotation({ is_unsure: true }) })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('⚠️ Unsure')).toBeInTheDocument();
    expect(screen.getByText('Camera-01').closest('tr')).toHaveClass('bg-amber-50');
  });

  it('applies accuracy row background classes when not unsure', () => {
    render(<ClassifyDoneTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(screen.getByText('Camera-01').closest('tr')).toHaveClass('bg-green-50');
  });

  it('renders a plain row and empty Result cell when annotation is missing', () => {
    render(
      <ClassifyDoneTable
        sequences={[createSequence({ annotation: null })]}
        onSequenceClick={onSequenceClick}
      />
    );

    const row = screen.getByText('Camera-01').closest('tr');
    expect(row).toHaveClass('hover:bg-gray-50');
    expect(screen.queryByText('⚠️ Unsure')).not.toBeInTheDocument();
  });

  it('calls onSequenceClick with the sequence when a row is clicked', () => {
    const sequence = createSequence();
    render(<ClassifyDoneTable sequences={[sequence]} onSequenceClick={onSequenceClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onSequenceClick).toHaveBeenCalledTimes(1);
    expect(onSequenceClick).toHaveBeenCalledWith(sequence);
  });
});
