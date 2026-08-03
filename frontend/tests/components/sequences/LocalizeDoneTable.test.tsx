/**
 * Tests for LocalizeDoneTable: classify-done column parity, plain-text Result
 * (unsure/FP/smoke), accuracy row coloring, and row click handling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalizeDoneTable } from '@/components/sequences/LocalizeDoneTable';
import type { SequenceAnnotation, SequenceWithDetectionProgress } from '@/types/api';

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
  overrides: Partial<SequenceWithDetectionProgress> = {}
): SequenceWithDetectionProgress => ({
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
  ...overrides,
});

describe('LocalizeDoneTable', () => {
  const onSequenceClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers including Result', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    for (const header of [
      'Camera',
      'Organisation',
      'Recorded',
      'Source',
      'Azimuth',
      'Smoke types',
      'Frames',
      'Result',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.queryByText('Alert API annotation')).not.toBeInTheDocument();
  });

  it('renders column tooltips', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('Images in this sequence')).toBeInTheDocument();
    expect(
      screen.getByText('Classification outcome: unsure flag and false-positive types')
    ).toBeInTheDocument();
  });

  it('renders source as plain text without the platform annotation pill', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('test-api')).toBeInTheDocument();
    expect(screen.queryByText('🔥 Wildfire')).not.toBeInTheDocument();
  });

  it('renders smoke types as plain text in their own column', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('Wildfire')).toBeInTheDocument();
  });

  it('renders the frame count from detection stats', () => {
    render(
      <LocalizeDoneTable
        sequences={[
          createSequence({
            detection_annotation_stats: {
              total_detections: 8,
              annotated_detections: 8,
              completion_percentage: 100,
            },
          }),
        ]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('renders unsure and false-positive types in the Result text, smoke types separately', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{
          1: createAnnotation({
            is_unsure: true,
            false_positive_types: '["antenna"]',
            smoke_types: ['wildfire'],
          }),
        }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('⚠️ Unsure, Antenna')).toBeInTheDocument();
    expect(screen.getByText('Wildfire')).toBeInTheDocument();
  });

  it('applies the amber row background when unsure', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation({ is_unsure: true }) }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('Camera-01').closest('tr')).toHaveClass('bg-amber-50');
  });

  it('applies true-positive row background when the human confirmed smoke', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('Camera-01').closest('tr')).toHaveClass('bg-green-50');
  });

  it('applies false-positive row background when the human found no smoke', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{ 1: createAnnotation({ has_smoke: false, smoke_types: [] }) }}
        onSequenceClick={onSequenceClick}
      />
    );

    expect(screen.getByText('Camera-01').closest('tr')).toHaveClass('bg-red-50');
  });

  it('renders a plain row and empty Result cell when annotation is missing', () => {
    render(
      <LocalizeDoneTable
        sequences={[createSequence()]}
        annotations={{}}
        onSequenceClick={onSequenceClick}
      />
    );

    const row = screen.getByText('Camera-01').closest('tr');
    expect(row).toHaveClass('hover:bg-gray-50');
    expect(screen.queryByText('⚠️ Unsure')).not.toBeInTheDocument();
  });

  it('calls onSequenceClick with the sequence when a row is clicked', () => {
    const sequence = createSequence();
    render(
      <LocalizeDoneTable
        sequences={[sequence]}
        annotations={{ 1: createAnnotation() }}
        onSequenceClick={onSequenceClick}
      />
    );

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onSequenceClick).toHaveBeenCalledTimes(1);
    expect(onSequenceClick).toHaveBeenCalledWith(sequence);
  });
});
