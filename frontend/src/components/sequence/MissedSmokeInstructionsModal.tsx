import { useEffect } from 'react';
import { X, Info } from 'lucide-react';

interface MissedSmokeInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MissedSmokeInstructionsModal({
  isOpen,
  onClose,
}: MissedSmokeInstructionsModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Missed Smoke Review Instructions</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-md">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="space-y-6">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900 mb-3">
                  Review the sequence chronologically to identify any smoke or fire that the model
                  may have missed.
                </p>
                <p className="text-sm text-gray-600 mb-4">
                  Look for areas with visible smoke, fire, or suspicious activity that weren't
                  highlighted by the red bounding boxes.
                </p>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="text-sm font-medium text-blue-800 mb-3">Review Guidelines</h3>
              <ul className="text-sm text-blue-700 space-y-2">
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Use play controls to review the entire sequence chronologically</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>Red bounding boxes show what the model detected automatically</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>
                    Look for smoke or fire outside the red boxes that may have been missed
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>
                    Pay special attention to edges of the frame and partially visible smoke
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>
                    Consider atmospheric conditions that might obscure automatic detection
                  </span>
                </li>
              </ul>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
              <h3 className="text-sm font-medium text-orange-800 mb-3">What to Look For</h3>
              <ul className="text-sm text-orange-700 space-y-2">
                <li className="flex items-start space-x-2">
                  <span className="text-orange-500 mt-0.5">•</span>
                  <span>Visible smoke plumes not enclosed by red boxes</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-orange-500 mt-0.5">•</span>
                  <span>Fire or flames that appear undetected</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-orange-500 mt-0.5">•</span>
                  <span>Suspicious heat signatures or glowing areas</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-orange-500 mt-0.5">•</span>
                  <span>Smoke that may be partially obscured by terrain or weather</span>
                </li>
              </ul>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
              <h3 className="text-sm font-medium text-gray-800 mb-2">Selection Guide</h3>
              <div className="space-y-2 text-sm text-gray-700">
                <p>
                  <strong>Select "Yes"</strong> if you spot any smoke, fire, or suspicious activity
                  that wasn't detected by the model.
                </p>
                <p>
                  <strong>Select "No"</strong> if the model appears to have detected all visible
                  smoke and fire in the sequence.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
