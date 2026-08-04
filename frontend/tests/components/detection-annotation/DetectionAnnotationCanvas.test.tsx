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
  drawnRectangles: [],
  selectedRectangleId: null,
  showPredictions: true,
  activeLayer: 'auto' as const,
  selectedSmokeType: 'wildfire' as const,
  winningLayer: 'auto' as const,
  isDrawMode: false,
  reviewInteractive: true,
  rejectedBoxes: new Set<number>(),
  hiddenBoxes: new Set<number>(),
  selectedModelBox: null,
  onSelectModelBox: noop,
  onRejectModelBox: noop,
  onAdjustModelBox: noop,
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
