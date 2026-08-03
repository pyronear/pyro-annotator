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

  it('renders the column headers in canonical order', () => {
    render(<ClassifyQueueTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    const labels = [
      'Camera',
      'Organisation',
      'Recorded',
      'Source',
      'Azimuth',
      'Alert API annotation',
    ];
    const positions = labels.map(l => {
      const el = screen.getByText(l);
      return Array.from(document.querySelectorAll('th')).findIndex(th => th.contains(el));
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every(p => p > 0)).toBe(true); // all after the thumbnail th
  });

  it('renders column tooltips', () => {
    render(<ClassifyQueueTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(screen.getByText('Alert API the sequence was imported from')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Annotation reported by the alert platform'
      )
    ).toBeInTheDocument();
  });

  it('renders source as plain text and uses the fire-lookout row style', () => {
    render(<ClassifyQueueTable sequences={[createSequence()]} onSequenceClick={onSequenceClick} />);

    expect(screen.getByText('test-api')).not.toHaveClass('rounded-full');
    const row = screen.getByText('Camera-01').closest('tr');
    expect(row).toHaveClass('hover:bg-ash');
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

  it('renders the platform annotation label per value as plain text', () => {
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

    expect(screen.getByText('Wildfire')).toBeInTheDocument();
    expect(screen.getByText('Other smoke')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
    expect(screen.getByText('Wildfire')).not.toHaveClass('rounded-full');
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
