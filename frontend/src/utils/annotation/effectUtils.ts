/**
 * Complex useEffect utilities for annotation interface.
 *
 * This module contains factory functions for creating complex useEffect logic
 * that was extracted from the AnnotationInterface component, including
 * annotation initialization and intersection observer setup.
 *
 * @fileoverview Provides reusable effect logic for annotation state initialization,
 * viewport-based active detection tracking, and state clearing operations.
 */

import React from 'react';
import { SequenceAnnotation, SequenceBbox } from '@/types/api';
import { initializeCleanBbox, getInitialMissedSmokeReview } from './sequenceUtils';

/**
 * Dependencies interface for annotation initialization effect.
 * Contains all functions needed to initialize annotation state properly.
 *
 * @interface AnnotationInitializationDeps
 */
export interface AnnotationInitializationDeps {
  /** Current annotation data (undefined if loading) */
  annotation: SequenceAnnotation | undefined;
  /** Current sequence ID */
  sequenceId: number | null;
  /** Function to set current annotation in local state */
  setCurrentAnnotation: (annotation: SequenceAnnotation | null) => void;
  /** Function to set missed smoke flag */
  setHasMissedSmoke: (hasSmoke: boolean) => void;
  /** Function to set unsure flag */
  setIsUnsure: (isUnsure: boolean) => void;
  /** Function to set missed smoke review state */
  setMissedSmokeReview: (review: 'yes' | 'no' | null) => void;
  /** Function to set bboxes array */
  setBboxes: (bboxes: SequenceBbox[]) => void;
}

/**
 * Dependencies interface for intersection observer effect.
 * Contains DOM refs and state setters for automatic active detection tracking.
 *
 * @interface IntersectionObserverDeps
 */
export interface IntersectionObserverDeps {
  /** Current bboxes array */
  bboxes: SequenceBbox[];
  /** References to detection card DOM elements */
  detectionRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  /** Reference to sequence reviewer DOM element */
  sequenceReviewerRef: React.RefObject<HTMLDivElement>;
  /** Function to set active section */
  setActiveSection: (section: 'detections' | 'sequence') => void;
  /** Function to set active detection index */
  setActiveDetectionIndex: (index: number | null) => void;
}

/**
 * Creates annotation initialization effect logic.
 *
 * This factory function creates a useEffect callback that handles smart
 * initialization of annotation state based on processing stage. It initializes
 * bboxes differently for 'ready_to_annotate' vs 'annotated' stages.
 *
 * @param {AnnotationInitializationDeps} deps - All state setters and data needed
 * @returns {() => void} Effect callback function for useEffect
 *
 * @example
 * ```typescript
 * useEffect(
 *   createAnnotationInitializationEffect({
 *     annotation,
 *     sequenceId,
 *     setCurrentAnnotation,
 *     setHasMissedSmoke,
 *     setIsUnsure,
 *     setMissedSmokeReview,
 *     setBboxes
 *   }),
 *   [annotation, sequenceId]
 * );
 * ```
 */
export const createAnnotationInitializationEffect = (deps: AnnotationInitializationDeps) => {
  return () => {
    const {
      annotation,
      sequenceId,
      setCurrentAnnotation,
      setHasMissedSmoke,
      setIsUnsure,
      setMissedSmokeReview,
      setBboxes,
    } = deps;

    if (annotation && sequenceId) {
      console.log(`AnnotationInterface: Loading annotation for sequence ${sequenceId}`);
      setCurrentAnnotation(annotation);

      // Initialize missed smoke flag from existing annotation
      setHasMissedSmoke(annotation.has_missed_smoke || false);

      // Initialize unsure flag from existing annotation
      setIsUnsure(annotation.is_unsure || false);

      // Initialize missed smoke review using helper function that respects processing stage
      setMissedSmokeReview(getInitialMissedSmokeReview(annotation));

      // Smart initialization based on processing stage
      if (annotation.processing_stage === 'ready_to_annotate') {
        // For sequences ready to annotate, start with clean checkboxes
        const cleanBboxes = annotation.annotation.sequences_bbox.map(bbox =>
          initializeCleanBbox(bbox)
        );
        setBboxes(cleanBboxes);
      } else {
        // For other stages (like 'annotated'), preserve existing data
        setBboxes([...annotation.annotation.sequences_bbox]);
      }
    }
  };
};

