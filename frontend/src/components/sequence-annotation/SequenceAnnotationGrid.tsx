/**
 * Sequence annotation grid component.
 * Contains the main bbox annotation cards with classification controls.
 * Card bodies are delegated to ObjectCard; this component adapts the
 * index-based bboxes/primaryClassification props AnnotationInterface passes
 * down into the cardKey-based callbacks ObjectCard expects.
 */

import React from 'react';
import { SequenceBbox, SequenceAnnotation } from '@/types/api';
import {
  getClassificationType,
  shouldShowAsAnnotated,
  isAnnotationDataValid,
} from '@/utils/annotation/sequenceUtils';
import { ObjectCard } from './ObjectCard';

interface SequenceAnnotationGridProps {
  bboxes: SequenceBbox[];
  annotation: SequenceAnnotation | null;
  sequenceId: number;
  activeDetectionIndex: number;
  primaryClassification: Record<number, 'unselected' | 'smoke' | 'false_positive'>;
  detectionRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;

  onDetectionClick: (index: number) => void;
  onBboxChange: (index: number, updatedBbox: SequenceBbox) => void;
  onPrimaryClassificationChange: (
    updates: Record<number, 'unselected' | 'smoke' | 'false_positive'>
  ) => void;
}

export const SequenceAnnotationGrid: React.FC<SequenceAnnotationGridProps> = ({
  bboxes,
  annotation,
  sequenceId,
  activeDetectionIndex,
  primaryClassification,
  detectionRefs,
  onDetectionClick,
  onBboxChange,
  onPrimaryClassificationChange,
}) => {
  const imagesReady = isAnnotationDataValid(annotation, sequenceId);

  return (
    <div className="space-y-8">
      {bboxes.map((bbox, index) => {
        const cardKey = String(index);
        const isActive = activeDetectionIndex === index;
        const isAnnotated = shouldShowAsAnnotated(bbox, annotation?.processing_stage || '');
        const classification = getClassificationType(bbox, index, primaryClassification);

        return (
          <ObjectCard
            key={index}
            cardRef={el => (detectionRefs.current[index] = el)}
            objectNumber={index + 1}
            cardKey={cardKey}
            bbox={bbox}
            sequenceId={sequenceId}
            classification={classification}
            isActive={isActive}
            isAnnotated={isAnnotated}
            imagesReady={imagesReady}
            onCardClick={key => onDetectionClick(Number(key))}
            onBboxChange={(key, updatedBbox) => onBboxChange(Number(key), updatedBbox)}
            onClassificationChange={(key, cls) =>
              onPrimaryClassificationChange({
                ...primaryClassification,
                [Number(key)]: cls,
              })
            }
          />
        );
      })}
    </div>
  );
};
