import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
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

const IMAGE_URL = 'https://img.example/1.jpg';

/**
 * Mutable so a test can render the editor BEFORE the image URL resolves,
 * which is what a cold open really does — the canvas renders no <img> until
 * then, so anything reaching for `imgRef` on the first pass finds null.
 */
const imageState = vi.hoisted(() => ({
  data: { url: 'https://img.example/1.jpg' } as { url: string } | undefined,
}));

vi.mock('@/hooks/useDetectionImage', () => ({
  useDetectionImage: () => ({ data: imageState.data }),
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
      color: '#166A5D',
      boxes: [],
    },
    ...(OBJECT_TIMES.includes(recordedAt)
      ? [
          {
            laneSequenceId: LANE,
            detectionId: 27000 + Number(recordedAt.slice(1)),
            cellState: 'auto' as const,
            color: '#166A5D',
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

/** A frame the annotator settled as empty — "not visible here". */
const clearedAnnotation = (detectionId: number): DetectionAnnotation =>
  ({
    id: 6,
    detection_id: detectionId,
    annotation: { annotation: [] },
    processing_stage: 'annotated',
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
  onCommitGapFrame: vi.fn(),
  onUnmaterialize: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  imageState.data = { url: IMAGE_URL };
});

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

  it('ghosts the box that lost, not the one that was committed, when the pick was a runner-up', () => {
    // The anchored box can be the layer's SECOND prediction, and
    // `committedBox` reports `index: 0` for whatever was committed, so
    // identifying the committed candidate by source+index matched the wrong
    // one: `G` drew a ghost on top of the committed box and hid the real
    // loser — the one comparison `G` exists to offer.
    const stray = { xyxyn: [0.7, 0.7, 0.8, 0.8], confidence: 0.52, class_name: 'smoke' };
    const anchored = { xyxyn: [0.15, 0.15, 0.35, 0.35], confidence: 0.15, class_name: 'smoke' };
    const detection = {
      ...makeDetection('t001'),
      auto_predictions: { predictions: [stray, anchored] },
      algo_predictions: {
        predictions: [{ xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.5, class_name: 'smoke' }],
      },
    } as unknown as Detection;
    const committed = {
      id: 7,
      detection_id: detection.id,
      annotation: {
        annotation: [
          { xyxyn: anchored.xyxyn, class_name: 'smoke', smoke_type: 'wildfire', origin: 'auto' },
        ],
      },
    } as unknown as DetectionAnnotation;

    renderLoadedEditor({ detection, existingAnnotation: committed });
    fireEvent.keyDown(window, { key: 'g' });

    // The stray is what the annotator did not take, so it is what `G` shows.
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    // The committed box must not also be drawn as its own ghost.
    expect(screen.queryByTestId('ghost-box-auto-1')).not.toBeInTheDocument();
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
  // Layout metrics match the rect: the container is not mid-animation here,
  // and the bounds maths reads these rather than the rect.
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

describe('LocalizeObjectEditor canvas', () => {
  // Browser zoom (ctrl +/-) and window resizes change the image's rendered
  // size without firing `load`. Every overlay is positioned from the measured
  // geometry, so without this the boxes stay drawn where the image used to be.
  it('observes the image for resizes, to re-measure overlay geometry', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(() => ({ observe, disconnect, unobserve: vi.fn() }))
    );

    const { unmount } = renderLoadedEditor();
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0]).toBe(document.querySelector('img'));
    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // A cold open has no image URL on the first render, so the canvas renders no
  // <img> at all and the ref is null. Attaching only once on mount would leave
  // the observer permanently unattached — passing only because test fixtures
  // hand over the URL synchronously.
  it('still attaches the observer when the image URL arrives late', () => {
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn(() => ({ observe, disconnect: vi.fn(), unobserve: vi.fn() }))
    );

    imageState.data = undefined;
    const { rerender } = renderEditor();
    expect(document.querySelector('img')).toBeNull();
    expect(observe).not.toHaveBeenCalled();

    imageState.data = { url: IMAGE_URL };
    rerender(editorWith());

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls[0][0]).toBe(document.querySelector('img'));
    vi.unstubAllGlobals();
  });

  // The same cold-open trap the resize observer has above, and the reason
  // `imageKey` is threaded into the stage at all: the canvas renders no
  // container until the image URL resolves, so a wheel listener attached only
  // on mount is attached to nothing. A deep link into the editor — or a
  // refresh on it — is exactly that cold open, and the zoom would be dead
  // there while every warm-open test passed.
  it('still zooms at the pointer when the image URL arrives late', () => {
    imageState.data = undefined;
    const { rerender } = renderEditor();
    expect(document.querySelector('img')).toBeNull();

    imageState.data = { url: IMAGE_URL };
    rerender(editorWith());
    fireEvent.load(screen.getByAltText(/^Detection /));

    const image = stubGeometry();
    fireEvent.wheel(image.parentElement as HTMLElement, {
      deltaY: -100,
      clientX: 640,
      clientY: 225,
    });

    expect(image).toHaveStyle({ transform: 'scale(1.15) translate(-3.913%, 0%)' });
  });

  it('ignores a wheel fired before the image can be measured', () => {
    // An <img> reports no natural size until it decodes, and the bounds are
    // computed from its aspect ratio — 0/0, so every coordinate comes back
    // NaN. Anchoring on that would quietly reset the pan and throw the
    // framing away on a wheel during a frame change. jsdom lays nothing out,
    // so leaving the geometry unstubbed IS that state.
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const image = screen.getByAltText(/^Detection /);
    expect(image).toHaveStyle({ transform: 'scale(3) translate(16.667%, 16.667%)' });

    fireEvent.wheel(image.parentElement as HTMLElement, {
      deltaY: -100,
      clientX: 640,
      clientY: 225,
    });

    expect(image).toHaveStyle({ transform: 'scale(3) translate(16.667%, 16.667%)' });
  });

  it('zooms at the pointer, holding the point under it still', () => {
    renderLoadedEditor();
    const image = stubGeometry();

    // 640px across an 800px image is 0.8 of the way over; one notch up is a
    // 1.15 factor, and holding 0.8 still takes (1 - 1.15)(0.3)/1.15 of pan.
    fireEvent.wheel(image.parentElement as HTMLElement, {
      deltaY: -100,
      clientX: 640,
      clientY: 225,
    });

    expect(image).toHaveStyle({ transform: 'scale(1.15) translate(-3.913%, 0%)' });
  });

  it('keeps the object framing when the wheel refines it', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const image = stubGeometry();
    fireEvent.keyDown(window, { key: 'z' });

    // Wheeling used to reset the transform origin, which threw the framing
    // away on the first notch. Now it refines it — and the Z toggle stays
    // pressed, because the framing is a mode, not a snapshot.
    fireEvent.wheel(image.parentElement as HTMLElement, {
      deltaY: -100,
      clientX: 400,
      clientY: 225,
    });

    // The screen's centre is image point 0.333 under this framing, and
    // anchoring it across 3 -> 3.45 leaves the pan exactly where it was. The
    // pan is the whole assertion: asserting the scale alone would pass just
    // as well with the framing thrown away, which is the bug.
    expect(image).toHaveStyle({ transform: 'scale(3.45) translate(16.667%, 16.667%)' });
    expect(screen.getByTestId('editor-zoom-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('pans with the cursor, not faster than it', () => {
    // The pan applies inside the scale, so a 100px drag at 3x over an 800px
    // image is 100 / (800 * 3) of the image — anything else and the picture
    // slides out from under the hand.
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const image = stubGeometry();
    fireEvent.keyDown(window, { key: 'z' });

    fireEvent.keyDown(window, { code: 'Space' });
    fireEvent.mouseDown(image, { button: 0, clientX: 400, clientY: 225 });
    fireEvent.mouseMove(image, { clientX: 500, clientY: 225 });
    fireEvent.mouseUp(image);
    fireEvent.keyUp(window, { code: 'Space' });

    // The 16.667% object framing plus 100 / 2400 of the image.
    expect(image).toHaveStyle({ transform: 'scale(3) translate(20.833%, 16.667%)' });
  });

  it('centres the image in the stage panel, which the bounds maths assumes', () => {
    // `calculateImageBounds` works out where an object-contain image sits by
    // assuming it is CENTRED in its container; drop the centring and every
    // screen-to-image conversion is off by half the leftover width. The same
    // centring is what keeps the container's box on the image's, which the
    // percentage pan resolves against — measured in Chromium down to a 1280x420
    // viewport (where max-h-[95vh] binds) as agreeing within 0.02px.
    renderLoadedEditor();
    const panel = screen.getByAltText(/^Detection /).parentElement?.parentElement;
    expect(panel?.className).toContain('items-center');
    expect(panel?.className).toContain('justify-center');
  });

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

  it('Delete rejects the model on an undecided frame — the answer that had no other way to be said', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: firstDetection.id }), []);
  });

  it('Delete writes nothing on a frame already cleared', () => {
    const onCommit = vi.fn();
    const onUnmaterialize = vi.fn();
    renderLoadedEditor({
      existingAnnotation: clearedAnnotation(firstDetection.id),
      onCommit,
      onUnmaterialize,
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onUnmaterialize).not.toHaveBeenCalled();
  });

  it('Delete un-materializes an evidence-free frame even with nothing committed', () => {
    const onUnmaterialize = vi.fn();
    renderLoadedEditor({
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
      onUnmaterialize,
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onUnmaterialize).toHaveBeenCalledWith(
      expect.objectContaining({ id: detectionWithNoBoxes.id })
    );
  });

  it('Delete does nothing on an out-of-range frame', () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ existingAnnotation: committed(), onCommit });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("P commits the previous frame's committed box onto this frame as a human decision", () => {
    const onCommit = vi.fn();
    const previous = {
      ...committedAnnotation(firstDetection.id, 'auto'),
      annotation: {
        annotation: [
          {
            xyxyn: [0.42, 0.42, 0.52, 0.52],
            class_name: 'smoke',
            smoke_type: 'wildfire',
            origin: 'auto',
          },
        ],
      },
    } as unknown as DetectionAnnotation;
    renderEditor({ detection: lastDetection, laneAnnotations: [previous], onCommit });
    fireEvent.keyDown(window, { key: 'p' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: lastDetection.id }), [
      {
        xyxyn: [0.42, 0.42, 0.52, 0.52],
        class_name: 'smoke',
        smoke_type: 'wildfire',
        origin: 'human',
      },
    ]);
  });

  it("P falls back to the previous frame's winning pick when it is undecided", () => {
    const onCommit = vi.fn();
    renderEditor({ detection: lastDetection, onCommit });
    fireEvent.keyDown(window, { key: 'P' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: lastDetection.id }), [
      expect.objectContaining({ xyxyn: [0.2, 0.2, 0.3, 0.3], origin: 'human' }),
    ]);
  });

  it('P does nothing on the first frame — there is no earlier box to copy', () => {
    const onCommit = vi.fn();
    renderEditor({ detection: firstDetection, onCommit });
    fireEvent.keyDown(window, { key: 'p' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('P ignores auto-repeat — the save is async and a held key would double-write', () => {
    const onCommit = vi.fn();
    renderEditor({ detection: lastDetection, onCommit });
    fireEvent.keyDown(window, { key: 'p', repeat: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('P does nothing on an out-of-range frame', () => {
    // From the LAST frame, whose previous frame does offer a box — from the
    // first, P is a no-op regardless and the guard would be untested.
    const onCommit = vi.fn();
    const onCommitGapFrame = vi.fn();
    renderEditor({ detection: lastDetection, onCommit, onCommitGapFrame });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'p' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCommitGapFrame).not.toHaveBeenCalled();
  });

  it('P with a held modifier is the browser\'s shortcut, not ours', () => {
    const onCommit = vi.fn();
    renderEditor({ detection: lastDetection, onCommit });
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('P does not write behind the shortcuts sheet that documents it', () => {
    const onCommit = vi.fn();
    renderEditor({ detection: lastDetection, onCommit });
    fireEvent.keyDown(window, { key: '?' });
    fireEvent.keyDown(window, { key: 'p' });
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

  it('leaves the editor once the accepted boxes are written', () => {
    // Accepting the remainder settles every frame of the object, so there is
    // nothing left to do here — the editor hands the page a callback and the
    // page fires it when the write lands.
    const onAcceptRemaining = vi.fn();
    const onClose = vi.fn();
    renderEditor({ onAcceptRemaining, onClose });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
    onAcceptRemaining.mock.calls[0][0]();
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves the editor when confirmed by click too', () => {
    const onAcceptRemaining = vi.fn();
    const onClose = vi.fn();
    renderEditor({ onAcceptRemaining, onClose });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    fireEvent.click(screen.getByTestId('accept-remaining-confirm'));

    onAcceptRemaining.mock.calls[0][0]();
    expect(onClose).toHaveBeenCalled();
  });

  // Whether a FAILED write leaves the editor open is the page's half of this
  // contract — it decides when to fire the callback — and is covered where it
  // lives, in LocalizeAlertPage's "keeps the editor open when the write
  // fails". An editor-level version could only re-assert that it does not
  // close on the keypress, which the test above already pins.

  it('does not navigate when the write lands after the editor is gone', () => {
    // Accept, then leave before it returns — browser Back, say, which keeps
    // the cockpit page (and its mutation) mounted. The late callback must not
    // drag the annotator back to wherever the editor had been.
    const onAcceptRemaining = vi.fn();
    const onClose = vi.fn();
    const { unmount } = renderEditor({ onAcceptRemaining, onClose });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));
    fireEvent.keyDown(window, { key: 'Enter' });

    unmount();
    onAcceptRemaining.mock.calls[0][0]();

    expect(onClose).not.toHaveBeenCalled();
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
      transform: 'scale(3) translate(16.667%, 16.667%)',
    });
  });

  it('offers a button to leave the object framing, pressed by default', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const toggle = screen.getByTestId('editor-zoom-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1) translate(0%, 0%)',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('the button zooms back to the object', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    const toggle = screen.getByTestId('editor-zoom-toggle');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(3) translate(16.667%, 16.667%)',
    });
  });

  it('R drops back to the full frame', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1) translate(0%, 0%)',
    });
  });

  it('Z toggles back to the object framing', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'z' });
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(3) translate(16.667%, 16.667%)',
    });
  });

  it('frames the box it would commit, not the union with a stray candidate', () => {
    // Framing every candidate meant that on exactly the multi-box frames
    // this branch is about, the window spanned the pick AND a stray sitting
    // elsewhere in the scene — `computeCellCrop` clamps that to scale 1, so
    // the object framing silently did nothing on the frames that needed it.
    const stray = { xyxyn: [0.7, 0.7, 0.8, 0.8], confidence: 0.52, class_name: 'smoke' };
    const anchored = { xyxyn: [0.15, 0.15, 0.35, 0.35], confidence: 0.15, class_name: 'smoke' };
    const detection = {
      ...makeDetection('t001'),
      auto_predictions: { predictions: [stray, anchored] },
      algo_predictions: {
        predictions: [{ xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.5, class_name: 'smoke' }],
      },
    } as unknown as Detection;

    renderLoadedEditor({ detection });

    // 0.32 target fill over the pick's 0.2 span = 1.6. The union of all
    // three candidates spans 0.7, which clamps to 1 — no zoom at all.
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1.6) translate(9.375%, 9.375%)',
    });
  });

  it('stays at the full frame when the object has no box to frame', () => {
    renderLoadedEditor({
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
    });
    expect(screen.getByAltText(/^Detection /)).toHaveStyle({
      transform: 'scale(1) translate(0%, 0%)',
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

  it('drawing while peeking routes to onCommitGapFrame with the peeked timestamp', () => {
    const onCommit = vi.fn();
    const onCommitGapFrame = vi.fn();
    renderLoadedEditor({ onCommit, onCommitGapFrame });
    fireEvent.keyDown(window, { key: 'ArrowLeft' }); // t003 -> t002, a gap frame
    drag([40, 40], [400, 300]);
    expect(onCommitGapFrame).toHaveBeenCalledWith('t002', [
      expect.objectContaining({ origin: 'human', smoke_type: 'wildfire' }),
    ]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('invites drawing on a gap frame instead of forbidding it', () => {
    renderEditor();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('out-of-range-banner')).toHaveTextContent(/draw a box/i);
  });

  it('Delete un-materializes an evidence-free frame with a committed box', () => {
    const onCommit = vi.fn();
    const onUnmaterialize = vi.fn();
    renderLoadedEditor({
      detection: detectionWithNoBoxes,
      existingAnnotation: committedAnnotation(detectionWithNoBoxes.id, 'human'),
      onCommit,
      onUnmaterialize,
    });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onUnmaterialize).toHaveBeenCalledWith(
      expect.objectContaining({ id: detectionWithNoBoxes.id })
    );
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

describe('LocalizeObjectEditor cleared frames', () => {
  it('a cleared frame draws no box — the ghost coming back is what made a delete look undone', () => {
    renderLoadedEditor({ existingAnnotation: clearedAnnotation(firstDetection.id) });
    expect(screen.queryByTestId('committed-box')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-auto-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('cleared-frame-chip')).toBeInTheDocument();
  });

  it('G still reveals the candidates on a cleared frame — that is how you undo one', () => {
    renderLoadedEditor({ existingAnnotation: clearedAnnotation(firstDetection.id) });
    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
  });

  it('leaves the chip off a frame that simply has no decision yet', () => {
    renderLoadedEditor();
    expect(screen.queryByTestId('cleared-frame-chip')).not.toBeInTheDocument();
  });

  it('excludes cleared frames from the accept count', () => {
    // The object is on t003 and t004. Clear both and there is nothing left
    // for a sweep to fill, so the button goes away entirely.
    renderLoadedEditor({
      laneAnnotations: [clearedAnnotation(firstDetection.id), clearedAnnotation(lastDetection.id)],
      existingAnnotation: clearedAnnotation(firstDetection.id),
    });
    expect(screen.queryByTestId('editor-accept-remaining')).not.toBeInTheDocument();
  });

  it('still offers the accept when an undecided frame remains', () => {
    renderLoadedEditor({ laneAnnotations: [clearedAnnotation(firstDetection.id)] });
    expect(screen.getByTestId('editor-accept-remaining')).toBeInTheDocument();
  });

  it('Enter on a cleared frame advances without re-committing the box it rejected', () => {
    // Enter is the habitual advance key here. Re-committing the priority
    // pick would silently undo the clear, and the annotator would already be
    // on the next frame when it happened.
    const onCommit = vi.fn();
    const onNavigateToDetection = vi.fn();
    renderLoadedEditor({
      existingAnnotation: clearedAnnotation(firstDetection.id),
      onCommit,
      onNavigateToDetection,
    });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onNavigateToDetection).toHaveBeenCalledWith(lastDetection.id);
  });

  it('ignores auto-repeat on Delete, so holding it writes once', () => {
    // Held Delete used to fire clear() per repeat. On a frame with no
    // annotation yet each one POSTs, and the detection_id unique constraint
    // turns every call after the first into a "Failed to save" toast on a
    // save that actually succeeded.
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Delete', repeat: true });
    fireEvent.keyDown(window, { key: 'Delete', repeat: true });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("the rail's None row clears the frame", () => {
    const onCommit = vi.fn();
    renderLoadedEditor({ onCommit });
    fireEvent.click(screen.getByTestId('source-row-none'));
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ id: firstDetection.id }), []);
  });

  it('presses the None row once the frame is cleared', () => {
    renderLoadedEditor({ existingAnnotation: clearedAnnotation(firstDetection.id) });
    expect(screen.getByTestId('source-row-none')).toHaveAttribute('aria-pressed', 'true');
  });

  it('points a cleared frame at the rail, while the rail still has something to offer', () => {
    renderLoadedEditor({ existingAnnotation: clearedAnnotation(firstDetection.id) });
    expect(screen.getByTestId('cleared-frame-chip')).toHaveTextContent(/Pick a box on the right/);
  });

  it('points a candidate-less cleared frame at drawing, its only remaining undo', () => {
    // Every rail row is disabled here and Delete is guarded, so pointing at
    // the rail would be a lie. Reachable via the un-materialize 409
    // fallback, which writes exactly this state.
    renderLoadedEditor({
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
      existingAnnotation: clearedAnnotation(detectionWithNoBoxes.id),
    });
    expect(screen.getByTestId('cleared-frame-chip')).toHaveTextContent(/Draw a box to change that/);
  });

  it('leaves Enter to a focused None row, so it never commits the box it rejects', () => {
    const onCommit = vi.fn();
    const onNavigateToDetection = vi.fn();
    renderLoadedEditor({ onCommit, onNavigateToDetection });
    const row = screen.getByTestId('source-row-none');
    row.focus();

    // Without the guard this reaches the global accept-and-next, which
    // commits the priority model box and steps on — the exact opposite of
    // what the focused row says it does. (jsdom doesn't run native button
    // activation, so the observable is the suppressed global commit.)
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onNavigateToDetection).not.toHaveBeenCalled();
  });
});

describe('open/close transition', () => {
  /** WAAPI stub: records calls, lets the test fire the finish listener. */
  const makeAnimateMock = () => {
    const listeners: Record<string, () => void> = {};
    const cancel = vi.fn();
    const animate = vi.fn().mockReturnValue({
      addEventListener: (type: string, cb: () => void) => {
        listeners[type] = cb;
      },
      cancel,
    });
    return { animate, cancel, finish: () => listeners.finish?.() };
  };

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (Element.prototype as any).animate;
    vi.restoreAllMocks();
  });

  it('grows from the captured origin rect on mount', () => {
    const { animate } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    renderEditor({
      takeOpenOriginRect: () => ({ left: 10, top: 20, width: 100, height: 50 }),
    });
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes] = animate.mock.calls[0];
    expect(keyframes[0].transform).toContain('translate(10px, 20px)');
    expect(keyframes[1].transform).toBe('none');
  });

  it('does not animate the entrance without a captured origin rect', () => {
    const { animate } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    renderEditor({ takeOpenOriginRect: () => null });
    expect(animate).not.toHaveBeenCalled();
  });

  it('shrinks into the current frame cell and calls onClose only after the animation finishes', () => {
    const { animate, finish } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    const onClose = vi.fn();
    const frameCellRect = vi.fn(() => ({ left: 5, top: 6, width: 100, height: 60 }));
    renderEditor({ onClose, frameCellRect });
    fireEvent.click(screen.getByTestId('editor-close'));
    expect(frameCellRect).toHaveBeenCalledWith(firstDetection.recorded_at);
    expect(onClose).not.toHaveBeenCalled();
    const closeCall = animate.mock.calls[animate.mock.calls.length - 1];
    expect(closeCall[0][1].transform).toContain('translate(5px, 6px)');
    finish();
    expect(onClose).toHaveBeenCalledTimes(1);
    // A second close attempt during/after the exit is a no-op.
    fireEvent.click(screen.getByTestId('editor-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a late exit-animation finish after unmount does not navigate again', () => {
    const { animate, cancel, finish } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    const onClose = vi.fn();
    const { unmount } = renderEditor({
      onClose,
      frameCellRect: () => ({ left: 5, top: 6, width: 100, height: 60 }),
    });
    fireEvent.click(screen.getByTestId('editor-close'));
    // Browser back during the shrink: the route unmounts the editor while
    // the WAAPI animation (document timeline) is still running.
    unmount();
    expect(cancel).toHaveBeenCalled();
    finish();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a fade on close when no target cell rect is available', () => {
    const { animate, finish } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    const onClose = vi.fn();
    renderEditor({ onClose, frameCellRect: () => null });
    fireEvent.click(screen.getByTestId('editor-close'));
    const closeCall = animate.mock.calls[animate.mock.calls.length - 1];
    expect(closeCall[0][0]).toEqual({ opacity: 1 });
    expect(closeCall[0][1]).toEqual({ opacity: 0 });
    finish();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shrinks into the frame it closes from, not the one the accept started on', () => {
    // The accept's close is fired by the page whenever the write lands, and
    // nothing stops the annotator arrowing on meanwhile. A close frozen at
    // gesture time would fly into the cell of a frame they already left —
    // possibly one scrolled out of view.
    const { animate } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    const onAcceptRemaining = vi.fn();
    const frameCellRect = vi.fn(() => ({ left: 5, top: 6, width: 100, height: 60 }));
    const { rerender } = renderEditor({ onAcceptRemaining, frameCellRect });

    fireEvent.click(screen.getByTestId('editor-accept-remaining'));
    fireEvent.keyDown(window, { key: 'Enter' });

    // Write in flight; the annotator steps on to the next frame.
    rerender(editorWith({ onAcceptRemaining, frameCellRect, detection: lastDetection }));
    onAcceptRemaining.mock.calls[0][0]();

    expect(frameCellRect).toHaveBeenLastCalledWith(lastDetection.recorded_at);
  });

  it('closes immediately when element.animate is unavailable', () => {
    const onClose = vi.fn();
    renderEditor({ onClose, frameCellRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) });
    fireEvent.click(screen.getByTestId('editor-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('positions overlays from layout metrics, not the animation-scaled rect', () => {
    renderEditor();
    const img = screen.getByAltText(/^Detection /) as HTMLImageElement;
    const container = img.parentElement as HTMLDivElement;
    Object.defineProperties(img, {
      naturalWidth: { value: 1280 },
      naturalHeight: { value: 720 },
      offsetWidth: { value: 1000 },
      offsetHeight: { value: 562 },
      offsetLeft: { value: 0 },
      offsetTop: { value: 19 },
    });
    Object.defineProperties(container, {
      offsetWidth: { value: 1000 },
      offsetHeight: { value: 600 },
    });
    // Mid-entrance-animation: the visual rect is the layout scaled to ~16%.
    // Overlay geometry must come from the layout metrics regardless.
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 160, height: 96 }) as DOMRect;
    fireEvent.load(img);
    // bounds fit 1280x720 into 1000x600 -> width 1000; ghost x1=0.2 -> 200px.
    expect(screen.getByTestId('ghost-box-auto-0').style.left).toBe('200px');
  });

  it('uses an opacity-only fade under prefers-reduced-motion', () => {
    const { animate } = makeAnimateMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).animate = animate;
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
    } as unknown as MediaQueryList);
    renderEditor({
      takeOpenOriginRect: () => ({ left: 10, top: 20, width: 100, height: 50 }),
    });
    const [keyframes] = animate.mock.calls[0];
    expect(keyframes[0]).toEqual({ opacity: 0 });
    expect(keyframes[1]).toEqual({ opacity: 1 });
  });
});
