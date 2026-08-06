import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocalizeObjectEditor } from '@/components/localize/editor/LocalizeObjectEditor';
import type { Detection, DetectionAnnotation } from '@/types/api';
import type { AlertFrame } from '@/utils/annotation/alertLocalizeUtils';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'];
});

vi.mock('@/hooks/useDetectionImage', () => ({
  useDetectionImage: () => ({ data: { url: 'https://img.example/1.jpg' } }),
}));

const LANE = 27;
const SIBLING = 99;

/** Alert of 5 frames; the object is on frames 3 and 4 only. */
const TIMES = ['t001', 't002', 't003', 't004', 't005'];
const OBJECT_TIMES = ['t003', 't004'];

const alertFrames: AlertFrame[] = TIMES.map(recordedAt => ({
  recordedAt,
  cells: [
    {
      laneSequenceId: SIBLING,
      detectionId: 99000 + Number(recordedAt.slice(1)),
      cellState: 'auto' as const,
      boxes: [],
    },
    ...(OBJECT_TIMES.includes(recordedAt)
      ? [
          {
            laneSequenceId: LANE,
            detectionId: 27000 + Number(recordedAt.slice(1)),
            cellState: 'auto' as const,
            boxes: [],
          },
        ]
      : []),
  ],
}));

const makeDetection = (recordedAt: string, withBoxes = true): Detection =>
  ({
    id: 27000 + Number(recordedAt.slice(1)),
    sequence_id: LANE,
    recorded_at: recordedAt,
    bucket_key: 'k.jpg',
    auto_predictions: withBoxes
      ? { predictions: [{ xyxyn: [0.2, 0.2, 0.3, 0.3], confidence: 0.87, class_name: 'smoke' }] }
      : { predictions: [] },
    algo_predictions: withBoxes
      ? { predictions: [{ xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.5, class_name: 'smoke' }] }
      : { predictions: [] },
  }) as unknown as Detection;

const laneDetections = OBJECT_TIMES.map(t => makeDetection(t));
const [firstDetection, lastDetection] = laneDetections;
const detectionWithNoBoxes = makeDetection('t003', false);

const committedAnnotation = (detectionId: number, origin: string): DetectionAnnotation =>
  ({
    id: 5,
    detection_id: detectionId,
    annotation: {
      annotation: [
        { xyxyn: [0.2, 0.2, 0.3, 0.3], class_name: 'smoke', smoke_type: 'wildfire', origin },
      ],
    },
  }) as unknown as DetectionAnnotation;

type Props = React.ComponentProps<typeof LocalizeObjectEditor>;

const baseProps = (): Props => ({
  laneSequenceId: LANE,
  objectLabel: 'Object 2',
  objectColor: '#2a78d6',
  smokeType: 'wildfire',
  detection: firstDetection,
  existingAnnotation: null,
  laneDetections,
  laneAnnotations: [],
  alertFrames,
  objectOverlays: [],
  isSaving: false,
  isAccepting: false,
  onCommit: vi.fn(),
  onAcceptRemaining: vi.fn(),
  onReclassify: vi.fn(),
  onNavigateToDetection: vi.fn(),
  onClose: vi.fn(),
});

const editorWith = (over: Partial<Props> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <LocalizeObjectEditor {...baseProps()} {...over} />
    </QueryClientProvider>
  );
};

const renderEditor = (over: Partial<Props> = {}) => render(editorWith(over));

/**
 * Box overlays only render once the frame image has loaded — the editor needs
 * its on-screen geometry to place them. jsdom never fires `load` on its own,
 * so tests that assert on boxes have to.
 */
const renderLoadedEditor = (over: Partial<Props> = {}) => {
  const result = renderEditor(over);
  fireEvent.load(screen.getByAltText(/^Detection /));
  return result;
};

beforeEach(() => vi.clearAllMocks());

