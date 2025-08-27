import {
  Sequence,
  SequenceAnnotation,
  SequenceWithProcessingStage,
  ProcessingStageStatus,
  ProcessingStage,
} from '@/types/api';

/**
 * Determines the processing stage status for a sequence based on its annotation
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
 * Combines sequences with their annotation data to include processing stage information
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
 * Filters sequences by processing stage status
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
 * Gets a display-friendly label for processing stage status
 */
export function getProcessingStageLabel(status: ProcessingStageStatus | ProcessingStage): string {
  const labels: Record<ProcessingStageStatus, string> = {
    no_annotation: 'No annotation',
    imported: 'Imported',
    ready_to_annotate: 'Ready to annotate',
    annotated: 'Annotated',
  };

  return labels[status as ProcessingStageStatus] || labels['no_annotation'];
}

/**
 * Gets the color class for processing stage status badges
 */
export function getProcessingStageColorClass(
  status: ProcessingStageStatus | ProcessingStage
): string {
  const colorClasses: Record<ProcessingStageStatus, string> = {
    no_annotation: 'bg-gray-100 text-gray-800',
    imported: 'bg-blue-100 text-blue-800',
    ready_to_annotate: 'bg-yellow-100 text-yellow-800',
    annotated: 'bg-green-100 text-green-800',
  };

  return colorClasses[status as ProcessingStageStatus] || colorClasses['no_annotation'];
}
