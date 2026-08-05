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

  it('badges a committed box with its source initial', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-badge-272')).toHaveTextContent('A');
  });

  it('badges an available-but-uncommitted source in lowercase', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-badge-273')).toHaveTextContent('e');
  });

  it('badges an in-object frame with no box at all', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-badge-274')).toHaveTextContent('—');
  });

  it('badges an out-of-range frame distinctly', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-badge-991')).toHaveTextContent('·');
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

  it('selects the clicked frame', () => {
    const onSelect = vi.fn();
    renderStrip({ onSelect });
    fireEvent.click(screen.getByTestId('filmstrip-cell-273'));
    expect(onSelect).toHaveBeenCalledWith(entries[2]);
  });

  it('reports how many frames the object is present on', () => {
    renderStrip();
    expect(screen.getByTestId('filmstrip-summary')).toHaveTextContent('3 of 5');
  });
});
