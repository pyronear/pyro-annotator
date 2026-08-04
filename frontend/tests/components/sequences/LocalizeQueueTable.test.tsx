/**
 * Tests for LocalizeQueueTable: classify-style columns, plain-text source and
 * smoke types, Objects/Frames aggregation over smoke lanes, row clicks.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalizeQueueTable } from '@/components/sequences/LocalizeQueueTable';
import type { LocalizationQueueItem, LocalizationQueueLane } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';

vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: ({ sequenceId, className }: { sequenceId: number; className?: string }) => (
    <div data-testid="detection-thumbnail" data-sequence-id={sequenceId} className={className} />
  ),
}));

const createLane = (overrides: Partial<LocalizationQueueLane> = {}): LocalizationQueueLane => ({
  sequence_id: 11,
  alert_api_id: 500,
  has_smoke: true,
  has_missed_smoke: false,
  is_unsure: false,
  processing_stage: 'seq_annotation_done',
  smoke_types: ['wildfire'],
  total_detections: 10,
  annotated_detections: 0,
  auto_annotated_at: null,
  ...overrides,
});

const createItem = (overrides: Partial<LocalizationQueueItem> = {}): LocalizationQueueItem => ({
  source_api: 'test-api',
  platform_alert_id: 900,
  camera_name: 'Camera-01',
  organisation_name: 'Test Org',
  azimuth: 180,
  recorded_at: '2024-01-01T10:00:00Z',
  lanes: [createLane()],
  ...overrides,
});

describe('LocalizeQueueTable', () => {
  const onItemClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers', () => {
    render(<LocalizeQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    for (const header of [
      'Camera',
      'Organisation',
      'Recorded',
      'Source',
      'Azimuth',
      'Smoke types',
      'Objects',
      'Frames',
      'Result',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('renders the dominant outcome code for a single-object alert', () => {
    render(<LocalizeQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    expect(
      screen.getByTitle('True positive — model correctly detected smoke')
    ).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('rolls multi-object alerts up to the dominant outcome with a +N count', () => {
    const item = createItem({
      lanes: [
        createLane(),
        createLane({ sequence_id: 12, has_smoke: false, has_missed_smoke: true }),
        createLane({ sequence_id: 13, has_smoke: false, smoke_types: [] }),
      ],
    });
    render(<LocalizeQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByTitle('False negative — smoke was missed')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('renders column tooltips', () => {
    render(<LocalizeQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    expect(screen.getByText('Smoke objects to localize in this alert')).toBeInTheDocument();
    expect(screen.getByText('Images to box across all smoke objects')).toBeInTheDocument();
  });

  it('renders source and azimuth as plain text and the absolute timestamp', () => {
    render(<LocalizeQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    expect(screen.getByText('test-api')).toBeInTheDocument();
    expect(screen.getByText('180°')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime('2024-01-01T10:00:00Z'))).toBeInTheDocument();
  });

  it('renders 0° when azimuth is zero', () => {
    render(<LocalizeQueueTable items={[createItem({ azimuth: 0 })]} onItemClick={onItemClick} />);

    expect(screen.getByText('0°')).toBeInTheDocument();
  });

  it('leaves the azimuth cell empty when azimuth is null', () => {
    render(
      <LocalizeQueueTable items={[createItem({ azimuth: null })]} onItemClick={onItemClick} />
    );

    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('dedupes smoke types across smoke lanes into plain comma-separated text', () => {
    const item = createItem({
      lanes: [
        createLane({ smoke_types: ['wildfire'] }),
        createLane({ sequence_id: 12, smoke_types: ['wildfire', 'industrial'] }),
      ],
    });
    render(<LocalizeQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByText('Wildfire, Industrial')).toBeInTheDocument();
  });

  it('counts Objects and Frames over lanes needing localization only', () => {
    const item = createItem({
      lanes: [
        createLane({ total_detections: 10 }),
        createLane({
          sequence_id: 12,
          has_smoke: false,
          has_missed_smoke: true,
          total_detections: 7,
        }),
        // FP lane: no smoke at all — excluded
        createLane({ sequence_id: 13, has_smoke: false, smoke_types: [], total_detections: 99 }),
        // unsure lane — excluded
        createLane({ sequence_id: 14, is_unsure: true, total_detections: 99 }),
      ],
    });
    render(<LocalizeQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByText('2')).toBeInTheDocument(); // Objects
    expect(screen.getByText('17')).toBeInTheDocument(); // Frames: 10 + 7
  });

  it('renders the thumbnail for the first lane sequence', () => {
    render(<LocalizeQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    const thumb = screen.getByTestId('detection-thumbnail');
    expect(thumb).toHaveAttribute('data-sequence-id', '11');
    expect(thumb).toHaveClass('h-10', 'w-16');
  });

  it('uses the fire-lookout row style', () => {
    render(<LocalizeQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    const row = screen.getByText('Camera-01').closest('tr');
    expect(row).toHaveClass('hover:bg-ash');
    expect(row).not.toHaveClass('hover:bg-gray-50');
  });

  it('calls onItemClick with the item when a row is clicked', () => {
    const item = createItem();
    render(<LocalizeQueueTable items={[item]} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(item);
  });
});
