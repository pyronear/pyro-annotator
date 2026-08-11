import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddObjectOverlay } from '@/components/localize/add-object/AddObjectOverlay';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';
import type { Detection } from '@/types/api';

vi.mock('@/hooks/useDetectionImage', () => ({
  useDetectionImage: () => ({ data: { url: 'https://img.example/1.jpg' } }),
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
});

// Evenly spaced 30s apart, so an interpolated midpoint is easy to reason about.
const TIMES = [
  '2026-08-11T12:00:00Z',
  '2026-08-11T12:00:30Z',
  '2026-08-11T12:01:00Z',
  '2026-08-11T12:01:30Z',
];

const detection = (id: number, recordedAt: string): Detection =>
  ({
    id,
    sequence_id: 1,
    recorded_at: recordedAt,
    alert_api_id: id,
    bucket_key: `${id}.jpg`,
    created_at: recordedAt,
    algo_predictions: { predictions: [] },
  }) as unknown as Detection;

const alertFrames: AlertFrame[] = TIMES.map((recordedAt, i) => ({
  recordedAt,
  cells: [
    {
      laneSequenceId: 1,
      detectionId: 101 + i,
      cellState: 'auto',
      color: '#2a78d6',
      boxes: [],
    },
  ],
}));

const detectionsById = new Map<number, Detection>(
  TIMES.map((t, i) => [101 + i, detection(101 + i, t)])
);

function renderOverlay(props: Partial<React.ComponentProps<typeof AddObjectOverlay>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreate = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <AddObjectOverlay
        alertFrames={alertFrames}
        detectionsById={detectionsById}
        objectColor="#1baf7a"
        objectLabel="Object 3"
        objectOverlaysByRecordedAt={{}}
        isCreating={false}
        onCreate={onCreate}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>
  );
  return { ...utils, onCreate, onClose };
}

const cell = (t: string) => screen.getByTestId(`range-strip-cell-${t}`);
const createButton = () => screen.getByRole('button', { name: /create object/i });

/**
 * Pins the stage geometry so a drag maps to predictable normalized
 * coordinates — an 800x450 element showing a 1600x900 frame, mirroring the
 * editor's own canvas tests.
 */
const stubGeometry = () => {
  const image = screen.getByAltText(/^Detection /) as HTMLImageElement;
  const container = image.parentElement as HTMLElement;
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450, x: 0, y: 0 }) as DOMRect;
  for (const [prop, value] of [
    ['offsetWidth', 800],
    ['offsetHeight', 450],
  ] as const) {
    Object.defineProperty(container, prop, { value, configurable: true });
  }
  for (const [prop, value] of [
    ['naturalWidth', 1600],
    ['naturalHeight', 900],
    ['offsetWidth', 800],
    ['offsetHeight', 450],
  ] as const) {
    Object.defineProperty(image, prop, { value, configurable: true });
  }
  return image;
};

const drag = (from: [number, number], to: [number, number]) => {
  const image = stubGeometry();
  fireEvent.mouseDown(image, { button: 0, clientX: from[0], clientY: from[1] });
  fireEvent.mouseMove(image, { clientX: to[0], clientY: to[1] });
  fireEvent.mouseUp(image);
};

/** Sets the range to frames 0..2 and boxes both of its anchors. */
const setRangeAndBoxBothAnchors = () => {
  fireEvent.click(cell(TIMES[0]));
  fireEvent.click(cell(TIMES[2]));
  drag([80, 80], [240, 200]); // first anchor — a small box
  fireEvent.click(cell(TIMES[2]));
  drag([80, 80], [480, 380]); // last anchor — a bigger one
};

describe('AddObjectOverlay range selection', () => {
  it('starts with nothing in range and Create disabled', () => {
    renderOverlay();
    expect(screen.getAllByTestId(/^range-strip-cell-/)).toHaveLength(4);
    expect(
      screen.queryAllByTestId(/^range-strip-cell-/).filter(el => el.hasAttribute('data-in-range'))
    ).toHaveLength(0);
    expect(createButton()).toBeDisabled();
  });

  it('treats the first click as a one-frame range', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[1]));
    const inRange = screen
      .getAllByTestId(/^range-strip-cell-/)
      .filter(el => el.getAttribute('data-in-range') === 'true');
    expect(inRange).toHaveLength(1);
    expect(cell(TIMES[1])).toHaveAttribute('data-anchor', 'true');
  });

  it('completes the range on the second click', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    expect(cell(TIMES[0])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[1])).toHaveAttribute('data-in-range', 'true');
    expect(cell(TIMES[1])).not.toHaveAttribute('data-anchor');
    expect(cell(TIMES[2])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[3])).not.toHaveAttribute('data-in-range');
  });

  it('normalises a backwards selection', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[2]));
    fireEvent.click(cell(TIMES[0]));
    expect(cell(TIMES[0])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[2])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[1])).toHaveAttribute('data-in-range', 'true');
  });
});

