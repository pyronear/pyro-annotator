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
  onCommit: vi.fn(),
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

  it('G toggles the ghost candidate boxes', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
  });

  it('renders the committed box, and the other candidate as a ghost', () => {
    renderLoadedEditor({ existingAnnotation: committedAnnotation(firstDetection.id, 'auto') });
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
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
