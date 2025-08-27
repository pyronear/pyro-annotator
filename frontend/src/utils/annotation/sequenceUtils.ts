/**
 * Pure utility functions for sequence annotation logic.
 * These functions handle annotation state transformations and business rules.
 */

import { SequenceAnnotation, SequenceBbox, FalsePositiveType, SmokeType } from '@/types/api';

/**
 * Determines the classification type for a bbox based on user choice and existing data.
 */
export const getClassificationType = (
  bbox: SequenceBbox,
  index: number,
  primaryClassification: Record<number, 'unselected' | 'smoke' | 'false_positive'>
): 'unselected' | 'smoke' | 'false_positive' => {
  const userChoice = primaryClassification[index] || 'unselected';

  // If user explicitly chose smoke and bbox data matches
  if (userChoice === 'smoke' && bbox.is_smoke) {
    return 'smoke';
  }

  // If user explicitly chose false positive (regardless of bbox data completeness)
  if (userChoice === 'false_positive') {
    return 'false_positive';
  }

  // If no explicit choice made, derive from existing data for backwards compatibility
  if (userChoice === 'unselected') {
    if (bbox.is_smoke) {
      return 'smoke';
    } else if (bbox.false_positive_types.length > 0) {
      return 'false_positive';
    }
  }

  return 'unselected';
};

/**
 * Checks if a bbox has user annotations.
 */
export const hasUserAnnotations = (bbox: SequenceBbox): boolean => {
  if (bbox.is_smoke) {
    // If smoke is selected, smoke_type must also be selected
    return bbox.smoke_type !== undefined;
  } else if (bbox.false_positive_types.length > 0) {
    // If false positive is selected (has false positive types), it's annotated
    return true;
  } else {
    // If neither smoke nor false positive types are selected, it's unselected
    return false;
  }
};

/**
 * Initializes a clean bbox with default values.
 */
export const initializeCleanBbox = (originalBbox: SequenceBbox): SequenceBbox => {
  return {
    ...originalBbox,
    is_smoke: false,
    smoke_type: undefined,
    false_positive_types: [],
    // Preserve structure with bboxes containing detection_ids
  };
};

/**
 * Determines if a bbox should show as annotated based on processing stage.
 */
export const shouldShowAsAnnotated = (bbox: SequenceBbox, processingStage: string): boolean => {
  // If already marked as annotated in processing stage, show as annotated
  if (processingStage === 'annotated') {
    return true;
  }
  // If ready to annotate, only show as annotated if user has made selections
  if (processingStage === 'ready_to_annotate') {
    return hasUserAnnotations(bbox);
  }
  // For other stages, default to checking user annotations
  return hasUserAnnotations(bbox);
};

/**
 * Validates that annotation data matches current sequence.
 */
export const isAnnotationDataValid = (
  annotation: SequenceAnnotation | null,
  currentSequenceId: number | null
): boolean => {
  if (!annotation || !currentSequenceId) return false;
  return annotation.sequence_id === currentSequenceId;
};

/**
 * Determines initial missed smoke review state based on processing stage.
 */
export const getInitialMissedSmokeReview = (
  annotation: SequenceAnnotation
): 'yes' | 'no' | null => {
  if (annotation.processing_stage === 'annotated') {
    // For annotated sequences, the has_missed_smoke boolean reflects the actual review result
    return annotation.has_missed_smoke ? 'yes' : 'no';
  } else {
    // For other stages (like ready_to_annotate), null means not reviewed yet
    return annotation.has_missed_smoke ? 'yes' : null;
  }
};

/**
 * Creates updated annotation payload for API submission.
 */
export const createAnnotationPayload = (
  updatedBboxes: SequenceBbox[],
  isUnsure: boolean,
  hasMissedSmoke: boolean
): Partial<SequenceAnnotation> => {
  return {
    annotation: {
      sequences_bbox: updatedBboxes, // Always preserve the actual bbox data
    },
    processing_stage: 'annotated', // Move to annotated stage
    // Update derived fields - all false for unsure sequences
    has_smoke: isUnsure ? false : updatedBboxes.some(bbox => bbox.is_smoke),
    has_false_positives: isUnsure
      ? false
      : updatedBboxes.some(bbox => bbox.false_positive_types.length > 0),
    false_positive_types: isUnsure
      ? '[]'
      : JSON.stringify([...new Set(updatedBboxes.flatMap(bbox => bbox.false_positive_types))]),
    // Include missed smoke flag - false for unsure sequences
    has_missed_smoke: isUnsure ? false : hasMissedSmoke,
    // Include unsure flag
    is_unsure: isUnsure,
  };
};

/**
 * Updates a bbox with new smoke type selection.
 */
export const updateBboxSmokeType = (bbox: SequenceBbox, smokeType: SmokeType): SequenceBbox => {
  return {
    ...bbox,
    is_smoke: true,
    smoke_type: smokeType,
    false_positive_types: [], // Clear false positives when selecting smoke
  };
};

/**
 * Updates a bbox with false positive type selection.
 */
export const updateBboxFalsePositiveType = (
  bbox: SequenceBbox,
  fpType: FalsePositiveType,
  isSelected: boolean
): SequenceBbox => {
  const updatedBbox = {
    ...bbox,
    is_smoke: false, // Clear smoke when selecting false positive
    smoke_type: undefined, // Clear smoke type
  };

  if (isSelected) {
    // Add the false positive type
    updatedBbox.false_positive_types = [...bbox.false_positive_types, fpType];
  } else {
    // Remove the false positive type
    updatedBbox.false_positive_types = bbox.false_positive_types.filter(type => type !== fpType);
  }

  return updatedBbox;
};

/**
 * Clears all selections from a bbox.
 */
export const clearBboxSelections = (bbox: SequenceBbox): SequenceBbox => {
  return {
    ...bbox,
    is_smoke: false,
    smoke_type: undefined,
    false_positive_types: [],
  };
};

/**
 * Gets keyboard shortcut key for false positive type.
 */
export const getKeyForFalsePositiveType = (type: string): string => {
  const keyMap: Record<string, string> = {
    antenna: 'A',
    building: 'B',
    cliff: 'C',
    dark: 'D',
    dust: 'U',
    high_cloud: 'H',
    low_cloud: 'L',
    lens_flare: 'G',
    lens_droplet: 'P',
    light: 'I',
    rain: 'R',
    trail: 'T',
    road: 'O',
    sky: 'K',
    tree: 'E',
    water_body: 'W',
    other: 'X',
  };
  return keyMap[type] || '';
};

/**
 * Formats false positive type label for display.
 */
export const formatFalsePositiveLabel = (type: string): string => {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
