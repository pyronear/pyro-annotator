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

// Evenly spaced 30s apart.
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

/** Sets the range to frames 0..2 and draws the single box on its first frame. */
const setRangeAndBox = () => {
  fireEvent.click(cell(TIMES[0]));
  fireEvent.click(cell(TIMES[2]));
  drag([80, 80], [240, 200]);
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
  it('keeps Create disabled until the box is drawn', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    expect(createButton()).toBeDisabled();

    drag([80, 80], [240, 200]);
    expect(createButton()).toBeEnabled();
  });

  it('enables Create after one box when the range is a single frame', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[1]));
    fireEvent.click(cell(TIMES[1]));
    drag([80, 80], [240, 200]);
    expect(createButton()).toBeEnabled();
  });

  it('only the first frame of the range accepts a box', () => {
    const { onCreate } = renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));

    // There is one box and it belongs to the start of the range; the other
    // in-range frames show the copy but are not drawable.
    fireEvent.click(cell(TIMES[1]));
    drag([80, 80], [240, 200]);
    expect(createButton()).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('sends one entry per in-range frame, all carrying the same box', () => {
    const { onCreate } = renderOverlay();
    setRangeAndBox();
    fireEvent.click(createButton());

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [frames, smokeType] = onCreate.mock.calls[0];
    expect(frames.map((f: { recordedAt: string }) => f.recordedAt)).toEqual([
      TIMES[0],
      TIMES[1],
      TIMES[2],
    ]);
    expect(smokeType).toBe('wildfire');

    // Every frame gets the identical box — a first draft to refine per frame
    // in the editor afterwards, not a finished track.
    const boxes = frames.map((f: { xyxyn: [number, number, number, number] }) => f.xyxyn);
    expect(boxes[1]).toEqual(boxes[0]);
    expect(boxes[2]).toEqual(boxes[0]);
  });

  it('sends the chosen smoke type', () => {
    const { onCreate } = renderOverlay();
    setRangeAndBox();
    // A radiogroup, like the missed-smoke row's own Yes/No: one choice, not
    // three independent buttons.
    fireEvent.click(screen.getByRole('radio', { name: /industrial/i }));
    fireEvent.click(createButton());
    expect(onCreate.mock.calls[0][1]).toBe('industrial');
  });

  it('drops the boxes when the range is restarted', () => {
    renderOverlay();
    setRangeAndBox();
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

describe('AddObjectOverlay guidance', () => {
  it('puts the prompt on the strip while the range is being chosen', () => {
    // The strip is what you have to click in step 1, and it is at the opposite
    // edge from the stage — a caption floating over the image cannot say "act
    // down there".
    renderOverlay();
    const prompt = screen.getByTestId('add-object-instruction');
    const strip = cell(TIMES[0]).closest('div')?.parentElement as HTMLElement;
    expect(strip.contains(prompt)).toBe(true);
    expect(prompt).toHaveTextContent(/step 1 of 3/i);
    expect(prompt).toHaveTextContent(/click the first frame/i);
  });

  it('moves the prompt onto the stage once drawing starts', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));

    const prompt = screen.getByTestId('add-object-instruction');
    const strip = cell(TIMES[0]).closest('div')?.parentElement as HTMLElement;
    expect(strip.contains(prompt)).toBe(false);
    expect(prompt).toHaveTextContent(/step 2 of 3/i);
    expect(prompt).toHaveTextContent(/drag a box/i);
  });

  it('advances to step 3 once the box is drawn, and carries the button', () => {
    // Creating IS a step: the object does not exist until the button is
    // pressed, and the button that presses it lives in the prompt naming it.
    renderOverlay();
    setRangeAndBox();

    const prompt = screen.getByTestId('add-object-instruction');
    expect(prompt).toHaveTextContent(/step 3 of 3/i);
    expect(prompt).toHaveTextContent(/create the object/i);
    expect(prompt.contains(createButton())).toBe(true);
  });

  it('places Create right after the instruction, not at the far edge', () => {
    // The eye lands there once it has finished reading the sentence naming
    // the action; a CTA pinned to the right edge has to be found.
    renderOverlay();
    const children = Array.from(screen.getByTestId('add-object-instruction').children);
    const buttonIndex = children.indexOf(screen.getByTestId('create-object'));
    const hintIndex = children.findIndex(el => /preview a frame/i.test(el.textContent ?? ''));
    expect(buttonIndex).toBeGreaterThan(-1);
    expect(hintIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeLessThan(hintIndex);
  });

  it('keeps the smoke type in the step ribbon, beside Create', () => {
    // It is a decision the flow has to make, not chrome, and it is wanted at
    // the same moment as Create.
    renderOverlay();
    const prompt = screen.getByTestId('add-object-instruction');
    expect(prompt.contains(screen.getByRole('radio', { name: /wildfire/i }))).toBe(true);
    expect(screen.getAllByRole('radio', { name: /wildfire/i })).toHaveLength(1);
  });

  it('names the type check in the step 3 copy', () => {
    renderOverlay();
    setRangeAndBox();
    expect(screen.getByTestId('add-object-instruction')).toHaveTextContent(/check the type/i);
  });

  it('keeps exactly one Create button, in the prompt', () => {
    renderOverlay();
    expect(screen.getAllByTestId('create-object')).toHaveLength(1);
    setRangeAndBox();
    expect(screen.getAllByTestId('create-object')).toHaveLength(1);
    expect(
      screen.getByTestId('add-object-instruction').contains(screen.getByTestId('create-object'))
    ).toBe(true);
  });

  it('tracks progress through the range selection', () => {
    renderOverlay();
    expect(screen.getByTestId('add-object-instruction')).toHaveTextContent(/first frame/i);
    fireEvent.click(cell(TIMES[0]));
    expect(screen.getByTestId('add-object-instruction')).toHaveTextContent(/last frame/i);
  });

  it('shows only one prompt at a time', () => {
    renderOverlay();
    expect(screen.getAllByTestId('add-object-instruction')).toHaveLength(1);
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    expect(screen.getAllByTestId('add-object-instruction')).toHaveLength(1);
  });
});

