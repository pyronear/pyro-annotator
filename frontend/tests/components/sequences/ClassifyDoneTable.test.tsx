/**
 * Tests for ClassifyDoneTable: alert rows with rollup outcome code (+N),
 * full multi-lane detail text, and row click handling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassifyDoneTable } from '@/components/sequences/ClassifyDoneTable';
import type { ClassifyDoneItem, ClassifyDoneLane } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';

vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: ({ sequenceId, className }: { sequenceId: number; className?: string }) => (
    <div data-testid="detection-thumbnail" data-sequence-id={sequenceId} className={className} />
  ),
}));

const createLane = (overrides: Partial<ClassifyDoneLane> = {}): ClassifyDoneLane => ({
  sequence_id: 1,
  has_smoke: true,
  has_missed_smoke: false,
  is_unsure: false,
  smoke_types: ['wildfire'],
  false_positive_types: [],
  ...overrides,
});

const createItem = (overrides: Partial<ClassifyDoneItem> = {}): ClassifyDoneItem => ({
  source_api: 'test-api',
  platform_alert_id: 900,
  camera_name: 'Camera-01',
  organisation_name: 'Test Org',
  azimuth: 180,
  recorded_at: '2024-01-01T10:00:00Z',
  is_wildfire_alertapi: 'wildfire_smoke',
  primary_sequence_id: 1,
  lanes: [createLane()],
  annotators: [],
  ...overrides,
});

describe('ClassifyDoneTable', () => {
  const onItemClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the column headers in canonical order including Result', () => {
    render(<ClassifyDoneTable items={[createItem()]} onItemClick={onItemClick} />);

    const labels = [
      'Camera',
      'Organisation',
      'Recorded',
      'Source',
      'Azimuth',
      'Alert API annotation',
      'Result',
      'Annotators',
    ];
    const positions = labels.map(l => {
      const el = screen.getByText(l);
      return Array.from(document.querySelectorAll('th')).findIndex(th => th.contains(el));
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every(p => p > 0)).toBe(true);
  });

  it('renders comma-separated annotators in the last column', () => {
    render(
      <ClassifyDoneTable
        items={[createItem({ annotators: ['alice', 'bob'] })]}
        onItemClick={onItemClick}
      />
    );
    expect(screen.getByText('alice, bob')).toBeInTheDocument();
  });

  it('renders a muted dash when the alert has no human annotators', () => {
    render(<ClassifyDoneTable items={[createItem({ annotators: [] })]} onItemClick={onItemClick} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('uses the primary sequence for the thumbnail', () => {
    render(
      <ClassifyDoneTable
        items={[createItem({ primary_sequence_id: 42 })]}
        onItemClick={onItemClick}
      />
    );

    expect(screen.getByTestId('detection-thumbnail')).toHaveAttribute('data-sequence-id', '42');
  });

  it('renders a single-lane TP row with smoke types as detail text', () => {
    render(
      <ClassifyDoneTable
        items={[createItem({ is_wildfire_alertapi: 'other' })]}
        onItemClick={onItemClick}
      />
    );

    expect(
      screen.getByTitle('True positive — model correctly detected smoke')
    ).toBeInTheDocument();
    expect(screen.getByText('Wildfire')).toBeInTheDocument();
  });

  it('shows FP types alongside missed smoke on an FN alert (the antenna bug)', () => {
    render(
      <ClassifyDoneTable
        items={[
          createItem({
            lanes: [
              createLane({
                has_smoke: false,
                has_missed_smoke: true,
                smoke_types: [],
                false_positive_types: ['antenna'],
              }),
            ],
          }),
        ]}
        onItemClick={onItemClick}
      />
    );

    expect(screen.getByTitle('False negative — smoke was missed')).toBeInTheDocument();
    expect(screen.getByText('Missed smoke · Antenna')).toBeInTheDocument();
  });

  it('rolls up multi-object alerts to the dominant outcome with +N', () => {
    render(
      <ClassifyDoneTable
        items={[
          createItem({
            lanes: [
              createLane(),
              createLane({
                sequence_id: 2,
                has_smoke: false,
                smoke_types: [],
                false_positive_types: ['building'],
              }),
            ],
          }),
        ]}
        onItemClick={onItemClick}
      />
    );

    expect(
      screen.getByTitle('True positive — model correctly detected smoke')
    ).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('Wildfire · Building')).toBeInTheDocument();
  });

  it('deduplicates repeated types across lanes', () => {
    render(
      <ClassifyDoneTable
        items={[
          createItem({
            lanes: [
              createLane({
                has_smoke: false,
                smoke_types: [],
                false_positive_types: ['antenna'],
              }),
              createLane({
                sequence_id: 2,
                has_smoke: false,
                smoke_types: [],
                false_positive_types: ['antenna'],
              }),
            ],
          }),
        ]}
        onItemClick={onItemClick}
      />
    );

    expect(screen.getByText('Antenna')).toBeInTheDocument();
  });

  it('renders the unsure code via rollup precedence', () => {
    render(
      <ClassifyDoneTable
        items={[
          createItem({
            lanes: [createLane({ is_unsure: true, smoke_types: [] })],
          }),
        ]}
        onItemClick={onItemClick}
      />
    );

    expect(screen.getByTitle('Unsure — needs review')).toBeInTheDocument();
  });

  it('shows the absolute recorded timestamp', () => {
    render(<ClassifyDoneTable items={[createItem()]} onItemClick={onItemClick} />);

    expect(
      screen.getByText(formatDateTime('2024-01-01T10:00:00Z'))
    ).toBeInTheDocument();
  });

  it('calls onItemClick with the alert when a row is clicked', () => {
    const item = createItem();
    render(<ClassifyDoneTable items={[item]} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(item);
  });
});