describe('LocalizeObjectEditor', () => {
  it('commits the clicked candidate with its own origin', () => {
    const onCommit = vi.fn();
    renderEditor({ onCommit });
    fireEvent.click(screen.getByTestId('source-row-engine'));
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: firstDetection.id }),
      [
        {
          xyxyn: [0.1, 0.1, 0.4, 0.4],
          class_name: 'smoke',
          smoke_type: 'wildfire',
          origin: 'engine',
        },
      ]
    );
  });

  it('commits nothing when Clear is pressed', () => {
    const onCommit = vi.fn();
    renderEditor({
      onCommit,
      existingAnnotation: committedAnnotation(firstDetection.id, 'auto'),
    });
    fireEvent.click(screen.getByTestId('editor-clear'));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: firstDetection.id }), []);
  });

  it('Enter commits the priority pick and advances', () => {
    const onCommit = vi.fn();
    const onNavigateToDetection = vi.fn();
    renderEditor({ onCommit, onNavigateToDetection });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: firstDetection.id }),
      [expect.objectContaining({ origin: 'auto' })]
    );
    expect(onNavigateToDetection).toHaveBeenCalledWith(lastDetection.id);
  });

  it('Enter neither commits nor advances on a frame with no candidate', () => {
    const onCommit = vi.fn();
    const onNavigateToDetection = vi.fn();
    renderEditor({
      onCommit,
      onNavigateToDetection,
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
    });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onNavigateToDetection).not.toHaveBeenCalled();
  });

  it('arrow keys step frames without saving', () => {
    const onCommit = vi.fn();
    const onNavigateToDetection = vi.fn();
    renderEditor({ onCommit, onNavigateToDetection });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigateToDetection).toHaveBeenCalledWith(lastDetection.id);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not step past the last frame', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection, detection: lastDetection });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigateToDetection).not.toHaveBeenCalled();
  });

  it('hides the losing candidates once a box is committed, and G reveals them', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });

    // The committed box speaks for the object; the losers are noise, and the
    // rail's crops carry the comparison.
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-auto-0')).not.toBeInTheDocument();
  });

  it('ghosts only the priority pick when nothing is committed', () => {
    renderLoadedEditor();

    // The idle stage answers "is the box Enter would commit right?" — the
    // rail's crops carry the auto-vs-engine comparison, so the losing
    // candidate stacking onto the same plume is noise.
    expect(screen.queryByTestId('committed-box')).not.toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('G cycles the stage through pick, every candidate, none, and back', () => {
    renderLoadedEditor();

    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.queryByTestId('ghost-box-auto-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('the none state hides the committed box too, for a bare view of the plume', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });

    fireEvent.keyDown(window, { key: 'g' }); // all
    fireEvent.keyDown(window, { key: 'g' }); // none
    expect(screen.queryByTestId('committed-box')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('the G cycle resets to the default on frame change', () => {
    const { rerender } = renderLoadedEditor();
    fireEvent.keyDown(window, { key: 'g' }); // all
    fireEvent.keyDown(window, { key: 'g' }); // none

    rerender(editorWith({ detection: lastDetection }));
    fireEvent.load(screen.getByAltText(/^Detection /));
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('hovering a rail row solos that candidate over the committed box', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();

    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
    expect(screen.queryByTestId('committed-box')).not.toBeInTheDocument();

    fireEvent.mouseOut(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('hover preview solos the candidate on an undecided frame too', () => {
    renderLoadedEditor();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();

    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-auto-0')).not.toBeInTheDocument();
  });

  it('a hover preview overrides the none state and releases back to it', () => {
    renderLoadedEditor();
    fireEvent.keyDown(window, { key: 'g' }); // all
    fireEvent.keyDown(window, { key: 'g' }); // none

    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();

    fireEvent.mouseOut(screen.getByTestId('source-row-engine'));
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-auto-0')).not.toBeInTheDocument();
  });

  it('clears a live preview when the frame changes under it', () => {
    const { rerender } = renderLoadedEditor();
    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();

    rerender(editorWith({ detection: lastDetection }));
    fireEvent.load(screen.getByAltText(/^Detection /));
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
  });

  it('releases the preview when the hovered row wins a commit', () => {
    // Engine is the only candidate, so Enter commits the very row being
    // hovered — which disables it in place, and a disabled button never
    // fires mouseleave. The commit itself must release the preview, or the
    // stage keeps a dashed read-only ghost where the solid committed box
    // should be. The open detection never changes here (navigation is the
    // URL's job, mocked away), so no frame-change reset runs either.
    const engineOnly = {
      ...firstDetection,
      auto_predictions: { predictions: [] },
    } as unknown as Detection;
    const { rerender } = renderLoadedEditor({
      detection: engineOnly,
      laneDetections: [engineOnly, lastDetection],
    });

    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    fireEvent.keyDown(window, { key: 'Enter' });

    // The save round-trip lands the commit.
    rerender(
      editorWith({
        detection: engineOnly,
        laneDetections: [engineOnly, lastDetection],
        existingAnnotation: committedAnnotation(engineOnly.id, 'engine'),
      })
    );
    fireEvent.load(screen.getByAltText(/^Detection /));
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('drops the preview when peeking out of range, so it is not stale on return', () => {
    renderLoadedEditor();
    fireEvent.mouseOver(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();

    // Peek disables the rail in place — no mouseleave will ever fire — and
    // does not change detection.id, so the frame-change reset never runs.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
  });

  it('leaves Enter to a focused rail row, so it commits what it previews', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    const row = screen.getByTestId('source-row-engine');
    row.focus();

    // Enter pressed ON the row must not reach the global accept-and-next —
    // the row's focus preview shows engine, and the button's own native
    // activation is what commits it. (jsdom doesn't run native activation,
    // so the observable here is the suppressed global commit.)
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Escape closes', () => {
    const onClose = vi.fn();
    renderEditor({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the object identity and smoke type read-only', () => {
    renderEditor();
    const identity = screen.getByTestId('editor-object-identity');
    expect(identity).toHaveTextContent('Object 2');
    expect(identity).toHaveTextContent('wildfire');
    expect(screen.queryByTestId('smoke-type-selector')).not.toBeInTheDocument();
  });

  it('renders the filmstrip over the alert range, not the lane range', () => {
    renderEditor();
    expect(screen.getAllByTestId(/^filmstrip-cell-/)).toHaveLength(5);
  });

  it('marks the committed source in the rail', () => {
    renderEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'engine') });
    expect(screen.getByTestId('source-row-engine')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('source-row-auto')).toHaveAttribute('aria-pressed', 'false');
  });

  it('navigates when a filmstrip cell inside the object is clicked', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection });
    fireEvent.click(screen.getByTestId(`filmstrip-cell-${lastDetection.id}`));
    expect(onNavigateToDetection).toHaveBeenCalledWith(lastDetection.id);
  });
});

describe('LocalizeObjectEditor canvas', () => {
  /**
   * jsdom lays nothing out, so every rect is zero and the editor's coordinate
   * maths collapses to a single point. These give the image a plausible
   * geometry so a drag produces a real box; the numbers are arbitrary but
   * consistent (an 800x450 element showing a 1600x900 frame).
   */
  const stubGeometry = () => {
    const image = screen.getByAltText(/^Detection /) as HTMLImageElement;
    const container = image.parentElement as HTMLElement;
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 800, bottom: 450, width: 800, height: 450, x: 0, y: 0 }) as DOMRect;
    for (const [prop, value] of [
      ['naturalWidth', 1600],
      ['naturalHeight', 900],
      ['offsetWidth', 800],
      ['offsetHeight', 450],
    ] as const) {
      Object.defineProperty(image, prop, { value, configurable: true });
    }
    // Full frame, so the drag maths is not also exercising the zoom transform.
    fireEvent.keyDown(window, { key: 'r' });
    return image;
  };

  const drag = (from: [number, number], to: [number, number], init: object = {}) => {
    const image = stubGeometry();
    fireEvent.mouseDown(image, { button: 0, clientX: from[0], clientY: from[1], ...init });
    fireEvent.mouseMove(image, { clientX: to[0], clientY: to[1] });
    fireEvent.mouseUp(image);
  };

  it('draws on a plain drag, with nothing to arm first', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    drag([40, 40], [400, 300]);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ id: firstDetection.id }),
      [expect.objectContaining({ origin: 'human' })]
    );
  });

  it('suspends a preview while a box is being drawn', () => {
    renderLoadedEditor();
    fireEvent.focus(screen.getByTestId('source-row-engine'));
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();

    // Mid-drag the preview yields: the stage is about the box being drawn,
    // with the idle pick ghost back as its reference.
    const image = stubGeometry();
    fireEvent.mouseDown(image, { button: 0, clientX: 40, clientY: 40 });
    fireEvent.mouseMove(image, { clientX: 400, clientY: 300 });
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    fireEvent.mouseUp(image);
  });

  it('treats a press that never moved as a click, not a box', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    drag([50, 50], [50, 50]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('deselects the box on a press that never moved', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'human') });
    fireEvent.mouseDown(screen.getByTestId('drawn-box-committed'));
    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);

    drag([50, 50], [50, 50]);
    expect(screen.queryAllByTestId(/^resize-handle-/)).toHaveLength(0);
  });

  it('pans instead of drawing while space is held', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });

    fireEvent.keyDown(window, { code: 'Space' });
    drag([40, 40], [400, 300]);
    expect(onCommit).not.toHaveBeenCalled();

    // Releasing space hands the drag back to drawing.
    fireEvent.keyUp(window, { code: 'Space' });
    drag([40, 40], [400, 300]);
    expect(onCommit).toHaveBeenCalled();
  });

  it('pans on a middle-button drag, with no keyboard involved', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    drag([40, 40], [400, 300], { button: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('lets go of space when the window loses focus mid-hold', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    fireEvent.keyDown(window, { code: 'Space' });
    fireEvent.blur(window);
    drag([40, 40], [400, 300]);
    expect(onCommit).toHaveBeenCalled();
  });

  it('leaves space alone when a button has focus, so it still activates it', () => {
    renderLoadedEditor();
    const button = screen.getByTestId('editor-zoom-toggle');
    button.focus();
    const event = new KeyboardEvent('keydown', { code: 'Space', cancelable: true, bubbles: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('LocalizeObjectEditor box selection', () => {
  const committed = () => committedAnnotation(firstDetection.id, 'human');

  it('leaves the committed box unselected on arrival, so it shows no handles', () => {
    renderLoadedEditor({ existingAnnotation: committed() });
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
    expect(screen.queryByTestId(/^resize-handle-/)).not.toBeInTheDocument();
  });

  it('selects the box on click, revealing its handles', () => {
    renderLoadedEditor({ existingAnnotation: committed() });
    fireEvent.mouseDown(screen.getByTestId('drawn-box-committed'));
    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);
  });

  it('Escape deselects before it closes', () => {
    const onClose = vi.fn();
    renderLoadedEditor({ existingAnnotation: committed(), onClose });

    fireEvent.mouseDown(screen.getByTestId('drawn-box-committed'));
    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId(/^resize-handle-/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('deselects on a click away from the box', () => {
    renderLoadedEditor({ existingAnnotation: committed() });
    fireEvent.mouseDown(screen.getByTestId('drawn-box-committed'));
    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);

    // A real click is mousedown then click.
    const image = screen.getByAltText(/^Detection /);
    fireEvent.mouseDown(image);
    fireEvent.click(image);
    expect(screen.queryAllByTestId(/^resize-handle-/)).toHaveLength(0);
  });

  it('does not deselect on the very click that selected the box', () => {
    renderLoadedEditor({ existingAnnotation: committed() });
    const box = screen.getByTestId('drawn-box-committed');

    // A real press on the box fires mousedown then a click that bubbles to
    // the canvas; the selection must survive it.
    fireEvent.mouseDown(box);
    fireEvent.click(box);
    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);
  });

  it('removes the committed box with Delete', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ existingAnnotation: committed(), onCommit });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: firstDetection.id }), []);
  });

  it('removes it with Backspace too — the Mac delete key emits that', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ existingAnnotation: committed(), onCommit });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: firstDetection.id }), []);
  });

  it('Delete does nothing on a frame with no committed box', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Delete does nothing on an out-of-range frame', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ existingAnnotation: committed(), onCommit });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('drops the selection when the frame changes', () => {
    const { rerender } = renderLoadedEditor({ existingAnnotation: committed() });
    fireEvent.mouseDown(screen.getByTestId('drawn-box-committed'));
    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);

    rerender(
      editorWith({
        detection: lastDetection,
        existingAnnotation: committedAnnotation(lastDetection.id, 'human'),
      })
    );
    fireEvent.load(screen.getByAltText(/^Detection /));
    expect(screen.queryByTestId(/^resize-handle-/)).not.toBeInTheDocument();
  });
});

