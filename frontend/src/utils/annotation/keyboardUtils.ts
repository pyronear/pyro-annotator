/**
 * Keyboard shortcuts utilities for annotation interface.
 *
 * This module handles complex keyboard event processing and shortcuts for the
 * annotation interface, including navigation, classification, and global actions.
 *
 * @fileoverview Provides a comprehensive keyboard handler factory that manages
 * all keyboard shortcuts in the annotation interface, from basic navigation to
 * complex classification workflows.
 */

import { SequenceBbox, SmokeType } from '@/types/api';
import { isAnnotationComplete } from './progressUtils';
import {
  getTypeIndexForKey,
  toggleFalsePositiveType,
  BboxChangeHandler,
  MissedSmokeHandler,
} from './annotationHandlers';

/**
 * Dependencies interface for the keyboard handler.
 * Contains all state and action functions needed for keyboard shortcut handling.
 *
 * @interface KeyboardHandlerDependencies
 */
export interface KeyboardHandlerDependencies {
  // State
  /** Currently active detection index (null if in sequence section) */
  activeDetectionIndex: number | null;
  /** Array of sequence bounding boxes */
  bboxes: SequenceBbox[];
  /** Whether the keyboard shortcuts modal is visible */
  showKeyboardModal: boolean;
  /** Current missed smoke review state */
  missedSmokeReview: 'yes' | 'no' | null;
  /** Primary classification state for each detection */
  primaryClassification: Record<number, 'unselected' | 'smoke' | 'false_positive'>;

  // Actions
  /** Function to show/hide keyboard shortcuts modal */
  setShowKeyboardModal: (show: boolean) => void;
  /** Function to reset annotation state */
  handleReset: () => void;
  /** Function to save current annotation */
  handleSave: () => void;
  /** Unused — Arrow Up/Down navigation was removed (Tab owns navigation); kept optional so legacy AnnotationInterface still type-checks until its removal. */
  navigateToPreviousDetection?: () => void;
  /** Unused — see navigateToPreviousDetection. */
  navigateToNextDetection?: () => void;
  /** Function to handle missed smoke review changes */
  handleMissedSmokeReviewChange: MissedSmokeHandler;
  /** Function to handle bbox changes */
  handleBboxChange: BboxChangeHandler;
  /** Function to handle primary classification changes */
  onPrimaryClassificationChange: (
    updates: Record<number, 'unselected' | 'smoke' | 'false_positive'>
  ) => void;
  /** Optional: toggle the active detection's Unsure state (U key) — wired only by the classify cockpit. */
  onUnsureToggle?: (detectionIndex: number) => void;
}

/**
 * Creates a comprehensive keyboard event handler for annotation interface.
 *
 * This factory function creates a complete keyboard event handler that supports
 * all annotation interface shortcuts including navigation, classification,
 * smoke type selection, and false positive type toggling.
 *
 * @param {KeyboardHandlerDependencies} deps - All state and action dependencies
 * @returns {(e: KeyboardEvent) => void} Keyboard event handler function
 *
 * @example
 * ```typescript
 * const handleKeyDown = createKeyboardHandler({
 *   activeDetectionIndex,
 *   bboxes,
 *   showKeyboardModal,
 *   // ... other dependencies
 * });
 *
 * useEffect(() => {
 *   document.addEventListener('keydown', handleKeyDown, true);
 *   return () => document.removeEventListener('keydown', handleKeyDown, true);
 * }, [dependencies]);
 * ```
 *
 * Supported shortcuts:
 * - ?: Show/hide keyboard shortcuts modal
 * - Escape: Close modal
 * - Ctrl+Z: Reset annotation
 * - Enter: Save annotation
 * - Y/N: Missed smoke review
 * - S: Mark as smoke
 * - F: Mark as false positive
 * - 1,2,3: Select smoke type (wildfire, industrial, other)
 * - A-Z: Toggle false positive types (various letter mappings)
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
      handleMissedSmokeReviewChange,
      handleBboxChange,
      onPrimaryClassificationChange,
      onUnsureToggle,
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
        [activeDetectionIndex]: 'smoke',
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
        [activeDetectionIndex]: 'false_positive',
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

    // Unsure toggle (U key) — optional, classify cockpit only. Handled
    // before the FP-type letters so it works in every classification mode
    // (Dust moved to J to free the mnemonic).
    if ((e.key === 'u' || e.key === 'U') && onUnsureToggle) {
      onUnsureToggle(activeDetectionIndex);
      e.preventDefault();
      return;
    }

    // Smoke type shortcuts (1, 2, 3 keys) - Only when smoke is selected
    const bbox = bboxes[activeDetectionIndex];
    const classificationType =
      primaryClassification[activeDetectionIndex] ||
      (bbox?.is_smoke
        ? 'smoke'
        : bbox?.false_positive_types.length > 0
          ? 'false_positive'
          : 'unselected');

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

    // False positive type shortcuts (various keys) - Only when false positive is selected.
    // Modifier chords (Ctrl/Cmd/Alt + letter) are browser shortcuts, not annotations.
    if (classificationType === 'false_positive' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const typeIndex = getTypeIndexForKey(e.key.toLowerCase());
      if (typeIndex !== -1) {
        toggleFalsePositiveType(activeDetectionIndex, typeIndex, bboxes, handleBboxChange);
        e.preventDefault();
        return;
      }
    }
  };
};