describe('AddObjectOverlay read-only frames', () => {
  const stageContainer = () => screen.getByAltText(/^Detection /).parentElement as HTMLElement;

  const startDrag = () => {
    const image = stubGeometry();
    // The drawing overlay only renders once the image has reported its
    // geometry, so without this the "no rubber band" assertions would pass
    // whether or not the drag was refused.
    fireEvent.load(image);
    fireEvent.mouseDown(image, { button: 0, clientX: 80, clientY: 80 });
    fireEvent.mouseMove(image, { clientX: 240, clientY: 200 });
  };

  it('offers no crosshair while the range is still being chosen', () => {
    renderOverlay();
    stubGeometry();
    expect(stageContainer().style.cursor).toBe('default');
  });

  it('starts no rubber band while the range is still being chosen', () => {
    // Refusing only at mouse-up would let the drag play out in full and then
    // silently discard it, which reads as broken rather than unavailable.
    renderOverlay();
    startDrag();
    expect(screen.queryByTestId('current-drawing')).not.toBeInTheDocument();
    fireEvent.mouseUp(stubGeometry());
    expect(createButton()).toBeDisabled();
  });

  it('DOES show a rubber band on the frame that takes the box', () => {
    // Guards the two negative assertions above from passing vacuously: the
    // drawing overlay only renders once the image has reported its geometry.
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    fireEvent.load(stubGeometry());
    startDrag();
    expect(screen.getByTestId('current-drawing')).toBeInTheDocument();
  });

  it('offers the crosshair on the frame that takes the box', () => {
    renderOverlay();
    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    stubGeometry();
    expect(stageContainer().style.cursor).toBe('crosshair');
  });

  it('goes read-only again on the other frames of the range', () => {
    renderOverlay();
    setRangeAndBox();
    expect(createButton()).toBeEnabled();

    fireEvent.click(cell(TIMES[1]));
    stubGeometry();
    expect(stageContainer().style.cursor).toBe('default');

    // And a drag there leaves the box that was already drawn untouched.
    startDrag();
    expect(screen.queryByTestId('current-drawing')).not.toBeInTheDocument();
    fireEvent.mouseUp(stubGeometry());
    expect(createButton()).toBeEnabled();
  });
});

describe('AddObjectOverlay create affordance', () => {
  it('glows only once the box is drawn', () => {
    // The drawing happens at the far end of the bar from the button, so the
    // one remaining action has to claim the eye.
    renderOverlay();
    expect(createButton().className).not.toContain('animate-pine-glow');

    fireEvent.click(cell(TIMES[0]));
    fireEvent.click(cell(TIMES[2]));
    expect(createButton().className).not.toContain('animate-pine-glow');

    drag([80, 80], [240, 200]);
    expect(createButton().className).toContain('animate-pine-glow');
  });

  it('respects reduced motion', () => {
    renderOverlay();
    setRangeAndBox();
    expect(createButton().className).toContain('motion-reduce:animate-none');
  });

  it('stops glowing while the create is in flight', () => {
    const { rerender } = renderOverlay();
    setRangeAndBox();
    expect(createButton().className).toContain('animate-pine-glow');

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AddObjectOverlay
          alertFrames={alertFrames}
          detectionsById={detectionsById}
          objectColor="#1baf7a"
          objectLabel="Object 3"
          objectOverlaysByRecordedAt={{}}
          isCreating
          onCreate={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    expect(createButton().className).not.toContain('animate-pine-glow');
  });

  it('stops glowing when the range is restarted', () => {
    renderOverlay();
    setRangeAndBox();
    fireEvent.click(screen.getByTestId('restart-range'));
    expect(createButton().className).not.toContain('animate-pine-glow');
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
    setRangeAndBox();
    // Nothing autosaves here: the object does not exist until Create.
    expect(onCreate).not.toHaveBeenCalled();
  });
});
