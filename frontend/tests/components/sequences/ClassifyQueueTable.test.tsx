/**
 * Tests for ClassifyQueueTable: column rendering, platform annotation pill,
 * absolute timestamps, and row click handling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassifyQueueTable } from '@/components/sequences/ClassifyQueueTable';
import type { SequenceWithAnnotation } from '@/types/api';

vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: ({ sequenceId, className }: { sequenceId: number; className?: string }) => (
    <div data-testid="detection-thumbnail" data-sequence-id={sequenceId} className={className} />
  ),
}));

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
  annotation: null,
  ...overrides,
});

describe('ClassifyQueueTable', () => {
  const onSequenceClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers', () => {
    render(<ClassifyQueueTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    for (const header of ['Camera', 'Organisation', 'Recorded', 'Alert API annotation', 'Source', 'Azimuth']) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('renders one row per sequence with camera, organisation, source and azimuth', () => {
    render(
      <ClassifyQueueTable
        sequences={[createSequence(), createSequence({ id: 2, camera_name: 'Camera-02' })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('Camera-01')).toBeInTheDocument();
    expect(screen.getByText('Camera-02')).toBeInTheDocument();
    expect(screen.getAllByText('Test Org')).toHaveLength(2);
    expect(screen.getAllByText('test-api')).toHaveLength(2);
    expect(screen.getAllByText('180°')).toHaveLength(2);
    expect(screen.getAllByTestId('detection-thumbnail')).toHaveLength(2);
  });

  it('shows the absolute recorded timestamp', () => {
    render(<ClassifyQueueTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(
      screen.getByText(new Date('2024-01-01T10:00:00Z').toLocaleString())
    ).toBeInTheDocument();
  });

  it('renders the platform annotation pill per value', () => {
    render(
      <ClassifyQueueTable
        sequences={[
          createSequence(),
          createSequence({ id: 2, is_wildfire_alertapi: 'other_smoke' }),
          createSequence({ id: 3, is_wildfire_alertapi: 'other' }),
          createSequence({ id: 4, is_wildfire_alertapi: null }),
        ]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('🔥 Wildfire')).toBeInTheDocument();
    expect(screen.getByText('💨 Other Smoke')).toBeInTheDocument();
    expect(screen.getByText('○ Other')).toBeInTheDocument();
  });

  it('renders 0° when azimuth is zero', () => {
    render(
      <ClassifyQueueTable
        sequences={[createSequence({ azimuth: 0 })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('0°')).toBeInTheDocument();
  });

  it('leaves the azimuth cell empty when azimuth is null', () => {
    render(
      <ClassifyQueueTable
        sequences={[createSequence({ azimuth: null })]}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('calls onSequenceClick with the sequence when a row is clicked', () => {
    const sequence = createSequence();
    render(<ClassifyQueueTable sequences={[sequence]} onSequenceClick={onSequenceClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onSequenceClick).toHaveBeenCalledTimes(1);
    expect(onSequenceClick).toHaveBeenCalledWith(sequence);
  });
});
