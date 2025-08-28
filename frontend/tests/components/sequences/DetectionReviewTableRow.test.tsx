/**
 * Core functionality tests for DetectionReviewTableRow component.
 * Focuses on detection review display, progress indicators, and annotation pills.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetectionReviewTableRow } from '@/components/sequences/DetectionReviewTableRow';
import type { SequenceWithDetectionProgress, SequenceAnnotation } from '@/types/api';

// Mock the utility functions
vi.mock('@/utils/modelAccuracy', () => ({
  analyzeSequenceAccuracy: vi.fn(() => ({
    label: 'High Accuracy',
    type: 'high_accuracy',
    accuracy: 0.95,
  })),
  getFalsePositiveEmoji: vi.fn((type: string) => type === 'antenna' ? '📡' : '❓'),
  formatFalsePositiveType: vi.fn((type: string) => type === 'antenna' ? 'Antenna' : type),
  getRowBackgroundClasses: vi.fn(() => 'bg-green-50 hover:bg-green-100'),
  parseFalsePositiveTypes: vi.fn((types: string) => types ? types.split(',') : []),
  getSmokeTypeEmoji: vi.fn((type: string) => type === 'wildfire' ? '🔥' : '💨'),
  formatSmokeType: vi.fn((type: string) => type === 'wildfire' ? 'Wildfire' : type),
}));

// Mock the child components
vi.mock('@/components/DetectionImageThumbnail', () => ({
  default: ({ sequenceId, className }: { sequenceId: number; className: string }) => (
    <div data-testid="detection-thumbnail" data-sequence-id={sequenceId} className={className}>
      Thumbnail {sequenceId}
    </div>
  ),
}));

vi.mock('@/components/ui/ContributorList', () => ({
  default: ({ contributors, displayMode }: { contributors: any[]; displayMode: string }) => (
    <div data-testid="contributor-list" data-display-mode={displayMode}>
      {contributors.length} contributors
    </div>
  ),
}));

describe('DetectionReviewTableRow', () => {
  // Factory function for creating test sequence data
  const createSequence = (overrides: Partial<SequenceWithDetectionProgress> = {}): SequenceWithDetectionProgress => ({
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
    is_wildfire_alertapi: 'other',
    organisation_name: 'Test Org',
    organisation_id: 1,
    detection_annotation_stats: null,
    ...overrides,
  });

  // Factory function for creating test annotation data
  const createAnnotation = (overrides: Partial<SequenceAnnotation> = {}): SequenceAnnotation => ({
    id: 1,
    sequence_id: 1,
    has_smoke: true,
    has_false_positives: false,
    false_positive_types: '',
    smoke_types: ['wildfire'],
    has_missed_smoke: false,
    is_unsure: false,
    annotation: {},
    processing_stage: 'annotated',
    created_at: '2024-01-01T10:00:00Z',
    updated_at: null,
    contributors: [],
    ...overrides,
  });

  const defaultProps = {
    sequence: createSequence(),
    annotation: undefined,
    onSequenceClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Tests', () => {
    it('should render basic sequence information', () => {
      render(<DetectionReviewTableRow {...defaultProps} />);
      
      expect(screen.getByText('Camera-01')).toBeInTheDocument();
      expect(screen.getByText('test-api')).toBeInTheDocument();
      expect(screen.getByText('Test Org')).toBeInTheDocument();
      expect(screen.getByText(/1\/1\/2024/)).toBeInTheDocument();
    });

    it('should render detection thumbnail', () => {
      render(<DetectionReviewTableRow {...defaultProps} />);
      
      const thumbnail = screen.getByTestId('detection-thumbnail');
      expect(thumbnail).toBeInTheDocument();
      expect(thumbnail).toHaveAttribute('data-sequence-id', '1');
      expect(thumbnail).toHaveClass('h-16');
    });

    it('should render azimuth when present', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: 180 }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText('Azimuth: 180°')).toBeInTheDocument();
    });

    it('should not render azimuth when null', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: null }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.queryByText(/Azimuth:/)).not.toBeInTheDocument();
    });

    it('should render wildfire alert badge with red styling', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ is_wildfire_alertapi: 'wildfire_smoke' }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const wildfireBadge = screen.getByText('🔥 Wildfire');
      expect(wildfireBadge).toBeInTheDocument();
      expect(wildfireBadge).toHaveClass('bg-red-100', 'text-red-800');
    });

    it('should not render wildfire alert badge when is_wildfire_alertapi is other', () => {
      render(<DetectionReviewTableRow {...defaultProps} />);
      
      expect(screen.queryByText('🔥 Wildfire Alert')).not.toBeInTheDocument();
    });
  });

  describe('Detection Progress Tests', () => {
    it('should render detection progress when stats are present', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({
          detection_annotation_stats: {
            annotated_detections: 8,
            total_detections: 10,
            completion_percentage: 80,
          },
        }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText(/8\/10 detections completed/)).toBeInTheDocument();
    });

    it('should not render detection progress when stats are null', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ detection_annotation_stats: null }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.queryByText(/detections completed/)).not.toBeInTheDocument();
    });

    it('should show full progress bar with green styling', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({
          detection_annotation_stats: {
            annotated_detections: 10,
            total_detections: 10,
            completion_percentage: 100,
          },
        }),
      };
      
      const { container } = render(<DetectionReviewTableRow {...props} />);
      
      const progressBar = container.querySelector('.bg-green-600.h-2.rounded-full.w-full');
      expect(progressBar).toBeInTheDocument();
    });

    it('should display progress text with green styling', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({
          detection_annotation_stats: {
            annotated_detections: 5,
            total_detections: 8,
            completion_percentage: 62.5,
          },
        }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const progressText = screen.getByText(/5\/8 detections completed/);
      expect(progressText).toBeInTheDocument();
      expect(progressText).toHaveClass('text-xs', 'text-green-600', 'font-medium');
    });
  });

  describe('Annotation Display Tests', () => {
    it('should render false positive pills when annotation is present', () => {
      const annotation = createAnnotation({ false_positive_types: 'antenna,building' });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText(/📡 Antenna/)).toBeInTheDocument();
    });

    it('should render smoke type pills when annotation is present', () => {
      const annotation = createAnnotation({ smoke_types: ['wildfire', 'industrial'] });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText(/🔥 Wildfire/)).toBeInTheDocument();
      expect(screen.getByText(/💨 industrial/)).toBeInTheDocument();
    });

    it('should render contributor list when annotation has contributors', () => {
      const annotation = createAnnotation({ 
        contributors: [
          { username: 'user1', id: 1 },
          { username: 'user2', id: 2 },
        ] 
      });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const contributorList = screen.getByTestId('contributor-list');
      expect(contributorList).toBeInTheDocument();
      expect(contributorList).toHaveAttribute('data-display-mode', 'compact');
      expect(contributorList).toHaveTextContent('2 contributors');
    });

    it('should not render annotation pills when annotation is undefined', () => {
      render(<DetectionReviewTableRow {...defaultProps} />);
      
      expect(screen.queryByText(/🔥 Wildfire/)).not.toBeInTheDocument();
      expect(screen.queryByText(/📡 Antenna/)).not.toBeInTheDocument();
      expect(screen.queryByTestId('contributor-list')).not.toBeInTheDocument();
    });

    it('should not render contributor list when contributors array is empty', () => {
      const annotation = createAnnotation({ contributors: [] });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.queryByTestId('contributor-list')).not.toBeInTheDocument();
    });
  });

  describe('Styling Tests', () => {
    it('should apply default styling when no annotation is present', () => {
      const { container } = render(<DetectionReviewTableRow {...defaultProps} />);
      
      const row = container.firstChild as HTMLElement;
      expect(row).toHaveClass('p-4', 'hover:bg-gray-50', 'cursor-pointer');
    });

    it('should apply model accuracy styling when annotation is present', () => {
      const annotation = createAnnotation();
      const props = {
        ...defaultProps,
        annotation,
      };
      
      const { container } = render(<DetectionReviewTableRow {...props} />);
      
      const row = container.firstChild as HTMLElement;
      expect(row).toHaveClass('p-4', 'cursor-pointer', 'bg-green-50', 'hover:bg-green-100');
    });

    it('should apply correct badge styling', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ is_wildfire_alertapi: 'wildfire_smoke' }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const sourceApiBadge = screen.getByText('test-api');
      expect(sourceApiBadge).toHaveClass('bg-blue-100', 'text-blue-800');
      
      const wildfireBadge = screen.getByText('🔥 Wildfire');
      expect(wildfireBadge).toHaveClass('bg-red-100', 'text-red-800');
    });

    it('should apply correct pill styling for false positive types', () => {
      const annotation = createAnnotation({ false_positive_types: 'antenna' });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const pill = screen.getByText(/📡 Antenna/);
      expect(pill).toHaveClass('bg-yellow-100', 'text-yellow-800');
    });

    it('should apply correct pill styling for smoke types', () => {
      const annotation = createAnnotation({ smoke_types: ['wildfire'] });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const pill = screen.getByText(/🔥 Wildfire/);
      expect(pill).toHaveClass('bg-orange-100', 'text-orange-800');
    });
  });

  describe('Interaction Tests', () => {
    it('should call onSequenceClick when row is clicked', () => {
      const onSequenceClick = vi.fn();
      const props = { ...defaultProps, onSequenceClick };
      
      render(<DetectionReviewTableRow {...props} />);
      
      const row = screen.getByText('Camera-01').closest('div[onClick]') || screen.getByText('Camera-01').parentElement?.parentElement?.parentElement;
      expect(row).toBeInTheDocument();
      
      if (row) {
        fireEvent.click(row);
        expect(onSequenceClick).toHaveBeenCalledWith(props.sequence);
        expect(onSequenceClick).toHaveBeenCalledTimes(1);
      }
    });

    it('should have cursor-pointer class for clickable indication', () => {
      const { container } = render(<DetectionReviewTableRow {...defaultProps} />);
      
      const row = container.firstChild as HTMLElement;
      expect(row).toHaveClass('cursor-pointer');
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing azimuth (null)', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: null }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.queryByText(/Azimuth:/)).not.toBeInTheDocument();
    });

    it('should handle missing azimuth (undefined)', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: undefined }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.queryByText(/Azimuth:/)).not.toBeInTheDocument();
    });

    it('should handle zero azimuth', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: 0 }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText('Azimuth: 0°')).toBeInTheDocument();
    });

    it('should handle empty smoke_types array', () => {
      const annotation = createAnnotation({ smoke_types: [] });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      expect(() => render(<DetectionReviewTableRow {...props} />)).not.toThrow();
    });

    it('should handle null smoke_types', () => {
      const annotation = createAnnotation({ smoke_types: null as any });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      expect(() => render(<DetectionReviewTableRow {...props} />)).not.toThrow();
    });

    it('should handle empty false_positive_types', () => {
      const annotation = createAnnotation({ false_positive_types: '' });
      const props = {
        ...defaultProps,
        annotation,
      };
      
      expect(() => render(<DetectionReviewTableRow {...props} />)).not.toThrow();
    });

    it('should handle invalid date format gracefully', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ recorded_at: 'invalid-date' }),
      };
      
      expect(() => render(<DetectionReviewTableRow {...props} />)).not.toThrow();
    });

    it('should handle detection stats with zero values', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({
          detection_annotation_stats: {
            annotated_detections: 0,
            total_detections: 5,
            completion_percentage: 0,
          },
        }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText(/0\/5 detections completed/)).toBeInTheDocument();
    });

    it('should handle perfect completion stats', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({
          detection_annotation_stats: {
            annotated_detections: 100,
            total_detections: 100,
            completion_percentage: 100,
          },
        }),
      };
      
      render(<DetectionReviewTableRow {...props} />);
      
      expect(screen.getByText(/100\/100 detections completed/)).toBeInTheDocument();
    });
  });
});