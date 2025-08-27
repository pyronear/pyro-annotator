/**
 * Integration tests for annotation workflow utilities.
 * Tests the interaction between multiple utility modules to catch regressions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SequenceBbox, SequenceAnnotation } from '@/types/api';
import { 
  createBboxChangeHandler,
  createSaveHandler,
  createResetHandler
} from '@/utils/annotation/annotationHandlers';
import { createKeyboardHandler } from '@/utils/annotation/keyboardUtils';

describe('Annotation Workflow Integration', () => {
  let mockBboxes: SequenceBbox[];
  let mockSetBboxes: ReturnType<typeof vi.fn>;
  let mockSaveMutation: { mutate: ReturnType<typeof vi.fn> };
  let mockShowToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks
    mockBboxes = [
      {
        id: 1,
        is_smoke: false,
        smoke_type: undefined,
        false_positive_types: [],
        bboxes: [{ x_min: 0, y_min: 0, x_max: 100, y_max: 100 }]
      },
      {
        id: 2,
        is_smoke: true,
        smoke_type: 'wildfire',
        false_positive_types: [],
        bboxes: [{ x_min: 100, y_min: 100, x_max: 200, y_max: 200 }]
      }
    ];

    mockSetBboxes = vi.fn((updater) => {
      if (typeof updater === 'function') {
        mockBboxes = updater(mockBboxes);
      } else {
        mockBboxes = updater;
      }
    });

    mockSaveMutation = {
      mutate: vi.fn()
    };

    mockShowToast = vi.fn();
  });

  describe('Bbox Change Handler Integration', () => {
    it('should update bbox and maintain consistency', () => {
      const handleBboxChange = createBboxChangeHandler(mockSetBboxes);
      
      const updatedBbox: SequenceBbox = {
        ...mockBboxes[0],
        is_smoke: true,
        smoke_type: 'industrial'
      };

      handleBboxChange(0, updatedBbox);

      expect(mockSetBboxes).toHaveBeenCalledTimes(1);
      const updateFunction = mockSetBboxes.mock.calls[0][0];
      const result = updateFunction(mockBboxes);
      
      expect(result[0].is_smoke).toBe(true);
      expect(result[0].smoke_type).toBe('industrial');
      expect(result[1]).toEqual(mockBboxes[1]); // Other bbox unchanged
    });

    it('should handle false positive type changes correctly', () => {
      const handleBboxChange = createBboxChangeHandler(mockSetBboxes);
      
      const updatedBbox: SequenceBbox = {
        ...mockBboxes[0],
        is_smoke: false,
        false_positive_types: ['antenna', 'building']
      };

      handleBboxChange(0, updatedBbox);

      const updateFunction = mockSetBboxes.mock.calls[0][0];
      const result = updateFunction(mockBboxes);
      
      expect(result[0].false_positive_types).toHaveLength(2);
      expect(result[0].false_positive_types).toContain('antenna');
      expect(result[0].false_positive_types).toContain('building');
    });
  });

  describe('Save Handler with Validation Integration', () => {
    it('should save successfully when all validations pass', () => {
      const validBboxes = mockBboxes.map(bbox => ({
        ...bbox,
        is_smoke: true,
        smoke_type: 'wildfire' as const
      }));

      const handleSave = createSaveHandler(
        validBboxes,
        'yes', // missed smoke review
        false, // not unsure
        mockSaveMutation,
        mockShowToast
      );

      handleSave();

      expect(mockSaveMutation.mutate).toHaveBeenCalledWith(validBboxes);
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('should show error toast when validation fails', () => {
      const invalidBboxes = mockBboxes.map(bbox => ({
        ...bbox,
        is_smoke: true,
        smoke_type: undefined // Missing smoke type
      }));

      const handleSave = createSaveHandler(
        invalidBboxes,
        null, // No missed smoke review
        false, // not unsure
        mockSaveMutation,
        mockShowToast
      );

      handleSave();

      expect(mockSaveMutation.mutate).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(/detections still need annotation|missed smoke review/),
        'error'
      );
    });

    it('should skip validation when marked as unsure', () => {
      const incompleteBboxes = mockBboxes.map(bbox => ({
        ...bbox,
        is_smoke: false,
        false_positive_types: [] // Incomplete
      }));

      const handleSave = createSaveHandler(
        incompleteBboxes,
        null, // No review
        true, // IS unsure - should skip validation
        mockSaveMutation,
        mockShowToast
      );

      handleSave();

      // Should save despite incomplete data
      expect(mockSaveMutation.mutate).toHaveBeenCalledWith(incompleteBboxes);
      expect(mockShowToast).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard Handler Integration', () => {
    let mockEvent: Partial<KeyboardEvent>;
    let mockDeps: Parameters<typeof createKeyboardHandler>[0];

    beforeEach(() => {
      mockEvent = {
        key: '',
        preventDefault: vi.fn(),
        ctrlKey: false,
        shiftKey: false,
        target: document.body
      };

      mockDeps = {
        activeDetectionIndex: 0,
        bboxes: mockBboxes,
        showKeyboardModal: false,
        missedSmokeReview: null,
        primaryClassification: {},
        setShowKeyboardModal: vi.fn(),
        handleReset: vi.fn(),
        handleSave: vi.fn(),
        navigateToPreviousDetection: vi.fn(),
        navigateToNextDetection: vi.fn(),
        handleMissedSmokeReviewChange: vi.fn(),
        handleBboxChange: createBboxChangeHandler(mockSetBboxes),
        onPrimaryClassificationChange: vi.fn()
      };
    });

    it('should handle smoke classification shortcut (S key)', () => {
      const handleKeyDown = createKeyboardHandler(mockDeps);
      
      mockEvent.key = 's';
      handleKeyDown(mockEvent as KeyboardEvent);

      expect(mockDeps.onPrimaryClassificationChange).toHaveBeenCalledWith({
        0: 'smoke'
      });
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle smoke type shortcuts (1, 2, 3)', () => {
      // Set first bbox as smoke
      mockDeps.bboxes[0].is_smoke = true;
      mockDeps.primaryClassification = { 0: 'smoke' };
      
      const handleKeyDown = createKeyboardHandler(mockDeps);
      
      // Press '1' for wildfire
      mockEvent.key = '1';
      handleKeyDown(mockEvent as KeyboardEvent);

      expect(mockSetBboxes).toHaveBeenCalled();
      const updateFunction = mockSetBboxes.mock.calls[0][0];
      const result = updateFunction(mockBboxes);
      expect(result[0].smoke_type).toBe('wildfire');
    });

    it('should handle navigation shortcuts', () => {
      const handleKeyDown = createKeyboardHandler(mockDeps);
      
      // Test arrow down
      mockEvent.key = 'ArrowDown';
      handleKeyDown(mockEvent as KeyboardEvent);
      expect(mockDeps.navigateToNextDetection).toHaveBeenCalled();

      // Test arrow up
      mockEvent.key = 'ArrowUp';
      handleKeyDown(mockEvent as KeyboardEvent);
      expect(mockDeps.navigateToPreviousDetection).toHaveBeenCalled();
    });

    it('should handle save shortcut (Enter)', () => {
      const handleKeyDown = createKeyboardHandler(mockDeps);
      
      mockEvent.key = 'Enter';
      handleKeyDown(mockEvent as KeyboardEvent);

      expect(mockDeps.handleSave).toHaveBeenCalled();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it('should handle reset shortcut (Ctrl+Z)', () => {
      const handleKeyDown = createKeyboardHandler(mockDeps);
      
      mockEvent.key = 'z';
      mockEvent.ctrlKey = true;
      handleKeyDown(mockEvent as KeyboardEvent);

      expect(mockDeps.handleReset).toHaveBeenCalled();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Reset Handler Integration', () => {
    it('should reset to clean state for ready_to_annotate stage', () => {
      const mockAnnotation: SequenceAnnotation = {
        id: 1,
        sequence_id: 1,
        processing_stage: 'ready_to_annotate',
        has_missed_smoke: false,
        is_unsure: false,
        annotation: {
          sequences_bbox: mockBboxes.map(bbox => ({
            ...bbox,
            is_smoke: true,
            smoke_type: 'wildfire'
          }))
        }
      } as SequenceAnnotation;

      const mockSetters = {
        setHasMissedSmoke: vi.fn(),
        setIsUnsure: vi.fn(),
        setMissedSmokeReview: vi.fn(),
        setBboxes: vi.fn(),
        setPrimaryClassification: vi.fn()
      };

      const handleReset = createResetHandler(
        mockAnnotation,
        mockSetters.setHasMissedSmoke,
        mockSetters.setIsUnsure,
        mockSetters.setMissedSmokeReview,
        mockSetters.setBboxes,
        mockSetters.setPrimaryClassification,
        mockShowToast
      );

      handleReset();

      // Should reset to clean bboxes
      expect(mockSetters.setBboxes).toHaveBeenCalled();
      const cleanBboxes = mockSetters.setBboxes.mock.calls[0][0];
      expect(cleanBboxes[0].is_smoke).toBe(false);
      expect(cleanBboxes[0].smoke_type).toBeUndefined();
      
      expect(mockShowToast).toHaveBeenCalledWith('Annotation reset successfully', 'success');
    });

    it('should preserve data for annotated stage', () => {
      const mockAnnotation: SequenceAnnotation = {
        id: 1,
        sequence_id: 1,
        processing_stage: 'annotated',
        has_missed_smoke: true,
        is_unsure: false,
        annotation: {
          sequences_bbox: mockBboxes
        }
      } as SequenceAnnotation;

      const mockSetters = {
        setHasMissedSmoke: vi.fn(),
        setIsUnsure: vi.fn(),
        setMissedSmokeReview: vi.fn(),
        setBboxes: vi.fn(),
        setPrimaryClassification: vi.fn()
      };

      const handleReset = createResetHandler(
        mockAnnotation,
        mockSetters.setHasMissedSmoke,
        mockSetters.setIsUnsure,
        mockSetters.setMissedSmokeReview,
        mockSetters.setBboxes,
        mockSetters.setPrimaryClassification,
        mockShowToast
      );

      handleReset();

      // Should preserve original bbox data
      expect(mockSetters.setBboxes).toHaveBeenCalledWith(mockBboxes);
      expect(mockSetters.setHasMissedSmoke).toHaveBeenCalledWith(true);
    });
  });
});