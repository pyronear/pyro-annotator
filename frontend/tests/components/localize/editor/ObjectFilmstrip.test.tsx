import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObjectFilmstrip } from '@/components/localize/editor/ObjectFilmstrip';
import type { FilmstripEntry } from '@/utils/annotation/objectFilmstrip';

// The thumbnails draw imperatively onto a canvas jsdom does not implement,
// and fetch their image through the detection-image query. Neither is what
// these tests are about — they assert on cells, badges, runs and selection.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
});

vi.mock('@/services/api', () => ({
  apiClient: { getDetectionImageUrl: vi.fn(() => Promise.resolve('blob:image')) },
}));

const box: [number, number, number, number] = [0.2, 0.2, 0.3, 0.3];

const entries: FilmstripEntry[] = [
  {
    recordedAt: 't1',
    detectionId: 991,
    inObject: false,
    run: 'before',
    committedSource: null,
    availableSource: null,
    xyxyn: null,
  },
  {
    recordedAt: 't2',
    detectionId: 272,
    inObject: true,
    run: 'object',
    committedSource: 'auto',
    availableSource: null,
    xyxyn: box,
  },
  {
    recordedAt: 't3',
    detectionId: 273,
    inObject: true,
    run: 'object',
    committedSource: null,
    availableSource: 'engine',
    xyxyn: box,
  },
  {
    recordedAt: 't4',
    detectionId: 274,
    inObject: true,
    run: 'object',
    committedSource: null,
    availableSource: null,
    xyxyn: null,
  },
  {
    recordedAt: 't5',
    detectionId: 995,
    inObject: false,
    run: 'after',
    committedSource: null,
    availableSource: null,
    xyxyn: null,
  },
];

const renderStrip = (over: Partial<React.ComponentProps<typeof ObjectFilmstrip>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ObjectFilmstrip
        entries={entries}
        currentDetectionId={272}
        onSelect={vi.fn()}
        {...over}
      />
    </QueryClientProvider>
  );
};

describe('ObjectFilmstrip', () => {
  it('renders one cell per alert frame', () => {
    renderStrip();
    expect(screen.getAllByTestId(/^filmstrip-cell-/)).toHaveLength(5);
  });

  it('marks a committed frame with its source, solid', () => {
    renderStrip();
    const cell = screen.getByTestId('filmstrip-cell-272');
    expect(cell).toHaveAttribute('data-state', 'committed');
    expect(cell).toHaveAttribute('data-source', 'auto');
    expect(cell.firstElementChild).toHaveStyle({ borderStyle: 'solid' });
  });

  it('marks an available-but-unaccepted frame with its source, dashed', () => {
    renderStrip();
    const cell = screen.getByTestId('filmstrip-cell-273');
    expect(cell).toHaveAttribute('data-state', 'available');
    expect(cell).toHaveAttribute('data-source', 'engine');
    expect(cell.firstElementChild).toHaveStyle({ borderStyle: 'dashed' });
  });

  it('marks a frame no model found smoke on as a hole in the track', () => {
    renderStrip();
    const cell = screen.getByTestId('filmstrip-cell-274');
    expect(cell).toHaveAttribute('data-state', 'none');
    expect(cell).toHaveAttribute('data-source', '');
  });

  it('marks an out-of-range frame distinctly', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-cell-991')).toHaveAttribute('data-state', 'outside');
  });

  it('renders no source letters — the border carries it', () => {
    renderStrip();
    expect(screen.queryAllByTestId(/^filmstrip-badge-/)).toHaveLength(0);
  });

  it('names each state on the cell, since the strip carries no legend', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-cell-272')).toHaveAttribute(
      'aria-label',
      'auto box accepted'
    );
    expect(screen.getByTestId('filmstrip-cell-273')).toHaveAttribute(
      'aria-label',
      'engine box, not accepted yet'
    );
    expect(screen.getByTestId('filmstrip-cell-274')).toHaveAttribute(
      'aria-label',
      'No box — no model found smoke here'
    );
  });

  it('marks the current frame', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-cell-272')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('filmstrip-cell-273')).toHaveAttribute('aria-current', 'false');
  });

  it('labels the before and after runs', () => {
    renderStrip();
    expect(screen.getByText(/before object/i)).toBeInTheDocument();
    expect(screen.getByText(/^after$/i)).toBeInTheDocument();
  });

  it('renders no run labels when the object covers the whole alert', () => {
    renderStrip({ entries: entries.filter(e => e.inObject) });
    expect(screen.queryByText(/before object/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^after$/i)).not.toBeInTheDocument();
  });

  it('shows the clock time under the current frame only', () => {
    renderStrip({
      entries: entries.map(e => ({ ...e, recordedAt: '2026-07-30T06:53:41' })),
    });
    // Every cell reserves the line so the row height never changes; only the
    // current one fills it.
    expect(screen.getByTestId('filmstrip-cell-272')).toHaveTextContent('06:53:41');
    expect(screen.getByTestId('filmstrip-cell-273')).not.toHaveTextContent('06:53:41');
  });

  it('selects the clicked frame', () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });
    fireEvent.click(screen.getByTestId('filmstrip-cell-273'));
    expect(onSelect).toHaveBeenCalledWith(entries[2]);
  });

  it('reports where you are and how many frames the object is present on', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-summary')).toHaveTextContent(
      'Frame 2 of 5 · object present on 3'
    );
  });

  it('steps through the strip with its own chevrons, via the same callback', () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });

    fireEvent.click(screen.getByTestId('filmstrip-next'));
    expect(onSelect).toHaveBeenCalledWith(entries[2]);

    fireEvent.click(screen.getByTestId('filmstrip-prev'));
    expect(onSelect).toHaveBeenCalledWith(entries[0]);
  });

  it('disables stepping at each end of the alert', () => {
    renderStrip({ currentDetectionId: 991 });
    expect(screen.getByTestId('filmstrip-prev')).toBeDisabled();

    renderStrip({ currentDetectionId: 995 });
    expect(screen.getAllByTestId('filmstrip-next')[1]).toBeDisabled();
  });
});
