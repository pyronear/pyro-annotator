/**
 * Submission controls for detection annotation.
 * Handles annotation submission with validation and feedback.
 */

import { CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { SmokeType } from '@/types/api';
import { DrawnRectangle, validateAnnotationData } from '@/utils/annotation';

interface SubmissionControlsProps {
  drawnRectangles: DrawnRectangle[];
  isSubmitting: boolean;
  isAnnotated: boolean;
  onSubmit: () => void;
  canNavigateNext: boolean;
  onNavigateNext: () => void;
}

export function SubmissionControls({
  drawnRectangles,
  isSubmitting,
  isAnnotated,
  onSubmit,
  canNavigateNext,
  onNavigateNext
}: SubmissionControlsProps) {
  const validation = validateAnnotationData(drawnRectangles, 0);
  const hasRectangles = drawnRectangles.length > 0;
  
  // Calculate annotation statistics
  const smokeTypeStats = drawnRectangles.reduce((stats, rect) => {
    stats[rect.smokeType] = (stats[rect.smokeType] || 0) + 1;
    return stats;
  }, {} as Record<SmokeType, number>);

  return (
    <div className="flex justify-center mt-4">
      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {isSubmitting ? (
          <>
            <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            {isAnnotated ? 'Updating...' : 'Submitting...'}
          </>
        ) : (
          <>
            {isAnnotated ? 'Update' : 'Submit'}
            <span className="ml-2 text-xs text-primary-200">(Space)</span>
          </>
        )}
      </button>
    </div>
  );
}