/**
 * Tests for ClassifyAlertQueueTable: column rendering, objects-cell copy,
 * and row click handling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassifyAlertQueueTable } from '@/components/sequences/ClassifyAlertQueueTable';
import type { ClassifyQueueItem } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';

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
  temporal_model_score: 0.42,
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
      'Source',
      'Azimuth',
      'Objects',
      'Alert API annotation',
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

    expect(screen.getByText(formatDateTime('2024-01-01T10:00:00Z'))).toBeInTheDocument();
  });

  it('renders the platform annotation label per value', () => {
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

    expect(screen.getByText('Wildfire')).toBeInTheDocument();
    expect(screen.getByText('Other smoke')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
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

  it('renders "N · M classified" when some objects are classified', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ total_objects: 3, classified_objects: 1 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('3 · 1 classified')).toBeInTheDocument();
  });

  it('renders the bare count with no classified suffix for a single unclassified object', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ total_objects: 1, classified_objects: 0 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(/classified/)).not.toBeInTheDocument();
  });

  it('renders the bare count with no classified suffix when none are classified', () => {
    render(
      <ClassifyAlertQueueTable
        items={[createItem({ total_objects: 3, classified_objects: 0 })]}
        onAlertClick={onAlertClick}
      />
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/classified/)).not.toBeInTheDocument();
  });

  it('calls onAlertClick with the item when a row is clicked', () => {
    const item = createItem();
    render(<ClassifyAlertQueueTable items={[item]} onAlertClick={onAlertClick} />);

    fireEvent.click(screen.getByText('Camera-01'));

    expect(onAlertClick).toHaveBeenCalledTimes(1);
    expect(onAlertClick).toHaveBeenCalledWith(item);
  });

  describe('skipped view', () => {
    const onUnskip = vi.fn();
    const skippedItem = () =>
      createItem({
        skip: {
          skipped_at: '2026-08-05T10:00:00Z',
          skipped_by: 'annotator',
          note: 'two plumes overlap',
        },
      });

    it('renders skip metadata columns', () => {
      render(
        <ClassifyAlertQueueTable
          items={[skippedItem()]}
          onAlertClick={onAlertClick}
          skippedView
          onUnskip={onUnskip}
        />
      );

      expect(screen.getByText('Skipped')).toBeInTheDocument();
      expect(screen.getByText('By')).toBeInTheDocument();
      expect(screen.getByText('Note')).toBeInTheDocument();
      expect(screen.getByText('annotator')).toBeInTheDocument();
      expect(screen.getByText('two plumes overlap')).toBeInTheDocument();
      expect(screen.getByText(formatDateTime('2026-08-05T10:00:00Z'))).toBeInTheDocument();
    });

    it('unskip button fires the callback, rows do not navigate', () => {
      const item = skippedItem();
      render(
        <ClassifyAlertQueueTable
          items={[item]}
          onAlertClick={onAlertClick}
          skippedView
          onUnskip={onUnskip}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Unskip' }));
      expect(onUnskip).toHaveBeenCalledWith(item);

      fireEvent.click(screen.getByText('two plumes overlap'));
      expect(onAlertClick).not.toHaveBeenCalled();
    });

    it('default view renders no skip columns', () => {
      render(<ClassifyAlertQueueTable items={[createItem()]} onAlertClick={onAlertClick} />);

      expect(screen.queryByText('Skipped')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Unskip' })).not.toBeInTheDocument();
    });
  });

  describe('temporal score column', () => {
    it('renders the alert score as a percentage', () => {
      render(<ClassifyAlertQueueTable items={[createItem()]} onAlertClick={onAlertClick} />);
      expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('renders the not-scored placeholder when the alert has no score', () => {
      render(
        <ClassifyAlertQueueTable
          items={[createItem({ temporal_model_score: null })]}
          onAlertClick={onAlertClick}
        />
      );
      expect(screen.getByTitle('Not scored by the platform')).toBeInTheDocument();
    });

    it('calls onSort with the score field when the Score header is clicked', () => {
      const onSort = vi.fn();
      render(
        <ClassifyAlertQueueTable
          items={[createItem()]}
          onAlertClick={onAlertClick}
          sort={{ orderBy: 'recorded_at', orderDirection: 'desc', onSort }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /score/i }));
      expect(onSort).toHaveBeenCalledWith('temporal_model_score');
    });

    it('marks the Score column as sorted when it is the active field', () => {
      render(
        <ClassifyAlertQueueTable
          items={[createItem()]}
          onAlertClick={onAlertClick}
          sort={{ orderBy: 'temporal_model_score', orderDirection: 'desc', onSort: vi.fn() }}
        />
      );
      const header = screen.getByRole('columnheader', { name: /score/i });
      expect(header).toHaveAttribute('aria-sort', 'descending');
    });

    it('leaves the Score header inert when no sort prop is supplied', () => {
      render(<ClassifyAlertQueueTable items={[createItem()]} onAlertClick={onAlertClick} />);
      expect(screen.queryByRole('button', { name: /score/i })).not.toBeInTheDocument();
    });
  });
});
