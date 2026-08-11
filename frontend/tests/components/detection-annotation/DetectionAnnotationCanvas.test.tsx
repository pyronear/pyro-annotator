/**
 * Tests for DetectionAnnotationCanvas's object-identity overlay wiring: the
 * fix for the collocated localize editor showing another tracked object's
 * box as a generic, identity-less "sibling NN%" (ImageOverlays.tsx's
 * SiblingBoundingBoxOverlay, reading Detection.others_bboxes). `ImageModal`
 * threads an optional `objectOverlays` prop straight through to this
 * component with no logic of its own, so the actual overlay-selection
 * behavior is tested here.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { DetectionAnnotationCanvas } from '@/components/detection-annotation/DetectionAnnotationCanvas';
import type { Detection } from '@/types/api';
import type { BoxCandidate } from '@/utils/annotation/objectBoxCandidates';

vi.mock('@/hooks/useDetectionImage', () => ({
  useDetectionImage: () => ({ data: { url: 'https://img.example/1.jpg' } }),
}));

const imageInfo = { width: 100, height: 100, offsetX: 0, offsetY: 0 };

const makeDetection = (): Detection =>
  ({
    id: 1,
    sequence_id: 101,
    alert_api_id: 9001,
    created_at: '2026-01-01T10:00:00Z',
    recorded_at: '2026-01-01T10:00:00Z',
    algo_predictions: { predictions: [] },
    auto_predictions: null,
    others_bboxes: {
      predictions: [{ xyxyn: [0.6, 0.6, 0.7, 0.7], confidence: 0.77, class_name: 'smoke' }],
    },
    last_modified_at: null,
  }) as unknown as Detection;

const noop = () => undefined;

const defaultProps = {
  detection: makeDetection(),
  committed: null as BoxCandidate | null,
  ghosts: [] as BoxCandidate[],
  showGhosts: true,
  selected: false,
  selectedSmokeType: 'wildfire' as const,
  isDrawMode: false,
  onBoxPointerDown: noop,
  onHandlePointerDown: noop,
  currentDrawing: null,
  containerRef: { current: null },
  imgRef: { current: null },
  imageInfo,
  zoomLevel: 1,
  panOffset: { x: 0, y: 0 },
  transformOrigin: { x: 50, y: 50 },
  isDragging: false,
  onMouseDown: noop,
  onMouseMove: noop,
  onMouseUp: noop,
  onClick: noop,
  getCursorStyle: () => 'default',
  handleImageLoad: noop,
  normalizedToImage: (x: number, y: number) => ({ x, y }),
  overlaysVisible: true,
};

describe('DetectionAnnotationCanvas object-identity overlay', () => {
  it('legacy behavior (no objectOverlays prop): renders the generic sibling layer, byte-unchanged', () => {
    render(<DetectionAnnotationCanvas {...defaultProps} />);

    expect(screen.getByText('sibling 77%')).toBeInTheDocument();
  });

  it('with objectOverlays provided: renders the labeled color boxes and suppresses the sibling layer', () => {
    render(
      <DetectionAnnotationCanvas
        {...defaultProps}
        objectOverlays={[
          { color: '#166A5D', label: 'Object 2', boxes: [{ xyxyn: [0.1, 0.1, 0.2, 0.2] }] },
        ]}
      />
    );

    expect(screen.getByText('Object 2')).toBeInTheDocument();
    expect(screen.queryByText(/sibling/i)).not.toBeInTheDocument();
  });

  it('an empty objectOverlays array still suppresses the sibling layer', () => {
    render(<DetectionAnnotationCanvas {...defaultProps} objectOverlays={[]} />);

    expect(screen.queryByText(/sibling/i)).not.toBeInTheDocument();
  });

  it('showSiblingBboxes={false} still has no effect once objectOverlays is provided (objectOverlays wins either way)', () => {
    render(
      <DetectionAnnotationCanvas
        {...defaultProps}
        showSiblingBboxes={false}
        objectOverlays={[
          { color: '#D9581E', label: 'Object 3', boxes: [{ xyxyn: [0.3, 0.3, 0.4, 0.4] }] },
        ]}
      />
    );

    expect(screen.getByText('Object 3')).toBeInTheDocument();
    expect(screen.queryByText(/sibling/i)).not.toBeInTheDocument();
  });
});

describe('DetectionAnnotationCanvas single-box model', () => {
  const auto: BoxCandidate = { source: 'auto', index: 0, xyxyn: [0.2, 0.2, 0.3, 0.3] };
  const engine: BoxCandidate = { source: 'engine', index: 0, xyxyn: [0.1, 0.1, 0.4, 0.4] };

  it('renders a ghost for every non-committed candidate', () => {
    render(<DetectionAnnotationCanvas {...defaultProps} committed={auto} ghosts={[engine]} />);

    expect(screen.getByTestId('ghost-box-engine-0')).toBeInTheDocument();
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
  });

  it('hides ghosts when showGhosts is false', () => {
    render(
      <DetectionAnnotationCanvas
        {...defaultProps}
        committed={auto}
        ghosts={[engine]}
        showGhosts={false}
      />
    );

    expect(screen.queryByTestId('ghost-box-engine-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('committed-box')).toBeInTheDocument();
  });

  it('shows no resize handles until the committed box is selected', () => {
    render(<DetectionAnnotationCanvas {...defaultProps} committed={auto} ghosts={[]} />);

    expect(screen.queryByTestId(/^resize-handle-/)).not.toBeInTheDocument();
  });

  it('gives the selected committed box resize handles', () => {
    render(<DetectionAnnotationCanvas {...defaultProps} committed={auto} ghosts={[]} selected />);

    expect(screen.getAllByTestId(/^resize-handle-/).length).toBeGreaterThan(0);
  });

  it('renders no committed box on a frame that has none', () => {
    render(<DetectionAnnotationCanvas {...defaultProps} committed={null} ghosts={[auto]} />);

    expect(screen.queryByTestId('committed-box')).not.toBeInTheDocument();
    expect(screen.getByTestId('ghost-box-auto-0')).toBeInTheDocument();
  });

  it('thins the strokes as the zoom grows, so they keep their on-screen weight', () => {
    const { rerender } = render(
      <DetectionAnnotationCanvas {...defaultProps} committed={auto} ghosts={[engine]} />
    );
    // Painted as a box-shadow ring, not laid out as a CSS border: the spread
    // radius in `0 0 0 <spread>px <color>` is the stroke width.
    const strokeWidth = (el: HTMLElement) => {
      const lengths = el.style.boxShadow.match(/[\d.]+px/g) ?? [];
      return lengths[lengths.length - 1];
    };
    const at1x = strokeWidth(screen.getByTestId('ghost-box-engine-0'));

    rerender(
      <DetectionAnnotationCanvas
        {...defaultProps}
        committed={auto}
        ghosts={[engine]}
        zoomLevel={3}
      />
    );
    const at3x = strokeWidth(screen.getByTestId('ghost-box-engine-0'));

    expect(parseFloat(at3x)).toBeCloseTo(parseFloat(at1x) / 3);
  });

  it('suppresses the resize handles while drawing, so a click lands on the canvas', () => {
    render(
      <DetectionAnnotationCanvas {...defaultProps} committed={auto} ghosts={[]} selected isDrawMode />
    );

    expect(screen.queryByTestId(/^resize-handle-/)).not.toBeInTheDocument();
  });
});
