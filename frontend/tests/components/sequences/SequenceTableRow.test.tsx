/**
 * Core functionality tests for SequenceTableRow component.
 * Focuses on sequence display, conditional rendering, and click handling.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SequenceTableRow } from '@/components/sequences/SequenceTableRow';
import type { SequenceWithAnnotation, SequenceAnnotation } from '@/types/api';

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

vi.mock('@/utils/processingStage', () => ({
  getProcessingStageLabel: vi.fn((stage: string) => {
    const labels = {
      'ready_to_annotate': 'Ready to Annotate',
      'annotated': 'Annotated',
      'annotation_complete': 'Complete',
      'no_annotation': 'No Annotation',
    };
    return labels[stage] || stage;
  }),
  getProcessingStageColorClass: vi.fn((stage: string) => {
    const colors = {
      'ready_to_annotate': 'bg-blue-100 text-blue-800',
      'annotated': 'bg-green-100 text-green-800',
      'annotation_complete': 'bg-purple-100 text-purple-800',
      'no_annotation': 'bg-gray-100 text-gray-800',
    };
    return colors[stage] || 'bg-gray-100 text-gray-800';
  }),
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

describe('SequenceTableRow', () => {
  // Factory function for creating test sequence data
  const createSequence = (overrides: Partial<SequenceWithAnnotation> = {}): SequenceWithAnnotation => ({
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
    annotation: null,
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
    defaultProcessingStage: 'annotated' as const,
    onSequenceClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Display Tests', () => {
    it('should render basic sequence information', () => {
      render(<SequenceTableRow {...defaultProps} />);
      
      expect(screen.getByText('Camera-01')).toBeInTheDocument();
      expect(screen.getByText('test-api')).toBeInTheDocument();
      expect(screen.getByText('Test Org')).toBeInTheDocument();
      expect(screen.getByText(/1\/1\/2024/)).toBeInTheDocument();
    });

    it('should render detection thumbnail', () => {
      render(<SequenceTableRow {...defaultProps} />);
      
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
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText('Azimuth: 180°')).toBeInTheDocument();
    });

    it('should not render azimuth when null', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: null }),
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText(/Azimuth:/)).not.toBeInTheDocument();
    });

    it('should render wildfire alert badge when is_wildfire_alertapi is wildfire_smoke', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ is_wildfire_alertapi: 'wildfire_smoke' }),
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText('🔥 Wildfire')).toBeInTheDocument();
    });

    it('should not render wildfire alert badge when is_wildfire_alertapi is other', () => {
      render(<SequenceTableRow {...defaultProps} />);
      
      expect(screen.queryByText('🔥 Wildfire')).not.toBeInTheDocument();
    });

    it('should not render any badge when is_wildfire_alertapi is null', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ is_wildfire_alertapi: null }),
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText('🔥 Wildfire')).not.toBeInTheDocument();
      expect(screen.queryByText('💨 Other Smoke')).not.toBeInTheDocument();
      expect(screen.queryByText('○ Other')).not.toBeInTheDocument();
    });
  });

  describe('Processing Stage Tests', () => {
    it('should hide processing stage pill when it matches defaultProcessingStage (ready_to_annotate)', () => {
      const annotation = createAnnotation({ processing_stage: 'ready_to_annotate' });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'ready_to_annotate' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText('Ready to Annotate')).not.toBeInTheDocument();
    });

    it('should hide processing stage pill when it matches defaultProcessingStage (annotated)', () => {
      const annotation = createAnnotation({ processing_stage: 'annotated' });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText('Annotated')).not.toBeInTheDocument();
    });

    it('should show processing stage pill when it differs from defaultProcessingStage', () => {
      const annotation = createAnnotation({ processing_stage: 'annotation_complete' });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('should show no_annotation stage for sequences without annotation', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation: null }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText('No Annotation')).toBeInTheDocument();
    });
  });

  describe('Annotation Display Tests', () => {
    it('should render unsure indicator for annotated sequences', () => {
      const annotation = createAnnotation({ is_unsure: true });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText('⚠️ Unsure')).toBeInTheDocument();
    });

    it('should not render unsure indicator for non-annotated processing stage', () => {
      const annotation = createAnnotation({ is_unsure: true });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'ready_to_annotate' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText('⚠️ Unsure')).not.toBeInTheDocument();
    });

    it('should render false positive pills for annotated sequences', () => {
      const annotation = createAnnotation({ false_positive_types: 'antenna,building' });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText(/📡 Antenna/)).toBeInTheDocument();
    });

    it('should render smoke type pills for annotated sequences', () => {
      const annotation = createAnnotation({ smoke_types: ['wildfire', 'industrial'] });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText(/🔥 Wildfire/)).toBeInTheDocument();
      expect(screen.getByText(/💨 industrial/)).toBeInTheDocument();
    });

    it('should render contributor list for annotated sequences', () => {
      const annotation = createAnnotation({ 
        contributors: [
          { username: 'user1', id: 1 },
          { username: 'user2', id: 2 },
        ] 
      });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      const contributorList = screen.getByTestId('contributor-list');
      expect(contributorList).toBeInTheDocument();
      expect(contributorList).toHaveAttribute('data-display-mode', 'compact');
      expect(contributorList).toHaveTextContent('2 contributors');
    });

    it('should not render annotation pills for non-annotated processing stage', () => {
      const annotation = createAnnotation({ 
        smoke_types: ['wildfire'],
        false_positive_types: 'antenna',
      });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'ready_to_annotate' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText(/🔥 Wildfire/)).not.toBeInTheDocument();
      expect(screen.queryByText(/📡 Antenna/)).not.toBeInTheDocument();
    });
  });

  describe('Styling Tests', () => {
    it('should apply default styling for non-annotated sequences', () => {
      const { container } = render(<SequenceTableRow {...defaultProps} />);
      
      const row = container.firstChild as HTMLElement;
      expect(row).toHaveClass('p-4', 'hover:bg-gray-50', 'cursor-pointer');
    });

    it('should apply unsure styling for unsure sequences', () => {
      const annotation = createAnnotation({ is_unsure: true });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      const { container } = render(<SequenceTableRow {...props} />);
      
      const row = container.firstChild as HTMLElement;
      expect(row).toHaveClass('p-4', 'cursor-pointer', 'bg-amber-50', 'hover:bg-amber-100');
    });

    it('should apply model accuracy styling for annotated sequences', () => {
      const annotation = createAnnotation({ is_unsure: false });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      const { container } = render(<SequenceTableRow {...props} />);
      
      const row = container.firstChild as HTMLElement;
      expect(row).toHaveClass('p-4', 'cursor-pointer', 'bg-green-50', 'hover:bg-green-100');
    });

    it('should apply correct badge styling', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ is_wildfire_alertapi: 'wildfire_smoke' }),
      };
      
      render(<SequenceTableRow {...props} />);
      
      const sourceApiBadge = screen.getByText('test-api');
      expect(sourceApiBadge).toHaveClass('bg-blue-100', 'text-blue-800');
      
      const wildfireBadge = screen.getByText('🔥 Wildfire Alert');
      expect(wildfireBadge).toHaveClass('bg-red-100', 'text-red-800');
    });
  });

  describe('Interaction Tests', () => {
    it('should call onSequenceClick when row is clicked', () => {
      const onSequenceClick = vi.fn();
      const props = { ...defaultProps, onSequenceClick };
      
      render(<SequenceTableRow {...props} />);
      
      const row = screen.getByText('Camera-01').closest('div[onClick]') || screen.getByText('Camera-01').parentElement?.parentElement?.parentElement;
      expect(row).toBeInTheDocument();
      
      if (row) {
        fireEvent.click(row);
        expect(onSequenceClick).toHaveBeenCalledWith(props.sequence);
        expect(onSequenceClick).toHaveBeenCalledTimes(1);
      }
    });

    it('should have cursor-pointer class for clickable indication', () => {
      const { container } = render(<SequenceTableRow {...defaultProps} />);
      
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
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText(/Azimuth:/)).not.toBeInTheDocument();
    });

    it('should handle missing azimuth (undefined)', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: undefined }),
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByText(/Azimuth:/)).not.toBeInTheDocument();
    });

    it('should handle zero azimuth', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ azimuth: 0 }),
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.getByText('Azimuth: 0°')).toBeInTheDocument();
    });

    it('should handle empty smoke_types array', () => {
      const annotation = createAnnotation({ smoke_types: [] });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      expect(() => render(<SequenceTableRow {...props} />)).not.toThrow();
    });

    it('should handle null smoke_types', () => {
      const annotation = createAnnotation({ smoke_types: null as any });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      expect(() => render(<SequenceTableRow {...props} />)).not.toThrow();
    });

    it('should handle empty false_positive_types', () => {
      const annotation = createAnnotation({ false_positive_types: '' });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      expect(() => render(<SequenceTableRow {...props} />)).not.toThrow();
    });

    it('should handle empty contributors array', () => {
      const annotation = createAnnotation({ contributors: [] });
      const props = {
        ...defaultProps,
        sequence: createSequence({ annotation }),
        defaultProcessingStage: 'annotated' as const,
      };
      
      render(<SequenceTableRow {...props} />);
      
      expect(screen.queryByTestId('contributor-list')).not.toBeInTheDocument();
    });

    it('should handle invalid date format gracefully', () => {
      const props = {
        ...defaultProps,
        sequence: createSequence({ recorded_at: 'invalid-date' }),
      };
      
      expect(() => render(<SequenceTableRow {...props} />)).not.toThrow();
    });
  });

});