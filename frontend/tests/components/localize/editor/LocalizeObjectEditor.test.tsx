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

  it('shows the candidates as ghosts when nothing is committed, and G hides them', () => {
    renderLoadedEditor();

    // Nothing committed means no winner to draw, so the frame would otherwise
    // be blank — the candidates ghost in to show what is on offer.
    expect(screen.queryByTestId('committed-box')).not.toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.queryByTestId('ghost-box-auto-0')).not.toBeInTheDocument();
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

  it('confirms before writing, and does not write on cancel', () => {
    const onAcceptRemaining = vi.fn();
    renderEditor({ onAcceptRemaining });

    fireEvent.click(screen.getByTestId('editor-accept-remaining'));
    expect(screen.getByTestId('accept-remaining-popover')).toBeInTheDocument();
    expect(onAcceptRemaining).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('accept-remaining-cancel'));
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

  it('warns about frames no model found smoke on, without blocking', () => {
    // One frame has candidates, the other has none at all.
    renderEditor({
      detection: detectionWithNoBoxes,
      laneDetections: [detectionWithNoBoxes, lastDetection],
    });
    fireEvent.click(screen.getByTestId('editor-accept-remaining'));

    expect(screen.getByTestId('accept-remaining-gap-warning')).toHaveTextContent(
      'One frame will still have no box'
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
    fireEvent.click(screen.getByTestId('editor-next'));
    expect(onNavigateToDetection).toHaveBeenCalledWith(lastDetection.id);
  });

  it('disables next on the alert’s last frame and prev on its first', () => {
    renderEditor({ detection: firstDetection });
    // The object starts on frame 3 of 5, so both directions are open.
    expect(screen.getByTestId('editor-prev')).not.toBeDisabled();
    expect(screen.getByTestId('editor-next')).not.toBeDisabled();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('editor-prev')).toBeDisabled();
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

  it('shows the frame position within the alert', () => {
    renderEditor();
    expect(screen.getByText('frame 3 / 5')).toBeInTheDocument();
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
    expect(screen.getByTestId('editor-draw')).toBeDisabled();
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

  it('refuses to arm draw mode while peeking, so no box lands on the wrong frame', () => {
    const onCommit = vi.fn();
    renderEditor({ onCommit });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.click(screen.getByAltText(/^Detection /));
    fireEvent.click(screen.getByAltText(/^Detection /));
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
