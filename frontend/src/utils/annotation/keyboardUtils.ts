/**
 * Keyboard shortcuts utilities for annotation interface.
 * Handles complex keyboard event processing and shortcuts.
 */

import { SequenceBbox, SmokeType } from '@/types/api';
import { isAnnotationComplete } from './progressUtils';
import { getTypeIndexForKey, toggleFalsePositiveType, BboxChangeHandler, MissedSmokeHandler } from './annotationHandlers';

export interface KeyboardHandlerDependencies {
  // State
  activeDetectionIndex: number | null;
  bboxes: SequenceBbox[];
  showKeyboardModal: boolean;
  missedSmokeReview: 'yes' | 'no' | null;
  primaryClassification: Record<number, 'unselected' | 'smoke' | 'false_positive'>;
  
  // Actions
  setShowKeyboardModal: (show: boolean) => void;
  handleReset: () => void;
  handleSave: () => void;
  navigateToPreviousDetection: () => void;
  navigateToNextDetection: () => void;
  handleMissedSmokeReviewChange: MissedSmokeHandler;
  handleBboxChange: BboxChangeHandler;
  onPrimaryClassificationChange: (updates: Record<number, 'unselected' | 'smoke' | 'false_positive'>) => void;
}

/**
 * Creates a comprehensive keyboard event handler for annotation interface.
 */
export const createKeyboardHandler = (deps: KeyboardHandlerDependencies) => {
  return (e: KeyboardEvent) => {
    const {
      activeDetectionIndex,
      bboxes,
      showKeyboardModal,
      missedSmokeReview,
      primaryClassification,
      setShowKeyboardModal,
      handleReset,
      handleSave,
      navigateToPreviousDetection,
      navigateToNextDetection,
      handleMissedSmokeReviewChange,
      handleBboxChange,
      onPrimaryClassificationChange
    } = deps;

    // Handle help modal first (works regardless of focus)
    // Note: '?' key requires Shift to be pressed, so we shouldn't check for !e.shiftKey
    if (e.key === '?') {
      setShowKeyboardModal(!showKeyboardModal);
      e.preventDefault();
      return;
    }
    
    // Handle Escape to close modal
    if (e.key === 'Escape' && showKeyboardModal) {
      setShowKeyboardModal(false);
      e.preventDefault();
      return;
    }

    // Handle global shortcuts (work regardless of active detection)
    // Reset annotation (Ctrl + Z)
    if (e.key === 'z' && e.ctrlKey) {
      handleReset();
      e.preventDefault();
      return;
    }

    // Complete annotation (Enter)
    if (e.key === 'Enter' && !showKeyboardModal) {
      if (isAnnotationComplete(bboxes, missedSmokeReview)) {
        handleSave();
      } else {
        handleSave(); // Use the same error logic as handleSave
      }
      e.preventDefault();
      return;
    }

    // Navigation shortcuts (Arrow Up/Down)
    if (e.key === 'ArrowUp' && !showKeyboardModal) {
      navigateToPreviousDetection();
      e.preventDefault();
      return;
    }

    if (e.key === 'ArrowDown' && !showKeyboardModal) {
      navigateToNextDetection();
      e.preventDefault();
      return;
    }

    // Missed smoke review shortcuts (Y/N)
    if ((e.key === 'y' || e.key === 'Y') && !showKeyboardModal) {
      handleMissedSmokeReviewChange('yes');
      e.preventDefault();
      return;
    }

    if ((e.key === 'n' || e.key === 'N') && !showKeyboardModal) {
      handleMissedSmokeReviewChange('no');
      e.preventDefault();
      return;
    }

    // Detection-specific shortcuts (require active detection)
    if (activeDetectionIndex === null || showKeyboardModal) return;

    // Smoke classification (S key)
    if (e.key === 's' || e.key === 'S') {
      // Update UI state
      onPrimaryClassificationChange({
        ...primaryClassification,
        [activeDetectionIndex]: 'smoke'
      });
      
      // Update backend data
      const bbox = bboxes[activeDetectionIndex];
      if (bbox) {
        const updatedBbox = { ...bbox };
        updatedBbox.is_smoke = true;
        updatedBbox.false_positive_types = []; // Clear false positive types
        handleBboxChange(activeDetectionIndex, updatedBbox);
      }
      e.preventDefault();
      return;
    }

    // False positive classification (F key)
    if (e.key === 'f' || e.key === 'F') {
      // Update UI state
      onPrimaryClassificationChange({
        ...primaryClassification,
        [activeDetectionIndex]: 'false_positive'
      });
      
      // Update backend data
      const bbox = bboxes[activeDetectionIndex];
      if (bbox) {
        const updatedBbox = { ...bbox };
        updatedBbox.is_smoke = false;
        updatedBbox.smoke_type = undefined; // Clear smoke type
        handleBboxChange(activeDetectionIndex, updatedBbox);
      }
      e.preventDefault();
      return;
    }

    // Smoke type shortcuts (1, 2, 3 keys) - Only when smoke is selected
    const bbox = bboxes[activeDetectionIndex];
    const classificationType = primaryClassification[activeDetectionIndex] || 
      (bbox?.is_smoke ? 'smoke' : bbox?.false_positive_types.length > 0 ? 'false_positive' : 'unselected');

    if (classificationType === 'smoke') {
      if (e.key === '1') {
        // Wildfire
        const updatedBbox = { ...bbox };
        updatedBbox.smoke_type = 'wildfire' as SmokeType;
        handleBboxChange(activeDetectionIndex, updatedBbox);
        e.preventDefault();
        return;
      }

      if (e.key === '2') {
        // Industrial
        const updatedBbox = { ...bbox };
        updatedBbox.smoke_type = 'industrial' as SmokeType;
        handleBboxChange(activeDetectionIndex, updatedBbox);
        e.preventDefault();
        return;
      }

      if (e.key === '3') {
        // Other
        const updatedBbox = { ...bbox };
        updatedBbox.smoke_type = 'other' as SmokeType;
        handleBboxChange(activeDetectionIndex, updatedBbox);
        e.preventDefault();
        return;
      }
    }

    // False positive type shortcuts (various keys) - Only when false positive is selected
    if (classificationType === 'false_positive') {
      const typeIndex = getTypeIndexForKey(e.key.toLowerCase());
      if (typeIndex !== -1) {
        toggleFalsePositiveType(activeDetectionIndex, typeIndex, bboxes, handleBboxChange);
        e.preventDefault();
        return;
      }
    }
  };
};