describe('AddObjectOverlay drawing', () => {
  it('keeps Create disabled until BOTH anchors are boxed', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    expect(createButton()).toBeDisabled();

    drag([80, 80], [240, 200]);
    // One anchor down, one to go — copying this box across the range is
    // exactly what interpolation exists to avoid.
    expect(createButton()).toBeDisabled();

    fireEvent.click(cell(TIMES[2]));
    drag([80, 80], [480, 380]);
    expect(createButton()).toBeEnabled();
  });

  it('enables Create after one box when the range is a single frame', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[1]));
    fireEvent.click(cell(TIMES[1]));
    drag([80, 80], [240, 200]);
    expect(createButton()).toBeEnabled();
  });

  it('sends one entry per in-range frame, interpolated between the anchors', () => {
    const { onCreate } = renderOverlay();
    setRangeAndBoxBothAnchors();
    fireEvent.click(createButton());

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [frames, smokeType] = onCreate.mock.calls[0];
    expect(frames.map((f: { recordedAt: string }) => f.recordedAt)).toEqual([
      TIMES[0],
      TIMES[1],
      TIMES[2],
    ]);
    expect(smokeType).toBe('wildfire');

    // The middle box lies strictly between the two anchors rather than
    // repeating either of them.
    const [w0, w1, w2] = frames.map(
      (f: { xyxyn: [number, number, number, number] }) => f.xyxyn[2] - f.xyxyn[0]
    );
    expect(w1).toBeGreaterThan(w0);
    expect(w1).toBeLessThan(w2);
  });

  it('sends the chosen smoke type', () => {
    const { onCreate } = renderOverlay();
    setRangeAndBoxBothAnchors();
    // A radiogroup, like the missed-smoke row's own Yes/No: one choice, not
    // three independent buttons.
    fireEvent.click(screen.getByRole('radio', { name: /industrial/i }));
    fireEvent.click(createButton());
    expect(onCreate.mock.calls[0][1]).toBe('industrial');
  });

  it('drops the boxes when the range is restarted', () => {
    renderOverlay();
    setRangeAndBoxBothAnchors();
    expect(createButton()).toBeEnabled();

    fireEvent.click(screen.getByTestId('restart-range'));
    // Re-anchoring a box onto a frame that may have left the range is not
    // worth the complexity, so the anchors are simply re-asked.
    expect(createButton()).toBeDisabled();
  });
});

describe('AddObjectOverlay range restart', () => {
  it('offers no restart before anything is selected', () => {
    renderOverlay();
    expect(screen.queryByTestId('restart-range')).not.toBeInTheDocument();
  });

  it('undoes a mis-clicked first frame mid-selection', () => {
    // The two-click gesture has no natural undo: without this, a wrong first
    // click strands you until you commit a range you did not want.
    renderOverlay();
    fireEvent.click(cell(TIMES[3]));
    expect(cell(TIMES[3])).toHaveAttribute('data-anchor', 'true');

    fireEvent.click(screen.getByTestId('restart-range'));
    expect(
      screen.queryAllByTestId(/^range-strip-cell-/).filter(el => el.hasAttribute('data-in-range'))
    ).toHaveLength(0);

    // And the next click starts a fresh first anchor rather than completing
    // the abandoned one.
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[1]));
    expect(cell(TIMES[0])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[1])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[3])).not.toHaveAttribute('data-in-range');
  });

  it('restarts from the draw phase too', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    fireEvent.click(screen.getByTestId('restart-range'));

    // Back to choosing: the next two clicks set a range again rather than
    // being swallowed as draw-phase frame steps.
    fireEvent.click(cell(TIMES[1]));
    fireEvent.click(cell(TIMES[3]));
    expect(cell(TIMES[0])).not.toHaveAttribute('data-in-range');
    expect(cell(TIMES[1])).toHaveAttribute('data-anchor', 'true');
    expect(cell(TIMES[3])).toHaveAttribute('data-anchor', 'true');
  });
});

describe('AddObjectOverlay stage geometry', () => {
  it('centres the stage, which the coordinate maths depends on', () => {
    // `calculateImageBounds` locates an object-contain image by assuming it is
    // CENTRED in its container, and the canvas root shrink-wraps the <img>.
    // Without centring the container stretches to the full panel width while
    // the image stays left-aligned, and every screen-to-image conversion is
    // off by half the leftover width — boxes land away from the cursor.
    // jsdom does no layout, so the fixture cannot catch this by measuring;
    // this pins the contract the maths relies on instead.
    renderOverlay();
    const image = screen.getByAltText(/^Detection /);
    const stage = image.parentElement?.parentElement as HTMLElement;
    expect(stage.className).toContain('items-center');
    expect(stage.className).toContain('justify-center');
  });
});

describe('AddObjectOverlay exit', () => {
  it('closes on Escape without creating anything', () => {
    const { onCreate, onClose } = renderOverlay();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does not create anything until Create is pressed', () => {
    const { onCreate } = renderOverlay();
    setRangeAndBoxBothAnchors();
    // Nothing autosaves here: the object does not exist until Create.
    expect(onCreate).not.toHaveBeenCalled();
  });
});