describe('LocalizeObjectEditor accept remaining', () => {
  it('offers Reclassify beside it, for the object rather than the frame', () => {
    const onReclassify = vi.fn();
    renderEditor({ onReclassify });
    fireEvent.click(screen.getByTestId('editor-reclassify'));
    expect(onReclassify).toHaveBeenCalled();
  });

  it('hides Reclassify on an out-of-range frame', () => {
    renderEditor();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('editor-reclassify')).not.toBeInTheDocument();
  });

  it('keeps Reclassify once every frame has a box, unlike Accept', () => {
    renderEditor({
      laneAnnotations: [
        committedAnnotation(firstDetection.id, 'auto'),
        committedAnnotation(lastDetection.id, 'auto'),
      ],
    });
    expect(screen.queryByTestId('editor-accept-remaining')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-reclassify')).toBeInTheDocument();
  });

  it('offers the action only while frames are still without a box', () => {
    renderEditor();
    // Same name the cockpit's per-object action carries, so the two read as
    // one action met in two places.
    expect(screen.getByTestId('editor-accept-remaining')).toHaveTextContent('Accept boxes');
  });

  it('hides the action once every frame has a box', () => {
    renderEditor({
      laneAnnotations: [
        committedAnnotation(firstDetection.id, 'auto'),
        committedAnnotation(lastDetection.id, 'auto'),
      ],
    });
    expect(screen.queryByTestId('editor-accept-remaining')).not.toBeInTheDocument();
  });

  it('confirms before writing, and does not write when dismissed', () => {
    const onAcceptRemaining = vi.fn();
    renderEditor({ onAcceptRemaining });

    fireEvent.click(screen.getByTestId('editor-accept-remaining'));
    expect(screen.getByTestId('accept-remaining-popover')).toBeInTheDocument();
    expect(onAcceptRemaining).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('accept-remaining-close'));
    expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    expect(onAcceptRemaining).not.toHaveBeenCalled();
  });

  it('closes on a second press of its own button', () => {
    renderEditor();
    const trigger = screen.getByTestId('editor-accept-remaining');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click outside it', () => {
    const onAcceptRemaining = vi.fn();
    renderEditor({ onAcceptRemaining });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    expect(onAcceptRemaining).not.toHaveBeenCalled();
  });

  it('stays open when clicking inside it', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    fireEvent.mouseDown(screen.getByTestId('accept-remaining-popover'));
    expect(screen.getByTestId('accept-remaining-popover')).toBeInTheDocument();
  });

  it('writes on confirm and closes the dialog', () => {
    const onAcceptRemaining = vi.fn();
    renderEditor({ onAcceptRemaining });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));
    fireEvent.click(screen.getByTestId('accept-remaining-confirm'));
    expect(onAcceptRemaining).toHaveBeenCalled();
    expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
  });

  it('leaves Enter to a focused control inside the dialog instead of accepting', () => {
    const onAcceptRemaining = vi.fn();
    renderEditor({ onAcceptRemaining });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    // Tab put focus on the close X — Enter must activate IT (natively), not
    // fire the accept out from under it.
    const close = screen.getByTestId('accept-remaining-close');
    close.focus();
    fireEvent.keyDown(close, { key: 'Enter' });

    expect(onAcceptRemaining).not.toHaveBeenCalled();
    expect(screen.getByTestId('accept-remaining-popover')).toBeInTheDocument();
  });

  it('Enter confirms while the dialog is open, not the frame-level accept', () => {
    const onAcceptRemaining = vi.fn();
    const onCommit = vi.fn();
    renderEditor({ onAcceptRemaining, onCommit });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onAcceptRemaining).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    // The dialog owned that Enter — the frame's own accept must not fire.
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('warns about frames no model found smoke on, without blocking', () => {
    // One frame has candidates, the other has none at all.
    renderEditor({
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
    });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    expect(screen.getByTestId('accept-remaining-gap-warning')).toHaveTextContent(
      'One frame has no box at all'
    );
    expect(screen.getByTestId('accept-remaining-confirm')).not.toBeDisabled();
  });

  it('does not warn when every remaining frame has a box on offer', () => {
    renderEditor();
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));
    expect(screen.queryByTestId('accept-remaining-gap-warning')).not.toBeInTheDocument();
  });

  it('Escape closes the dialog before it closes the editor', () => {
    const onClose = vi.fn();
    renderEditor({ onClose });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Migrated from the deleted ImageModal test suite: behaviours the new editor
// keeps and that nothing else covers.
describe('LocalizeObjectEditor chrome', () => {
  it('closes from the close button', () => {
    const onClose = vi.fn();
    renderEditor({ onClose });
    fireEvent.click(screen.getByTestId('editor-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('steps with the prev/next buttons', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection });
    fireEvent.click(screen.getByTestId('filmstrip-next'));
    expect(onNavigateToDetection).toHaveBeenCalledWith(lastDetection.id);
  });

  it('disables prev at the start of the alert', () => {
    renderEditor({ detection: firstDetection });
    // The object starts on frame 3 of 5, so both directions are open.
    expect(screen.getByTestId('filmstrip-prev')).not.toBeDisabled();
    expect(screen.getByTestId('filmstrip-next')).not.toBeDisabled();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('filmstrip-prev')).toBeDisabled();
  });

  it('arms draw mode on D and shows the crosshair cursor', () => {
    renderLoadedEditor();
    fireEvent.keyDown(window, { key: 'd' });
    expect(screen.getByAltText(/^Detection /).parentElement).toHaveStyle({ cursor: 'crosshair' });
  });

  it('hides the other objects on this frame until O is pressed', () => {
    const overlays = [{ color: '#2a78d6', label: 'Object 1', boxes: [{ xyxyn: [0.6, 0.6, 0.7, 0.7] }] }];
    renderLoadedEditor({ objectOverlays: overlays });

    // Off by default: on this screen color means source, and the
    // object-identity palette overlaps the source palette closely enough
    // that an always-on overlay would be ambiguous.
    expect(screen.queryByText('Object 1')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'o' });
    expect(screen.getByText('Object 1')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'o' });
    expect(screen.queryByText('Object 1')).not.toBeInTheDocument();
  });

  it('opens the shortcuts sheet from its button, and closes it', () => {
    renderEditor();
    expect(screen.queryByTestId('editor-shortcuts-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('editor-shortcuts'));
    expect(screen.getByTestId('editor-shortcuts-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('editor-shortcuts-close'));
    expect(screen.queryByTestId('editor-shortcuts-modal')).not.toBeInTheDocument();
  });

  it('toggles the shortcuts sheet with ?', () => {
    renderEditor();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('editor-shortcuts-modal')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByTestId('editor-shortcuts-modal')).not.toBeInTheDocument();
  });

  it('Escape closes the shortcuts sheet before it closes the editor', () => {
    const onClose = vi.fn();
    renderEditor({ onClose });
    fireEvent.keyDown(window, { key: '?' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('editor-shortcuts-modal')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('no longer prints the shortcut list along the bottom', () => {
    renderEditor();
    expect(screen.queryByText(/accept & next/i)).not.toBeInTheDocument();
  });

  it('opens framed on the object, not on the whole landscape', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    // The fixture box spans 0.1 of the frame, so the framing wants 3.2x and
    // the ceiling holds it at 3.
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(3) translate(0px, 0px)',
    });
  });

  it('offers a button to leave the object framing, pressed by default', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const toggle = screen.getByTestId('editor-zoom-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1) translate(0px, 0px)',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('the button zooms back to the object', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const toggle = screen.getByTestId('editor-zoom-toggle');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(3) translate(0px, 0px)',
    });
  });

  it('R drops back to the full frame', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1) translate(0px, 0px)',
    });
  });

  it('Z toggles back to the object framing', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'z' });
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(3) translate(0px, 0px)',
    });
  });

  it('stays at the full frame when the object has no box to frame', () => {
    renderLoadedEditor({
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
    });
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1) translate(0px, 0px)',
    });
  });

  it('reports an in-flight save', () => {
    renderEditor({ isSaving: true });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('removes its keydown listener on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = renderEditor({ onClose });
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the frame position on the filmstrip, not in the header', () => {
    renderEditor();
    expect(screen.getByTestId('filmstrip-summary')).toHaveTextContent('Frame 3 of 5');
  });
});

