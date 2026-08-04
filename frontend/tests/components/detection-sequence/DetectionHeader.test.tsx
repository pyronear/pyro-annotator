/**
 * Tests for the single-row sticky DetectionHeader (#227 redesign).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetectionHeader } from '@/components/detection-sequence/DetectionHeader';
import type { Sequence, SequenceAnnotation } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';

// Mock the icons to avoid test complications
vi.mock('lucide-react', async importOriginal => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    ArrowLeft: () => <div data-testid="arrow-left">←</div>,
    ChevronLeft: () => <div data-testid="chevron-left">‹</div>,
    ChevronRight: () => <div data-testid="chevron-right">›</div>,
    CheckCircle: () => <div data-testid="check-circle">✓</div>,
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
  const createSequence = (overrides: Partial<Sequence> = {}): Sequence =>
    ({
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
    }) as Sequence;

  const createSequenceAnnotation = (): SequenceAnnotation =>
    ({
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
    }) as unknown as SequenceAnnotation;

  const defaultProps = {
    sequence: createSequence(),
    sequenceAnnotation: createSequenceAnnotation(),
    isAllAnnotated: false,
    onBack: vi.fn(),
    canNavigatePrevious: vi.fn(() => true),
    canNavigateNext: vi.fn(() => true),
    onPreviousSequence: vi.fn(),
    onNextSequence: vi.fn(),
    rawSequencesLoading: false,
    rawSequencesError: false,
    showPredictions: true,
    onTogglePredictions: vi.fn(),
    allInVisualCheck: false,
    onSave: vi.fn(),
    saveAnnotations: { isPending: false },
    cardSize: 'md' as const,
    onCardSizeChange: vi.fn(),
    getAnnotationPills: vi.fn(() => [<div key="pill">Pill</div>]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Layout', () => {
    it('is sticky, not fixed', () => {
      const { container } = render(<DetectionHeader {...defaultProps} />);
      const header = container.firstElementChild as HTMLElement;
      expect(header.className).toContain('sticky');
      expect(header.className).not.toContain('fixed');
    });

    it('renders org, camera, and time — no azimuth, coordinates, or progress', () => {
      render(<DetectionHeader {...defaultProps} />);
      expect(screen.getByText('Test Org')).toBeInTheDocument();
      expect(screen.getByText('Camera-01')).toBeInTheDocument();
      expect(screen.getByText(formatDateTime('2024-01-01T10:00:00Z'))).toBeInTheDocument();
      expect(screen.queryByText('180°')).toBeNull();
      expect(screen.queryByText(/45\.123/)).toBeNull();
      expect(screen.queryByText(/frames/)).toBeNull();
      expect(screen.queryByText(/% complete/)).toBeNull();
      expect(screen.queryByText(/Sequence \d+ of/)).toBeNull();
    });

    it('shows a check chip and green tint when all annotated', () => {
      const { container } = render(<DetectionHeader {...defaultProps} isAllAnnotated />);
      expect(screen.getByTestId('check-circle')).toBeInTheDocument();
      expect((container.firstElementChild as HTMLElement).className).toContain('bg-green-50/90');
    });

    it('renders annotation pills and the accuracy badge', () => {
      render(<DetectionHeader {...defaultProps} />);
      expect(screen.getByText('Pill')).toBeInTheDocument();
      expect(screen.getByText(/🎯 High Accuracy/)).toBeInTheDocument();
    });

    it('handles missing sequence data gracefully', () => {
      render(
        <DetectionHeader {...defaultProps} sequence={undefined} sequenceAnnotation={undefined} />
      );
      expect(screen.getAllByText('Loading...')).toHaveLength(3);
    });
  });

  describe('Navigation', () => {
    it('calls navigation callbacks when chevrons are clicked', () => {
      render(<DetectionHeader {...defaultProps} />);
      fireEvent.click(screen.getByTestId('chevron-left').closest('button')!);
      fireEvent.click(screen.getByTestId('chevron-right').closest('button')!);
      expect(defaultProps.onPreviousSequence).toHaveBeenCalledTimes(1);
      expect(defaultProps.onNextSequence).toHaveBeenCalledTimes(1);
    });

    it('disables chevrons based on can-navigate functions', () => {
      render(
        <DetectionHeader
          {...defaultProps}
          canNavigatePrevious={() => false}
          canNavigateNext={() => false}
        />
      );
      expect(screen.getByTestId('chevron-left').closest('button')).toBeDisabled();
      expect(screen.getByTestId('chevron-right').closest('button')).toBeDisabled();
      expect(screen.getByTitle('Already at first sequence')).toBeInTheDocument();
      expect(screen.getByTitle('Already at last sequence')).toBeInTheDocument();
    });

    it('shows loading and error states on chevrons', () => {
      const { rerender } = render(
        <DetectionHeader {...defaultProps} rawSequencesLoading={true} />
      );
      screen.getAllByTestId(/chevron-/).forEach(icon => {
        expect(icon.closest('button')).toHaveAttribute('title', 'Loading sequences...');
      });
      rerender(<DetectionHeader {...defaultProps} rawSequencesError={true} />);
      screen.getAllByTestId(/chevron-/).forEach(icon => {
        expect(icon.closest('button')).toHaveAttribute('title', 'Error loading sequences');
      });
    });

    it('handles back button click', () => {
      render(<DetectionHeader {...defaultProps} />);
      fireEvent.click(screen.getByTitle('Back to sequences'));
      expect(defaultProps.onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('View controls', () => {
    it('predictions toggle fires through the toolbar', () => {
      render(<DetectionHeader {...defaultProps} showPredictions={false} />);
      fireEvent.click(screen.getByTitle('Show predictions (P)'));
      expect(defaultProps.onTogglePredictions).toHaveBeenCalledWith(true);
    });

    it('card size control fires onCardSizeChange', () => {
      render(<DetectionHeader {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'L' }));
      expect(defaultProps.onCardSizeChange).toHaveBeenCalledWith('lg');
    });

    it('crop and cropped-view toggles appear only in localize', () => {
      const onToggleCropMode = vi.fn();
      const { rerender } = render(<DetectionHeader {...defaultProps} />);
      expect(screen.queryByTitle('Crop cells (C)')).toBeNull();
      expect(screen.queryByTitle('Cropped view')).toBeNull();

      rerender(
        <DetectionHeader
          {...defaultProps}
          isLocalize
          onQuickSubmit={() => {}}
          cropMode={false}
          onToggleCropMode={onToggleCropMode}
        />
      );
      fireEvent.click(screen.getByTitle('Crop cells (C)'));
      expect(onToggleCropMode).toHaveBeenCalledWith(true);
    });
  });

  describe('Submit', () => {
    it('localize: Accept & submit fires onQuickSubmit', () => {
      const onQuickSubmit = vi.fn();
      render(
        <DetectionHeader {...defaultProps} isLocalize noBoxCount={0} onQuickSubmit={onQuickSubmit} />
      );
      fireEvent.click(screen.getByRole('button', { name: /accept & submit/i }));
      expect(onQuickSubmit).toHaveBeenCalledOnce();
    });

    it('localize confirm state warns about frames with no box', () => {
      render(
        <DetectionHeader
          {...defaultProps}
          isLocalize
          noBoxCount={2}
          quickSubmitConfirming
          onQuickSubmit={() => {}}
        />
      );
      expect(screen.getByText(/2 frames with no box — submit anyway\?/i)).toBeInTheDocument();
    });

    it('localize: disables the button while submitting and hides Submit All', () => {
      render(
        <DetectionHeader
          {...defaultProps}
          isLocalize
          allInVisualCheck
          quickSubmitPending
          onQuickSubmit={() => {}}
        />
      );
      expect(screen.getByText(/accept & submit/i).closest('button')).toBeDisabled();
      expect(screen.queryByText('Submit All')).toBeNull();
    });

    it('non-localize keeps Submit All behavior including pending spinner', () => {
      const { rerender } = render(<DetectionHeader {...defaultProps} allInVisualCheck />);
      fireEvent.click(screen.getByText('Submit All').closest('button')!);
      expect(defaultProps.onSave).toHaveBeenCalledTimes(1);

      rerender(
        <DetectionHeader {...defaultProps} allInVisualCheck saveAnnotations={{ isPending: true }} />
      );
      expect(screen.getByText('Submit All').closest('button')).toBeDisabled();
      expect(screen.queryByTestId('upload')).toBeNull();
    });

    it('does not show Submit All when allInVisualCheck is false', () => {
      render(<DetectionHeader {...defaultProps} />);
      expect(screen.queryByText('Submit All')).toBeNull();
    });
  });
});
