/**
 * Navigation utilities for annotation interface.
 *
 * This module handles keyboard navigation and smooth scrolling between detections
 * and the sequence reviewer section in the annotation interface.
 *
 * @fileoverview Provides factory functions for creating navigation handlers that
 * manage active detection state and smooth scrolling behavior.
 */

import React from 'react';
import { SequenceBbox } from '@/types/api';

/**
 * Active section types in the annotation interface.
 * @typedef {'detections' | 'sequence'} ActiveSection
 */
export type ActiveSection = 'detections' | 'sequence';

/**
 * Navigation state interface containing current navigation context.
 * @interface NavigationState
 */
export interface NavigationState {
  /** Index of currently active detection (null if in sequence section) */
  activeDetectionIndex: number | null;
  /** Currently active section of the interface */
  activeSection: ActiveSection;
  /** Array of detection bboxes */
  bboxes: SequenceBbox[];
  /** Whether keyboard shortcuts modal is open */
  showKeyboardModal: boolean;
}

/**
 * Navigation actions interface for updating navigation state.
 * @interface NavigationActions
 */
export interface NavigationActions {
  /** Function to set the active detection index */
  setActiveDetectionIndex: (index: number | null) => void;
  /** Function to set the active section */
  setActiveSection: (section: ActiveSection) => void;
}

/**
 * References interface for DOM elements used in navigation.
 * @interface ScrollRefs
 */
export interface ScrollRefs {
  /** Array of refs to detection card elements */
  detectionRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  /** Ref to the sequence reviewer element */
  sequenceReviewerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Navigates to the previous detection with smooth scrolling.
 */
export const createPreviousDetectionNavigator = (
  state: NavigationState,
  actions: NavigationActions,
  refs: ScrollRefs
) => {
  return () => {
    const { activeSection, activeDetectionIndex, bboxes } = state;
    const { setActiveDetectionIndex, setActiveSection } = actions;
    const { detectionRefs, sequenceReviewerRef } = refs;

    // If we're in sequence section, go back to last detection
    if (activeSection === 'sequence') {
      if (bboxes.length > 0) {
        const lastIndex = bboxes.length - 1;
        setActiveDetectionIndex(lastIndex);
        setActiveSection('detections');

        // Use requestAnimationFrame to ensure DOM is updated before scrolling
        requestAnimationFrame(() => {
          const lastElement = detectionRefs.current[lastIndex];
          if (lastElement) {
            lastElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        });
      }
      return;
    }

    // If at first detection, go to sequence reviewer
    if (activeSection === 'detections' && activeDetectionIndex === 0) {
      setActiveSection('sequence');
      setActiveDetectionIndex(null);

      // Use requestAnimationFrame to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        if (sequenceReviewerRef.current) {
          sequenceReviewerRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      });
      return;
    }

    // Regular detection navigation
    if (activeDetectionIndex === null || activeDetectionIndex <= 0) {
      return;
    }

    const previousIndex = activeDetectionIndex - 1;
    setActiveDetectionIndex(previousIndex);

    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    requestAnimationFrame(() => {
      const previousElement = detectionRefs.current[previousIndex];
      if (previousElement) {
        previousElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    });
  };
};

/**
 * Navigates to the next detection with smooth scrolling.
 */
export const createNextDetectionNavigator = (
  state: NavigationState,
  actions: NavigationActions,
  refs: ScrollRefs
) => {
  return () => {
    const { activeSection, activeDetectionIndex, bboxes } = state;
    const { setActiveDetectionIndex, setActiveSection } = actions;
    const { detectionRefs } = refs;

    // If in sequence section with detections, go to first detection
    if (activeSection === 'sequence' && bboxes.length > 0) {
      setActiveSection('detections');
      setActiveDetectionIndex(0);

      // Use requestAnimationFrame to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        const firstElement = detectionRefs.current[0];
        if (firstElement) {
          firstElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      });
      return;
    }

    // If in sequence section and no detections, stay in sequence
    if (activeSection === 'sequence' && bboxes.length === 0) {
      return;
    }

    // Regular detection navigation
    if (activeDetectionIndex === null || activeDetectionIndex >= bboxes.length - 1) {
      return;
    }

    const nextIndex = activeDetectionIndex + 1;
    setActiveDetectionIndex(nextIndex);

    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    requestAnimationFrame(() => {
      const nextElement = detectionRefs.current[nextIndex];
      if (nextElement) {
        nextElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    });
  };
};
