/**
 * Core functionality tests for DetectionHeader component.
 * Focuses on essential user interactions, state management, and accessibility.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetectionHeader } from '@/components/detection-sequence/DetectionHeader';
import type { Sequence, SequenceAnnotation } from '@/types/api';

// Mock the icons to avoid test complications
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    // Override specific icons for testing
    ArrowLeft: () => <div data-testid="arrow-left">←</div>,
    ChevronLeft: () => <div data-testid="chevron-left">‹</div>,
    ChevronRight: () => <div data-testid="chevron-right">›</div>,
    CheckCircle: () => <div data-testid="check-circle">✓</div>,
    AlertCircle: () => <div data-testid="alert-circle">!</div>,
    Upload: () => <div data-testid="upload">↑</div>,
  };
});

// Mock the model accuracy utilities
vi.mock('@/utils/modelAccuracy', () => ({
  analyzeSequenceAccuracy: vi.fn(() => ({
    label: 'High Accuracy',
    icon: '🎯',
    accuracy: 0.95,
  })),
  getModelAccuracyBadgeClasses: vi.fn(() => 'bg-green-100 text-green-800'),
}));

describe('DetectionHeader', () => {
  // Factory function for creating test sequence data
  const createSequence = (overrides: Partial<Sequence> = {}): Sequence => ({
    id: 1,
    source_api: 'test-api',
    alert_api_id: 123,
    created_at: '2024-01-01T10:00:00Z',
    recorded_at: '2024-01-01T10:00:00Z',
    last_seen_at: '2024-01-01T10:00:00Z',
    camera_name: 'Camera-01',
    camera_id: 1,
    lat: 45.123456,
    lon: -122.987654,
    azimuth: 180,
    is_wildfire_alertapi: 'wildfire_smoke',
    organisation_name: 'Test Org',
    organisation_id: 1,
    ...overrides,
  });

  // Factory function for creating test sequence annotation
  const createSequenceAnnotation = (): SequenceAnnotation => ({
    id: 1,
    sequence_id: 1,
    has_smoke: true,
    has_false_positives: false,
    false_positive_types: '',
    smoke_types: ['wildfire'],
    has_missed_smoke: false,
    is_unsure: false,
    annotation: {},
    processing_stage: 'annotation_complete',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: null,
    contributors: [],
  });

  const defaultProps = {
    sequence: createSequence(),
    sequenceAnnotation: createSequenceAnnotation(),
    annotatedCount: 5,
    totalCount: 10,
    completionPercentage: 50,
    isAllAnnotated: false,
    onBack: vi.fn(),
    canNavigatePrevious: vi.fn(() => true),
    canNavigateNext: vi.fn(() => true),
    onPreviousSequence: vi.fn(),
    onNextSequence: vi.fn(),
    getCurrentSequenceIndex: vi.fn(() => 0),
    rawSequencesLoading: false,
    rawSequencesError: false,
    allSequences: { total: 5 },
    showPredictions: true,
    onTogglePredictions: vi.fn(),
    allInVisualCheck: false,
    onSave: vi.fn(),
    saveAnnotations: { isPending: false },
    getAnnotationPills: vi.fn(() => [<div key="pill">Pill</div>]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Tests', () => {
    it('should render sequence metadata correctly', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByText('Test Org')).toBeInTheDocument();
      expect(screen.getByText('Camera-01')).toBeInTheDocument();
      expect(screen.getByText(/1\/1\/2024/)).toBeInTheDocument(); // Date formatting
      expect(screen.getByText('180°')).toBeInTheDocument(); // Azimuth
      expect(screen.getByText(/45\.123, -122\.988/)).toBeInTheDocument(); // Coordinates
    });

    it('should display progress information correctly', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByText(/5 of 10 detections/)).toBeInTheDocument();
      expect(screen.getByText(/50% complete/)).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('should show completion status when all annotated', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          isAllAnnotated={true}
          completionPercentage={100}
          annotatedCount={10}
        />
      );
      
      expect(screen.getByText('Done')).toBeInTheDocument();
      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getAllByTestId('check-circle')).toHaveLength(2);
    });

    it('should display sequence context information', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByText('Sequence 1 of 5')).toBeInTheDocument();
    });

    it('should show model accuracy when available', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByText(/🎯 High Accuracy/)).toBeInTheDocument();
    });

    it('should render annotation pills', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByText('Pill')).toBeInTheDocument();
    });

    it('should handle missing sequence data gracefully', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          sequence={undefined}
          sequenceAnnotation={undefined}
        />
      );
      
      expect(screen.getAllByText('Loading...')).toHaveLength(3);
    });
  });

  describe('Navigation Tests', () => {
    it('should render navigation buttons in normal state', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByTestId('chevron-left')).toBeInTheDocument();
      expect(screen.getByTestId('chevron-right')).toBeInTheDocument();
    });

    it('should call navigation callbacks when buttons are clicked', () => {
      const onPreviousSequence = vi.fn();
      const onNextSequence = vi.fn();
      
      render(
        <DetectionHeader 
          {...defaultProps} 
          onPreviousSequence={onPreviousSequence}
          onNextSequence={onNextSequence}
        />
      );
      
      const prevButton = screen.getByTestId('chevron-left').closest('button')!;
      const nextButton = screen.getByTestId('chevron-right').closest('button')!;
      
      fireEvent.click(prevButton);
      fireEvent.click(nextButton);
      
      expect(onPreviousSequence).toHaveBeenCalledTimes(1);
      expect(onNextSequence).toHaveBeenCalledTimes(1);
    });

    it('should disable navigation buttons based on can navigate functions', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          canNavigatePrevious={() => false}
          canNavigateNext={() => false}
        />
      );
      
      const prevButton = screen.getByTestId('chevron-left').closest('button')!;
      const nextButton = screen.getByTestId('chevron-right').closest('button')!;
      
      expect(prevButton).toBeDisabled();
      expect(nextButton).toBeDisabled();
    });

    it('should show loading state for navigation buttons', () => {
      render(<DetectionHeader {...defaultProps} rawSequencesLoading={true} />);
      
      const buttons = screen.getAllByTestId(/chevron-/);
      buttons.forEach(icon => {
        const button = icon.closest('button')!;
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'Loading sequences...');
      });
    });

    it('should show error state for navigation buttons', () => {
      render(<DetectionHeader {...defaultProps} rawSequencesError={true} />);
      
      const buttons = screen.getAllByTestId(/chevron-/);
      buttons.forEach(icon => {
        const button = icon.closest('button')!;
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('title', 'Error loading sequences');
      });
    });

    it('should handle back button click', () => {
      const onBack = vi.fn();
      render(<DetectionHeader {...defaultProps} onBack={onBack} />);
      
      const backButton = screen.getByTestId('arrow-left').closest('button')!;
      fireEvent.click(backButton);
      
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Controls Tests', () => {
    it('should render predictions toggle with correct state', () => {
      render(<DetectionHeader {...defaultProps} showPredictions={true} />);
      
      const checkbox = screen.getByLabelText('Show predictions');
      expect(checkbox).toBeChecked();
    });

    it('should call toggle function when predictions checkbox is changed', () => {
      const onTogglePredictions = vi.fn();
      render(
        <DetectionHeader 
          {...defaultProps} 
          onTogglePredictions={onTogglePredictions}
          showPredictions={false}
        />
      );
      
      const checkbox = screen.getByLabelText('Show predictions');
      fireEvent.click(checkbox);
      
      expect(onTogglePredictions).toHaveBeenCalledWith(true);
    });

    it('should show submit button when allInVisualCheck is true', () => {
      render(<DetectionHeader {...defaultProps} allInVisualCheck={true} />);
      
      expect(screen.getByText('Submit All')).toBeInTheDocument();
      expect(screen.getByTestId('upload')).toBeInTheDocument();
    });

    it('should not show submit button when allInVisualCheck is false', () => {
      render(<DetectionHeader {...defaultProps} allInVisualCheck={false} />);
      
      expect(screen.queryByText('Submit All')).not.toBeInTheDocument();
    });

    it('should handle submit button click', () => {
      const onSave = vi.fn();
      render(
        <DetectionHeader 
          {...defaultProps} 
          allInVisualCheck={true}
          onSave={onSave}
        />
      );
      
      const submitButton = screen.getByText('Submit All').closest('button')!;
      fireEvent.click(submitButton);
      
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('should show loading state on submit button when saving', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          allInVisualCheck={true}
          saveAnnotations={{ isPending: true }}
        />
      );
      
      const submitButton = screen.getByText('Submit All').closest('button')!;
      expect(submitButton).toBeDisabled();
      
      // Should show spinner instead of upload icon
      expect(screen.queryByTestId('upload')).not.toBeInTheDocument();
    });
  });

  describe('State Tests', () => {
    it('should display loading state for sequences context', () => {
      render(<DetectionHeader {...defaultProps} rawSequencesLoading={true} />);
      
      expect(screen.getByText('Loading sequences...')).toBeInTheDocument();
    });

    it('should display error state for sequences context', () => {
      render(<DetectionHeader {...defaultProps} rawSequencesError={true} />);
      
      expect(screen.getByText('Error loading sequences')).toBeInTheDocument();
    });

    it('should handle empty sequences state', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          allSequences={{ total: 0 }}
        />
      );
      
      expect(screen.getByText('No sequences found')).toBeInTheDocument();
    });

    it('should apply correct styling for completed state', () => {
      const { container } = render(
        <DetectionHeader {...defaultProps} isAllAnnotated={true} />
      );
      
      const header = container.querySelector('.fixed.top-0');
      expect(header).toHaveClass('bg-green-50/90', 'border-green-200', 'border-l-4', 'border-l-green-500');
    });

    it('should apply correct styling for incomplete state', () => {
      const { container } = render(
        <DetectionHeader {...defaultProps} isAllAnnotated={false} />
      );
      
      const header = container.querySelector('.fixed.top-0');
      expect(header).toHaveClass('bg-white/85', 'border-gray-200');
    });

    it('should handle progress bar styling for different states', () => {
      const { rerender } = render(
        <DetectionHeader {...defaultProps} isAllAnnotated={false} completionPercentage={75} />
      );
      
      let progressBar = document.querySelector('.bg-primary-600');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveStyle('width: 75%');
      
      // Test completed state
      rerender(
        <DetectionHeader {...defaultProps} isAllAnnotated={true} completionPercentage={100} />
      );
      
      progressBar = document.querySelector('.bg-green-600');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveStyle('width: 100%');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined coordinates', () => {
      const sequenceWithoutCoords = createSequence({ 
        lat: null as unknown as number, 
        lon: null as unknown as number,
        azimuth: null 
      });
      
      render(<DetectionHeader {...defaultProps} sequence={sequenceWithoutCoords} />);
      
      // Should not render coordinate information
      expect(screen.queryByText(/45\.123/)).not.toBeInTheDocument();
      expect(screen.queryByText('180°')).not.toBeInTheDocument();
    });

    it('should handle zero completion percentage', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          completionPercentage={0}
          annotatedCount={0}
        />
      );
      
      expect(screen.getByText(/0 of 10 detections/)).toBeInTheDocument();
      expect(screen.getByText(/0% complete/)).toBeInTheDocument();
    });

    it('should handle large numbers gracefully', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          annotatedCount={999}
          totalCount={1000}
          completionPercentage={99.9}
          allSequences={{ total: 9999 }}
          getCurrentSequenceIndex={() => 9998}
        />
      );
      
      expect(screen.getByText(/999 of 1000 detections/)).toBeInTheDocument();
      expect(screen.getByText(/99\.9% complete/)).toBeInTheDocument();
      expect(screen.getByText('Sequence 9999 of 9999')).toBeInTheDocument();
    });

    it('should handle empty annotation pills array', () => {
      render(<DetectionHeader {...defaultProps} getAnnotationPills={() => []} />);
      
      // Should not crash and should render normally
      expect(screen.getByText('Test Org')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper button semantics', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
      
      buttons.forEach(button => {
        expect(button).toBeInTheDocument();
      });
    });

    it('should have descriptive button titles', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      expect(screen.getByTitle('Back to sequences')).toBeInTheDocument();
      expect(screen.getByTitle('Previous sequence')).toBeInTheDocument();
      expect(screen.getByTitle('Next sequence')).toBeInTheDocument();
    });

    it('should update button titles based on navigation state', () => {
      render(
        <DetectionHeader 
          {...defaultProps} 
          canNavigatePrevious={() => false}
          canNavigateNext={() => false}
        />
      );
      
      expect(screen.getByTitle('Already at first sequence')).toBeInTheDocument();
      expect(screen.getByTitle('Already at last sequence')).toBeInTheDocument();
    });

    it('should have proper form controls', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      const checkbox = screen.getByLabelText('Show predictions');
      expect(checkbox).toHaveAttribute('type', 'checkbox');
    });

    it('should have proper submit button attributes', () => {
      render(<DetectionHeader {...defaultProps} allInVisualCheck={true} />);
      
      const submitButton = screen.getByText('Submit All').closest('button')!;
      expect(submitButton).toHaveAttribute('title');
      expect(submitButton.getAttribute('title')).toContain('Submit all detection annotations');
    });

    it('should maintain focus management', () => {
      render(<DetectionHeader {...defaultProps} />);
      
      const backButton = screen.getByTestId('arrow-left').closest('button')!;
      backButton.focus();
      
      expect(document.activeElement).toBe(backButton);
    });
  });
});