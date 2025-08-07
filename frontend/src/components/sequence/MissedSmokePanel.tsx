import { AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface MissedSmokePanelProps {
  hasMissedSmoke: boolean;
  onMissedSmokeChange: (hasMissedSmoke: boolean) => void;
  isReviewComplete: boolean;
  onMarkReviewComplete: () => void;
  className?: string;
}

export default function MissedSmokePanel({
  hasMissedSmoke,
  onMissedSmokeChange,
  isReviewComplete,
  onMarkReviewComplete,
  className = ''
}: MissedSmokePanelProps) {
  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          <AlertTriangle className="w-6 h-6 text-orange-500" />
        </div>
        
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-900 mb-2">
            Missed Smoke Detection Review
          </h3>
          
          <p className="text-sm text-gray-600 mb-4">
            Review the sequence chronologically to identify any smoke or fire that the model may have missed.
            Look for areas with visible smoke, fire, or suspicious activity that weren't highlighted by the red bounding boxes.
          </p>

          <div className="space-y-3">
            {/* Review Status */}
            <div className="flex items-center space-x-2">
              {isReviewComplete ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-green-700">Sequence review completed</span>
                </>
              ) : (
                <>
                  <Info className="w-4 h-4 text-blue-500" />
                  <span className="text-sm text-gray-600">Please review the entire sequence</span>
                  <button
                    onClick={onMarkReviewComplete}
                    className="ml-auto text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Mark as reviewed
                  </button>
                </>
              )}
            </div>

            {/* Missed Smoke Checkbox */}
            <div className="border-t border-gray-200 pt-3">
              <label className="flex items-start space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasMissedSmoke}
                  onChange={(e) => onMissedSmokeChange(e.target.checked)}
                  className="mt-1 w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    The sequence contains missed smoke detections
                  </span>
                  <p className="text-xs text-gray-500 mt-1">
                    Check this if you spotted smoke, fire, or suspicious activity that wasn't detected by the model
                  </p>
                </div>
              </label>
            </div>

            {/* Additional Context when Missed Smoke is Checked */}
            {hasMissedSmoke && (
              <div className="bg-orange-50 border border-orange-200 rounded-md p-3 mt-3">
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-800">
                      Missed smoke detection identified
                    </p>
                    <p className="text-xs text-orange-700 mt-1">
                      This information will help improve the model's detection capabilities. 
                      The detection will be flagged for further review by the training team.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex items-start space-x-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-800 mb-1">
                  Review Instructions
                </p>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li>• Use play controls to review the entire sequence</li>
                  <li>• Red boxes show what the model detected</li>
                  <li>• Look for smoke/fire outside the red boxes</li>
                  <li>• Pay attention to edges of the frame and partially visible smoke</li>
                  <li>• Consider atmospheric conditions that might obscure detection</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}