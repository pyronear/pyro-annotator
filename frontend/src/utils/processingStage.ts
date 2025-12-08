/**
 * Processing stage utilities for annotation workflow management.
 *
 * This module provides utilities for managing and analyzing the processing
 * stages of sequences in the PyroAnnotator annotation workflow. It handles
 * the progression from imported sequences through annotation-ready states
 * to completed annotations.
 *
 * Processing stages represent the workflow status:
 * - 'no_annotation': Sequence exists but has no annotation record
 * - 'imported': Sequence imported but not ready for annotation
 * - 'ready_to_annotate': Sequence is ready for human annotation
 * - 'annotated': Sequence has been completely annotated
 *
 * @fileoverview Comprehensive utilities for processing stage analysis,
 * sequence-annotation combination, filtering, and display formatting
 * in the PyroAnnotator annotation interface.
 */

import {
  Sequence,
  SequenceAnnotation,
  SequenceWithProcessingStage,
  ProcessingStageStatus,
  ProcessingStage,
} from '@/types/api';

/**
 * Determines the processing stage status for a sequence based on its annotation.
 *
 * Analyzes the presence and state of sequence annotation data to determine
 * the current processing stage. Returns 'no_annotation' if no annotation
 * exists, otherwise returns the annotation's processing stage.
 *
 * @param {SequenceAnnotation | null} annotation - The annotation data for the sequence
 * @returns {ProcessingStageStatus} The current processing stage status
 *
 * @example
 * ```typescript
 * // Sequence with no annotation
 * const status1 = getProcessingStageStatus(null);
 * // Returns: 'no_annotation'
 *
 * // Sequence with annotation in ready state
 * const annotation = { processing_stage: 'ready_to_annotate', ... };
 * const status2 = getProcessingStageStatus(annotation);
 * // Returns: 'ready_to_annotate'
 * ```
 */
export function getProcessingStageStatus(
  annotation: SequenceAnnotation | null
): ProcessingStageStatus {
  if (!annotation) {
    return 'no_annotation';
  }
  return annotation.processing_stage;
}

/**
 * Combines sequences with their annotation data to include processing stage information.
 *
 * Merges sequence data with their corresponding annotations to create enhanced
 * sequence objects that include processing stage status and annotation IDs.
 * Uses efficient Map-based lookup for O(n) performance with large datasets.
 *
 * @param {Sequence[]} sequences - Array of sequence objects to enhance
 * @param {SequenceAnnotation[]} annotations - Array of annotation data to merge
 * @returns {SequenceWithProcessingStage[]} Enhanced sequences with processing stage information
 *
 * @example
 * ```typescript
 * const sequences = [{ id: 1, name: 'seq1' }, { id: 2, name: 'seq2' }];
 * const annotations = [{ id: 101, sequence_id: 1, processing_stage: 'annotated' }];
 *
 * const combined = combineSequencesWithAnnotations(sequences, annotations);
 * // Returns: [
 * //   { id: 1, name: 'seq1', processing_stage_status: 'annotated', annotation_id: 101 },
 * //   { id: 2, name: 'seq2', processing_stage_status: 'no_annotation', annotation_id: undefined }
 * // ]
 * ```
 */
export function combineSequencesWithAnnotations(
  sequences: Sequence[],
  annotations: SequenceAnnotation[]
): SequenceWithProcessingStage[] {
  // Create a map of sequence_id -> annotation for quick lookup
  const annotationMap = new Map<number, SequenceAnnotation>();
  annotations.forEach(annotation => {
    annotationMap.set(annotation.sequence_id, annotation);
  });

  // Combine sequences with their processing stage status
  return sequences.map(sequence => {
    const annotation = annotationMap.get(sequence.id) || null;
    const processing_stage_status = getProcessingStageStatus(annotation);

    return {
      ...sequence,
      processing_stage_status,
      annotation_id: annotation?.id,
    };
  });
}

