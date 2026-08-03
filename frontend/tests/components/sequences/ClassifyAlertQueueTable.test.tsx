/**
 * Tests for ClassifyAlertQueueTable: column rendering, objects-cell copy,
 * and row click handling. Mirrors ClassifyQueueTable.test.tsx.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassifyAlertQueueTable } from '@/components/sequences/ClassifyAlertQueueTable';
import type { ClassifyQueueItem } from '@/types/api';

vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: ({ sequenceId, className }: { sequenceId: number; className?: string }) => (
    <div data-testid="detection-thumbnail" data-sequence-id={sequenceId} className={className} />
  ),
}));

const createItem = (overrides: Partial<ClassifyQueueItem> = {}): ClassifyQueueItem => ({
  source_api: 'test-api',
  platform_alert_id: 900,
  camera_name: 'Camera-01',
  organisation_name: 'Test Org',
  azimuth: 180,
  recorded_at: '2024-01-01T10:00:00Z',
  is_wildfire_alertapi: 'wildfire_smoke',
  primary_sequence_id: 1,
  total_objects: 3,
  classified_objects: 1,
  ...overrides,
});

describe('ClassifyAlertQueueTable', () => {
  const onAlertClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers', () => {
    render(<ClassifyAlertQueueTable items={[createItem()]} onAlertClick={onAlertClick} />);

    for (const header of [
      'Camera',
      'Organisation',
      'Recorded',
      'Platform annotation',
      'Source',
      'Azimuth',
      'Objects',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('renders one row per alert with camera, organisation, source and azimuth', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem(), createItem({ platform_alert_id: 901, camera_name: 'Camera-02' })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('Camera-01')).toBeInTheDocument();
    expect(screen.getByText('Camera-02')).toBeInTheDocument();
    expect(screen.getAllByText('Test Org')).toHaveLength(2);
    expect(screen.getAllByText('test-api')).toHaveLength(2);
    expect(screen.getAllByText('180°')).toHaveLength(2);
    expect(screen.getAllByTestId('detection-thumbnail')).toHaveLength(2);
  });

  it('uses the primary_sequence_id for the thumbnail', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ primary_sequence_id: 42 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByTestId('detection-thumbnail')).toHaveAttribute('data-sequence-id', '42');
  });

  it('shows the absolute recorded timestamp', () => {
    render(<ClassifyAlertQueueTable items={[createItem()]} onAlertClick={onAlertClick} />);

    expect(screen.getByText(new Date('2024-01-01T10:00:00Z').toLocaleString())).toBeInTheDocument();
  });

  it('renders the platform annotation pill per value', () => {
    render(
      <ClassifyAlertQueueTable
        items={[
          createItem(),
          createItem({ platform_alert_id: 901, is_wildfire_alertapi: 'other_smoke' }),
          createItem({ platform_alert_id: 902, is_wildfire_alertapi: 'other' }),
          createItem({ platform_alert_id: 903, is_wildfire_alertapi: null }),
        ]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('🔥 Wildfire')).toBeInTheDocument();
    expect(screen.getByText('💨 Other Smoke')).toBeInTheDocument();
    expect(screen.getByText('○ Other')).toBeInTheDocument();
  });

  it('renders 0° when azimuth is zero', () => {
    render(
      <ClassifyAlertQueueTable items={[createItem({ azimuth: 0 })]} onAlertClick={onAlertClick} />
    );

    expect(screen.getByText('0°')).toBeInTheDocument();
  });

  it('leaves the azimuth cell empty when azimuth is null', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ azimuth: null })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('renders "N objects · M classified" when some objects are classified', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ total_objects: 3, classified_objects: 1 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('3 objects · 1 classified')).toBeInTheDocument();
  });

  it('renders "1 object" with no classified suffix for a single unclassified object', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ total_objects: 1, classified_objects: 0 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('1 object')).toBeInTheDocument();
    expect(screen.queryByText(/classified/)).not.toBeInTheDocument();
  });

  it('renders "N objects" with no classified suffix when none are classified', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ total_objects: 3, classified_objects: 0 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('3 objects')).toBeInTheDocument();
    expect(screen.queryByText(/classified/)).not.toBeInTheDocument();
  });

  it('calls onAlertClick with the item when a row is clicked', () => {
    const item = createItem();
    render(<ClassifyAlertQueueTable items={[item]} onAlertClick={onAlertClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onAlertClick).toHaveBeenCalledTimes(1);
    expect(onAlertClick).toHaveBeenCalledWith(item);
  });
});
