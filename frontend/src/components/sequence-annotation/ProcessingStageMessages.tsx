/**
 * Processing stage messages component.
 * Shows informational messages based on the annotation's processing stage.
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { SequenceAnnotation } from '@/types/api';

interface ProcessingStageMessagesProps {
  annotation: SequenceAnnotation;
}

export const ProcessingStageMessages: React.FC<ProcessingStageMessagesProps> = ({ annotation }) => {
  if (
    annotation.processing_stage === 'ready_to_annotate' ||
    annotation.processing_stage === 'annotated'
  ) {
    return null;
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
      <div className="flex">
        <AlertCircle className="w-5 h-5 text-yellow-400" />
        <div className="ml-3">
          <p className="text-sm font-medium text-yellow-800">Processing Stage Notice</p>
          <p className="text-sm text-yellow-700 mt-1">
            This annotation is currently in "{annotation.processing_stage}" stage. Typically
            annotations should be in "ready_to_annotate" stage before editing.
          </p>
        </div>
      </div>
    </div>
  );
};