/**
 * Filters sequences by processing stage status.
 *
 * Applies processing stage filtering to an array of sequences, returning
 * only those that match the specified stage. If no filter is provided,
 * returns all sequences unchanged.
 *
 * @param {SequenceWithProcessingStage[]} sequences - Sequences to filter
 * @param {ProcessingStageStatus} [processingStageFilter] - Optional stage to filter by
 * @returns {SequenceWithProcessingStage[]} Filtered sequences matching the stage
 *
 * @example
 * ```typescript
 * const sequences = [
 *   { id: 1, processing_stage_status: 'annotated' },
 *   { id: 2, processing_stage_status: 'ready_to_annotate' },
 *   { id: 3, processing_stage_status: 'annotated' }
 * ];
 *
 * // Filter for annotated sequences only
 * const annotated = filterSequencesByProcessingStage(sequences, 'annotated');
 * // Returns: [{ id: 1, ... }, { id: 3, ... }]
 *
 * // No filter returns all sequences
 * const all = filterSequencesByProcessingStage(sequences);
 * // Returns: all original sequences
 * ```
 */
export function filterSequencesByProcessingStage(
  sequences: SequenceWithProcessingStage[],
  processingStageFilter?: ProcessingStageStatus
): SequenceWithProcessingStage[] {
  if (!processingStageFilter) {
    return sequences;
  }

  return sequences.filter(sequence => sequence.processing_stage_status === processingStageFilter);
}

/**
 * Gets a human-readable display label for processing stage status.
 *
 * Converts processing stage status identifiers into user-friendly labels
 * suitable for display in the interface. Provides consistent labeling
 * across all components that show processing stage information.
 *
 * @param {ProcessingStageStatus | ProcessingStage} status - The status to get a label for
 * @returns {string} Human-readable label for the processing stage
 *
 * @example
 * ```typescript
 * const label1 = getProcessingStageLabel('ready_to_annotate');
 * // Returns: 'Ready to annotate'
 *
 * const label2 = getProcessingStageLabel('no_annotation');
 * // Returns: 'No annotation'
 *
 * const label3 = getProcessingStageLabel('annotated');
 * // Returns: 'Annotated'
 * ```
 */
export function getProcessingStageLabel(status: ProcessingStageStatus | ProcessingStage): string {
  const labels: Record<ProcessingStageStatus, string> = {
    no_annotation: 'No annotation',
    imported: 'Imported',
    ready_to_annotate: 'Ready to annotate',
    under_annotation: 'Under annotation',
    seq_annotation_done: 'Seq annotation done',
    in_review: 'In review',
    needs_manual: 'Needs manual',
    annotated: 'Annotated',
  };

  return labels[status as ProcessingStageStatus] || labels['no_annotation'];
}

/**
 * Gets the appropriate CSS color classes for processing stage status badges.
 *
 * Provides consistent color coding for processing stage badges using
 * Tailwind CSS classes. Each stage has distinct colors to help users
 * quickly identify the status of sequences in the interface.
 *
 * @param {ProcessingStageStatus | ProcessingStage} status - The status to get colors for
 * @returns {string} Space-separated CSS classes for background and text colors
 *
 * @example
 * ```typescript
 * const colors1 = getProcessingStageColorClass('annotated');
 * // Returns: 'bg-green-100 text-green-800'
 *
 * const colors2 = getProcessingStageColorClass('ready_to_annotate');
 * // Returns: 'bg-yellow-100 text-yellow-800'
 *
 * const colors3 = getProcessingStageColorClass('no_annotation');
 * // Returns: 'bg-gray-100 text-gray-800'
 * ```
 */
export function getProcessingStageColorClass(
  status: ProcessingStageStatus | ProcessingStage
): string {
  const colorClasses: Record<ProcessingStageStatus, string> = {
    no_annotation: 'bg-gray-100 text-gray-800',
    imported: 'bg-blue-100 text-blue-800',
    ready_to_annotate: 'bg-yellow-100 text-yellow-800',
    under_annotation: 'bg-yellow-200 text-yellow-900',
    seq_annotation_done: 'bg-blue-100 text-blue-800',
    in_review: 'bg-gray-100 text-gray-800',
    needs_manual: 'bg-red-100 text-red-800',
    annotated: 'bg-green-100 text-green-800',
  };

  return colorClasses[status as ProcessingStageStatus] || colorClasses['no_annotation'];
}