describe('LocalizeObjectEditor out-of-range frames', () => {
  it('steps into a frame the object is absent from without navigating', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNavigateToDetection).not.toHaveBeenCalled();
    expect(screen.getByTestId('out-of-range-banner')).toBeInTheDocument();
  });

  it('disables every editing action on an out-of-range frame', () => {
    renderEditor();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('source-row-auto')).toBeDisabled();
    expect(screen.getByTestId('editor-clear')).toBeDisabled();
  });

  it('Enter does nothing on an out-of-range frame', () => {
    const onCommit = vi.fn();
    const onNavigateToDetection = vi.fn();
    renderEditor({ onCommit, onNavigateToDetection });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onNavigateToDetection).not.toHaveBeenCalled();
  });

  it('resumes driving the URL when stepping back into range', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigateToDetection).toHaveBeenCalledWith(firstDetection.id);
    expect(screen.queryByTestId('out-of-range-banner')).not.toBeInTheDocument();
  });

  it('peeks when an out-of-range filmstrip cell is clicked', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection });
    fireEvent.click(screen.getByTestId('filmstrip-cell-99001'));
    expect(onNavigateToDetection).not.toHaveBeenCalled();
    expect(screen.getByTestId('out-of-range-banner')).toBeInTheDocument();
  });

  it('clears the peek when the open detection changes underneath it', () => {
    const { rerender } = renderEditor();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('out-of-range-banner')).toBeInTheDocument();
    rerender(editorWith({ detection: lastDetection }));
    expect(screen.queryByTestId('out-of-range-banner')).not.toBeInTheDocument();
  });

  it('steps out of the object range at the end too', () => {
    const onNavigateToDetection = vi.fn();
    renderEditor({ onNavigateToDetection, detection: lastDetection });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigateToDetection).not.toHaveBeenCalled();
    expect(screen.getByTestId('out-of-range-banner')).toBeInTheDocument();
  });

  it('refuses to draw while peeking, so no box lands on the wrong frame', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    const image = screen.getByAltText(/^Detection /);
    fireEvent.mouseDown(image, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(image, { clientX: 90, clientY: 90 });
    fireEvent.mouseUp(image);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not step past the very first alert frame', () => {
    renderEditor();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    // t003 -> t002 -> t001, then nothing left before it.
    expect(screen.getByTestId('out-of-range-banner')).toBeInTheDocument();
    expect(screen.getByTestId('filmstrip-cell-99001')).toHaveAttribute('aria-current', 'true');
  });
});
