/**
 * Tests for LocalizeDoneQueueTable: alert-grouped /localize/done rows —
 * Objects (+localized) progress, outcome rollup over every lane, row clicks.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalizeDoneQueueTable } from '@/components/sequences/LocalizeDoneQueueTable';
import type { LocalizeDoneQueueItem, LocalizationQueueLane } from '@/types/api';

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
  processing_stage: 'annotated',
  smoke_types: ['wildfire'],
  total_detections: 10,
  annotated_detections: 10,
  auto_annotated_at: '2024-01-01T09:00:00Z',
  ...overrides,
});

const createItem = (
  overrides: Partial<LocalizeDoneQueueItem> = {}
): LocalizeDoneQueueItem => ({
  source_api: 'test-api',
  platform_alert_id: 900,
  camera_name: 'Camera-01',
  organisation_name: 'Test Org',
  azimuth: 180,
  recorded_at: '2024-01-01T10:00:00Z',
  lanes: [createLane()],
  ...overrides,
});

describe('LocalizeDoneQueueTable', () => {
  const onItemClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers', () => {
    render(<LocalizeDoneQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    for (const header of [
      'Camera',
      'Organisation',
      'Recorded',
      'Source',
      'Azimuth',
      'Objects',
      'Result',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('shows "N objects" with no localized suffix once every smoke object is localized', () => {
    const item = createItem({
      lanes: [createLane(), createLane({ sequence_id: 12 })],
    });
    render(<LocalizeDoneQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByText('2 objects')).toBeInTheDocument();
  });

  it('shows the singular "1 object" for a single-object alert', () => {
    render(<LocalizeDoneQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    expect(screen.getByText('1 object')).toBeInTheDocument();
  });

  it('shows the localized count when the alert is mixed (some lanes not yet annotated)', () => {
    const item = createItem({
      lanes: [
        createLane(),
        createLane({ sequence_id: 12, processing_stage: 'seq_annotation_done' }),
      ],
    });
    render(<LocalizeDoneQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByText('2 objects · 1 localized')).toBeInTheDocument();
  });

  it('excludes FP and unsure lanes from the objects count', () => {
    const item = createItem({
      lanes: [
        createLane(),
        // FP lane: annotated, but nothing to localize — excluded
        createLane({
          sequence_id: 12,
          has_smoke: false,
          has_missed_smoke: false,
          smoke_types: [],
        }),
        // unsure lane — excluded
        createLane({ sequence_id: 13, is_unsure: true }),
      ],
    });
    render(<LocalizeDoneQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByText('1 object')).toBeInTheDocument();
  });

  it('renders the dominant outcome code for a single-object alert', () => {
    render(<LocalizeDoneQueueTable items={[createItem()]} onItemClick={onItemClick} />);

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
    render(<LocalizeDoneQueueTable items={[item]} onItemClick={onItemClick} />);

    expect(screen.getByTitle('False negative — smoke was missed')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('renders source and azimuth as plain text and the absolute timestamp', () => {
    render(<LocalizeDoneQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    expect(screen.getByText('test-api')).toBeInTheDocument();
    expect(screen.getByText('180°')).toBeInTheDocument();
    expect(
      screen.getByText(new Date('2024-01-01T10:00:00Z').toLocaleString())
    ).toBeInTheDocument();
  });

  it('leaves the azimuth cell empty when azimuth is null', () => {
    render(
      <LocalizeDoneQueueTable items={[createItem({ azimuth: null })]} onItemClick={onItemClick} />
    );

    expect(screen.queryByText(/°/)).not.toBeInTheDocument();
  });

  it('renders the thumbnail for the first lane sequence', () => {
    render(<LocalizeDoneQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    const thumb = screen.getByTestId('detection-thumbnail');
    expect(thumb).toHaveAttribute('data-sequence-id', '11');
    expect(thumb).toHaveClass('h-10', 'w-16');
  });

  it('uses the fire-lookout row style', () => {
    render(<LocalizeDoneQueueTable items={[createItem()]} onItemClick={onItemClick} />);

    const row = screen.getByText('Camera-01').closest('tr');
    expect(row).toHaveClass('hover:bg-ash');
    expect(row).not.toHaveClass('hover:bg-gray-50');
  });

  it('calls onItemClick with the item when a row is clicked', () => {
    const item = createItem();
    render(<LocalizeDoneQueueTable items={[item]} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(item);
  });
});
