/**
 * Comprehensive tests for DetectionGrid component.
 * Tests rendering, user interactions, props handling, and edge cases.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetectionGrid } from '@/components/detection-sequence/DetectionGrid';
import type { Detection, DetectionAnnotation } from '@/types/api';

// Mock the icons to avoid test complications
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    // Override specific icons for testing
    CheckCircle: () => <div data-testid="check-circle">✓</div>,
    AlertCircle: () => <div data-testid="alert-circle">!</div>,
    X: () => <div data-testid="x-icon">×</div>,
  };
});

// Mock the DetectionImageCard component
interface MockDetectionCardProps {
  detection: Detection;
  onClick: () => void;
  isAnnotated: boolean;
  showPredictions: boolean;
  userAnnotation?: DetectionAnnotation;
}

vi.mock('@/components/detection-annotation', () => ({
  DetectionImageCard: ({ detection, onClick, isAnnotated, showPredictions, userAnnotation }: MockDetectionCardProps) => (
    <div 
      data-testid={`detection-card-${detection.id}`}
      data-annotated={isAnnotated}
      data-show-predictions={showPredictions}
      data-has-annotation={!!userAnnotation}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      Detection {detection.id} - {detection.algo_predictions.smoke_bbox_confidence}
    </div>
  ),
}));

describe('DetectionGrid', () => {
  // Factory function for creating test detection data
  const createDetection = (id: number, confidence = 0.85): Detection => ({
    id,
    sequence_id: 1,
    alert_api_id: 123,
    created_at: '2024-01-01T10:00:00Z',
    recorded_at: '2024-01-01T10:00:00Z',
    algo_predictions: {
      smoke_bbox_confidence: confidence,
      smoke_bbox_xyxyn: [0.1, 0.1, 0.9, 0.9],
    },
    last_modified_at: '2024-01-01T10:00:00Z',
    confidence: confidence,
  });

  // Factory function for creating test detection annotation
  const createDetectionAnnotation = (id: number, isTrue = true): DetectionAnnotation => ({
    id,
    detection_id: id,
    smoke_type: isTrue ? 'wildfire' : null,
    false_positive_types: isTrue ? [] : ['building'],
    is_true_positive: isTrue,
    annotation: {},
    created_at: '2024-01-01T10:00:00Z',
    updated_at: null,
    contributors: [],
  });

  const defaultProps = {
    detections: [
      createDetection(1, 0.95),
      createDetection(2, 0.75),
      createDetection(3, 0.65),
    ],
    onDetectionClick: vi.fn(),
    showPredictions: true,
    detectionAnnotations: new Map(),
    fromParam: null,
    getIsAnnotated: vi.fn((annotation) => !!annotation),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering Tests', () => {
    it('should render grid container with correct classes', () => {
      const { container } = render(<DetectionGrid {...defaultProps} />);
      
      const gridContainer = container.querySelector('.space-y-6.pt-20');
      expect(gridContainer).toBeInTheDocument();
      
      const gridLayout = container.querySelector('.grid.grid-cols-2.md\\:grid-cols-3.lg\\:grid-cols-4.gap-6');
      expect(gridLayout).toBeInTheDocument();
    });

    it('should render all detections as cards', () => {
      render(<DetectionGrid {...defaultProps} />);
      
      expect(screen.getByTestId('detection-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('detection-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('detection-card-3')).toBeInTheDocument();
    });

    it('should display detection confidence scores', () => {
      render(<DetectionGrid {...defaultProps} />);
      
      expect(screen.getByText(/Detection 1 - 0.95/)).toBeInTheDocument();
      expect(screen.getByText(/Detection 2 - 0.75/)).toBeInTheDocument();
      expect(screen.getByText(/Detection 3 - 0.65/)).toBeInTheDocument();
    });

    it('should apply responsive grid classes', () => {
      const { container } = render(<DetectionGrid {...defaultProps} />);
      
      const gridElement = container.querySelector('.grid');
      expect(gridElement).toHaveClass(
        'grid-cols-2',    // Mobile: 2 columns
        'md:grid-cols-3', // Medium: 3 columns  
        'lg:grid-cols-4', // Large: 4 columns
        'gap-6'           // Consistent gap
      );
    });

    it('should render empty grid when no detections provided', () => {
      const { container } = render(
        <DetectionGrid {...defaultProps} detections={[]} />
      );
      
      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).toBeInTheDocument();
      expect(gridContainer?.children).toHaveLength(0);
    });
  });

  describe('Props Testing', () => {
    it('should pass showPredictions prop to each detection card', () => {
      render(<DetectionGrid {...defaultProps} showPredictions={false} />);
      
      const cards = screen.getAllByTestId(/detection-card-/);
      cards.forEach(card => {
        expect(card).toHaveAttribute('data-show-predictions', 'false');
      });
    });

    it('should pass detection annotations to cards', () => {
      const annotations = new Map([
        [1, createDetectionAnnotation(1, true)],
        [2, createDetectionAnnotation(2, false)],
      ]);
      
      render(<DetectionGrid {...defaultProps} detectionAnnotations={annotations} />);
      
      expect(screen.getByTestId('detection-card-1')).toHaveAttribute('data-has-annotation', 'true');
      expect(screen.getByTestId('detection-card-2')).toHaveAttribute('data-has-annotation', 'true');
      expect(screen.getByTestId('detection-card-3')).toHaveAttribute('data-has-annotation', 'false');
    });

    it('should call getIsAnnotated with correct parameters', () => {
      const getIsAnnotated = vi.fn().mockReturnValue(true);
      const annotations = new Map([[1, createDetectionAnnotation(1)]]);
      
      render(
        <DetectionGrid 
          {...defaultProps} 
          getIsAnnotated={getIsAnnotated}
          detectionAnnotations={annotations}
          fromParam="visual-check"
        />
      );
      
      expect(getIsAnnotated).toHaveBeenCalledWith(annotations.get(1), "visual-check");
      expect(getIsAnnotated).toHaveBeenCalledWith(undefined, "visual-check");
      expect(getIsAnnotated).toHaveBeenCalledTimes(3); // Once per detection
    });

    it('should pass isAnnotated result to detection cards', () => {
      const getIsAnnotated = vi.fn()
        .mockReturnValueOnce(true)   // Detection 1: annotated
        .mockReturnValueOnce(false)  // Detection 2: not annotated
        .mockReturnValueOnce(true);  // Detection 3: annotated
      
      render(<DetectionGrid {...defaultProps} getIsAnnotated={getIsAnnotated} />);
      
      expect(screen.getByTestId('detection-card-1')).toHaveAttribute('data-annotated', 'true');
      expect(screen.getByTestId('detection-card-2')).toHaveAttribute('data-annotated', 'false');
      expect(screen.getByTestId('detection-card-3')).toHaveAttribute('data-annotated', 'true');
    });
  });

  describe('User Interactions', () => {
    it('should call onDetectionClick with correct index when card is clicked', () => {
      const onDetectionClick = vi.fn();
      render(<DetectionGrid {...defaultProps} onDetectionClick={onDetectionClick} />);
      
      fireEvent.click(screen.getByTestId('detection-card-2'));
      
      expect(onDetectionClick).toHaveBeenCalledWith(1); // Index 1 for second detection
      expect(onDetectionClick).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple card clicks correctly', () => {
      const onDetectionClick = vi.fn();
      render(<DetectionGrid {...defaultProps} onDetectionClick={onDetectionClick} />);
      
      fireEvent.click(screen.getByTestId('detection-card-1'));
      fireEvent.click(screen.getByTestId('detection-card-3'));
      
      expect(onDetectionClick).toHaveBeenNthCalledWith(1, 0); // First detection (index 0)
      expect(onDetectionClick).toHaveBeenNthCalledWith(2, 2); // Third detection (index 2)
      expect(onDetectionClick).toHaveBeenCalledTimes(2);
    });

    it('should support keyboard navigation on cards', () => {
      const onDetectionClick = vi.fn();
      render(<DetectionGrid {...defaultProps} onDetectionClick={onDetectionClick} />);
      
      const card = screen.getByTestId('detection-card-1');
      
      // Cards should have proper keyboard attributes
      expect(card).toHaveAttribute('role', 'button');
      expect(card).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('Integration Tests', () => {
    it('should handle mixed annotation states correctly', () => {
      const annotations = new Map([
        [1, createDetectionAnnotation(1, true)],  // True positive
        [2, createDetectionAnnotation(2, false)], // False positive
        // Detection 3 has no annotation
      ]);
      
      const getIsAnnotated = vi.fn()
        .mockImplementation((annotation) => !!annotation);
      
      render(
        <DetectionGrid 
          {...defaultProps} 
          detectionAnnotations={annotations}
          getIsAnnotated={getIsAnnotated}
        />
      );
      
      // Verify all detections are rendered with correct annotation state
      expect(screen.getByTestId('detection-card-1')).toHaveAttribute('data-annotated', 'true');
      expect(screen.getByTestId('detection-card-2')).toHaveAttribute('data-annotated', 'true');
      expect(screen.getByTestId('detection-card-3')).toHaveAttribute('data-annotated', 'false');
    });

    it('should handle fromParam context correctly', () => {
      const getIsAnnotated = vi.fn().mockReturnValue(false);
      
      render(
        <DetectionGrid 
          {...defaultProps} 
          fromParam="sequence-list"
          getIsAnnotated={getIsAnnotated}
        />
      );
      
      // Verify fromParam is passed to getIsAnnotated for all detections
      expect(getIsAnnotated).toHaveBeenCalledWith(undefined, "sequence-list");
      expect(getIsAnnotated).toHaveBeenCalledTimes(3);
    });

    it('should maintain detection order and mapping', () => {
      const detectionsInOrder = [
        createDetection(5, 0.99),
        createDetection(3, 0.88),
        createDetection(7, 0.77),
      ];
      
      const onDetectionClick = vi.fn();
      
      render(
        <DetectionGrid 
          {...defaultProps} 
          detections={detectionsInOrder}
          onDetectionClick={onDetectionClick}
        />
      );
      
      // Verify detections are rendered in the provided order
      const cards = screen.getAllByTestId(/detection-card-/);
      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveAttribute('data-testid', 'detection-card-5');
      expect(cards[1]).toHaveAttribute('data-testid', 'detection-card-3');
      expect(cards[2]).toHaveAttribute('data-testid', 'detection-card-7');
      
      // Verify click indices match array positions, not detection IDs
      fireEvent.click(cards[1]);
      expect(onDetectionClick).toHaveBeenCalledWith(1); // Array index, not detection ID
    });
  });

  describe('Edge Cases', () => {
    it('should handle detections with missing or null data gracefully', () => {
      const detectionsWithMissingData = [
        { ...createDetection(1), confidence: undefined },
        { ...createDetection(2), algo_predictions: { smoke_bbox_confidence: 0 } },
      ] as Detection[];
      
      expect(() => {
        render(<DetectionGrid {...defaultProps} detections={detectionsWithMissingData} />);
      }).not.toThrow();
      
      // Should still render the cards
      expect(screen.getByTestId('detection-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('detection-card-2')).toBeInTheDocument();
    });

    it('should handle null/undefined fromParam', () => {
      const getIsAnnotated = vi.fn().mockReturnValue(true);
      
      render(
        <DetectionGrid 
          {...defaultProps} 
          fromParam={null}
          getIsAnnotated={getIsAnnotated}
        />
      );
      
      expect(getIsAnnotated).toHaveBeenCalledWith(undefined, null);
    });

    it('should handle empty annotation map', () => {
      const getIsAnnotated = vi.fn().mockReturnValue(false);
      
      render(
        <DetectionGrid 
          {...defaultProps} 
          detectionAnnotations={new Map()}
          getIsAnnotated={getIsAnnotated}
        />
      );
      
      // Should call getIsAnnotated with undefined for all detections
      expect(getIsAnnotated).toHaveBeenCalledWith(undefined, null);
      expect(getIsAnnotated).toHaveBeenCalledTimes(3);
    });

    it('should handle very large detection arrays efficiently', () => {
      const manyDetections = Array.from({ length: 100 }, (_, i) => createDetection(i + 1));
      
      const { container } = render(
        <DetectionGrid {...defaultProps} detections={manyDetections} />
      );
      
      const gridContainer = container.querySelector('.grid');
      expect(gridContainer?.children).toHaveLength(100);
    });

    it('should maintain component stability with prop changes', () => {
      const { rerender } = render(<DetectionGrid {...defaultProps} />);
      
      // Change showPredictions
      rerender(<DetectionGrid {...defaultProps} showPredictions={false} />);
      
      // Should still render all cards
      expect(screen.getByTestId('detection-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('detection-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('detection-card-3')).toBeInTheDocument();
      
      // Verify prop was updated
      expect(screen.getByTestId('detection-card-1')).toHaveAttribute('data-show-predictions', 'false');
    });
  });

  describe('Accessibility', () => {
    it('should provide proper semantic structure', () => {
      const { container } = render(<DetectionGrid {...defaultProps} />);
      
      const gridContainer = container.querySelector('[role="grid"], .grid');
      expect(gridContainer).toBeInTheDocument();
    });

    it('should ensure all cards are keyboard accessible', () => {
      render(<DetectionGrid {...defaultProps} />);
      
      const cards = screen.getAllByRole('button');
      cards.forEach(card => {
        expect(card).toHaveAttribute('tabIndex', '0');
      });
    });

    it('should maintain focus management', () => {
      render(<DetectionGrid {...defaultProps} />);
      
      const firstCard = screen.getByTestId('detection-card-1');
      firstCard.focus();
      
      expect(document.activeElement).toBe(firstCard);
    });
  });
});