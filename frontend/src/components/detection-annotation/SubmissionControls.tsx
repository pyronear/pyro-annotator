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
  selectedSmokeType: SmokeType;
  onSubmit: () => void;
  onSmokeTypeChange: (type: SmokeType) => void;
  canNavigateNext: boolean;
  onNavigateNext: () => void;
}

export function SubmissionControls({
  drawnRectangles,
  isSubmitting,
  isAnnotated,
  onSubmit,
  canNavigateNext
}: SubmissionControlsProps) {
  const validation = validateAnnotationData(drawnRectangles, 0);
  const hasRectangles = drawnRectangles.length > 0;
  
  // Calculate annotation statistics
  const smokeTypeStats = drawnRectangles.reduce((stats, rect) => {
    stats[rect.smokeType] = (stats[rect.smokeType] || 0) + 1;
    return stats;
  }, {} as Record<SmokeType, number>);

  return (
    <div className="bg-white border-t border-gray-200 px-6 py-4">
      {/* Annotation Summary */}
      {hasRectangles && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <h3 className="text-sm font-medium text-gray-900 mb-2">
            Annotation Summary
          </h3>
          
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <span className="text-gray-600">
                Wildfire: {smokeTypeStats.wildfire || 0}
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
              <span className="text-gray-600">
                Industrial: {smokeTypeStats.industrial || 0}
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span className="text-gray-600">
                Other: {smokeTypeStats.other || 0}
              </span>
            </div>
          </div>
          
          <div className="mt-2 pt-2 border-t border-gray-200">
            <span className="text-sm text-gray-600">
              Total: {drawnRectangles.length} annotation{drawnRectangles.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Validation Messages */}
      {!validation.isValid && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-medium text-red-800">Validation Error</h4>
              <p className="text-sm text-red-700 mt-1">{validation.message}</p>
            </div>
          </div>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-medium text-yellow-800">Warnings</h4>
              <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                {validation.warnings.map((warning, index) => (
                  <li key={index}>• {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* No Annotations Message */}
      {!hasRectangles && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start space-x-2">
            <CheckCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-medium text-blue-800">No Smoke Detected</h4>
              <p className="text-sm text-blue-700 mt-1">
                If you don't see any smoke in this detection, you can submit without annotations 
                to mark it as a false positive.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {/* Current Status */}
          {isAnnotated ? (
            <div className="flex items-center space-x-2 text-green-600">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Already annotated</span>
            </div>
          ) : (
            <span className="text-sm text-gray-500">
              Ready to submit annotation
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {/* Submit Button */}
          <button
            onClick={onSubmit}
            disabled={isSubmitting || !validation.isValid}
            className={`
              flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors
              ${validation.isValid && !isSubmitting
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
            `}
            title="Submit annotation (Space)"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Submitting...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>{isAnnotated ? 'Update' : 'Submit'}</span>
              </>
            )}
          </button>

          {/* Submit and Next Button */}
          {canNavigateNext && validation.isValid && (
            <button
              onClick={() => {
                onSubmit();
                // Navigate next will be handled after successful submission
              }}
              disabled={isSubmitting}
              className={`
                flex items-center space-x-2 px-4 py-2 rounded-lg font-medium border transition-colors
                ${!isSubmitting
                  ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                  : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                }
              `}
              title="Submit and go to next detection"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Submit & Next</span>
            </button>
          )}
        </div>
      </div>

      {/* Keyboard shortcut hint */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 text-center">
          Press <kbd className="px-1 py-0.5 text-xs bg-gray-200 rounded">Space</kbd> to submit annotation
          {canNavigateNext && (
            <> • <kbd className="px-1 py-0.5 text-xs bg-gray-200 rounded">→</kbd> for next detection</>
          )}
        </p>
      </div>
    </div>
  );
}