/**
 * Creates intersection observer effect logic for viewport-based active detection.
 * Uses intersection observer to automatically highlight the detection closest to viewport center.
 */
export const createIntersectionObserverEffect = (deps: IntersectionObserverDeps) => {
  return () => {
    const {
      bboxes,
      detectionRefs,
      sequenceReviewerRef,
      setActiveSection,
      setActiveDetectionIndex,
    } = deps;

    // Small delay to ensure refs are set up after render
    const timeoutId = setTimeout(() => {
      const observer = new IntersectionObserver(
        entries => {
          const viewportCenter = window.innerHeight / 2;
          let closestDistance = Infinity;
          let activeElement: Element | null = null;
          let activeIndex: number | null = null;
          let activeType: 'sequence' | 'detection' | null = null;

          entries.forEach(entry => {
            // Only consider elements that are reasonably visible
            if (entry.intersectionRatio < 0.3) return;

            const rect = entry.target.getBoundingClientRect();
            const elementCenter = rect.top + rect.height / 2;
            const distance = Math.abs(elementCenter - viewportCenter);

            if (distance < closestDistance) {
              closestDistance = distance;
              activeElement = entry.target;

              // Check if it's the sequence reviewer
              if (entry.target === sequenceReviewerRef.current) {
                activeType = 'sequence';
                activeIndex = null;
              } else {
                // Check detection elements
                const detectionIndex = detectionRefs.current.findIndex(ref => ref === entry.target);
                if (detectionIndex !== -1) {
                  activeType = 'detection';
                  activeIndex = detectionIndex;
                }
              }
            }
          });

          // Activate the element closest to viewport center (within reasonable distance)
          if (activeElement && closestDistance < window.innerHeight * 0.6) {
            if (activeType === 'sequence') {
              setActiveSection('sequence');
              setActiveDetectionIndex(null);
            } else if (activeType === 'detection' && activeIndex !== null) {
              setActiveSection('detections');
              setActiveDetectionIndex(activeIndex);
            }
          }
        },
        {
          threshold: [0.1, 0.3, 0.5],
          rootMargin: '-20px',
        }
      );

      // Observe all detection cards
      detectionRefs.current.forEach((ref, idx) => {
        // Only observe refs that correspond to current bboxes
        if (ref && idx < bboxes.length) {
          observer.observe(ref);
        }
      });

      // Observe sequence reviewer
      if (sequenceReviewerRef.current) {
        observer.observe(sequenceReviewerRef.current);
      }

      return () => {
        observer.disconnect();
      };
    }, 100); // Small delay to ensure DOM is ready

    return () => {
      clearTimeout(timeoutId);
    };
  };
};

/**
 * Creates a state clearing effect for sequence changes.
 * Clears all annotation state when the sequence ID changes.
 */
export const createSequenceStateClearing = (
  sequenceId: number | null,
  setBboxes: (bboxes: SequenceBbox[]) => void,
  setCurrentAnnotation: (annotation: SequenceAnnotation | null) => void,
  setHasMissedSmoke: (hasSmoke: boolean) => void,
  setMissedSmokeReview: (review: 'yes' | 'no' | null) => void,
  setIsUnsure: (isUnsure: boolean) => void
) => {
  return () => {
    console.log(`AnnotationInterface: Sequence changed to ${sequenceId}, clearing stale state`);
    setBboxes([]);
    setCurrentAnnotation(null);
    setHasMissedSmoke(false);
    setMissedSmokeReview(null);
    setIsUnsure(false);
  };
};
