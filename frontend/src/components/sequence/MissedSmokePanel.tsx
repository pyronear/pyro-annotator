import { useState } from 'react';
import { Info } from 'lucide-react';
import MissedSmokeInstructionsModal from './MissedSmokeInstructionsModal';

interface MissedSmokePanelProps {
  missedSmokeReview: 'yes' | 'no' | null;
  onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
  className?: string;
}

export default function MissedSmokePanel({
  missedSmokeReview,
  onMissedSmokeReviewChange,
  className = ''
}: MissedSmokePanelProps) {
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);

  return (
    <>
      <div className={`bg-white border border-gray-200 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900">
            Missed Smoke Review
          </h3>
          <button
            onClick={() => setShowInstructionsModal(true)}
            className="p-1 hover:bg-gray-100 rounded"
            title="Show review instructions"
          >
            <Info className="w-4 h-4 text-gray-400 hover:text-gray-600" />
          </button>
        </div>
        
        <p className="text-sm text-gray-600 mb-4">
          Does this sequence contain any missed smoke detections?
        </p>
        
        <div className="space-y-3">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="missedSmokeReview"
              value="yes"
              checked={missedSmokeReview === 'yes'}
              onChange={() => onMissedSmokeReviewChange('yes')}
              className="w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300"
            />
            <span className="text-sm text-gray-900">
              Yes, there is missed smoke in this sequence
            </span>
          </label>
          
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="missedSmokeReview"
              value="no"
              checked={missedSmokeReview === 'no'}
              onChange={() => onMissedSmokeReviewChange('no')}
              className="w-4 h-4 text-green-600 focus:ring-green-500 border-gray-300"
            />
            <span className="text-sm text-gray-900">
              No, there is no missed smoke in this sequence
            </span>
          </label>
        </div>

        {/* Show status when selection is made */}
        {missedSmokeReview && (
          <div className={`mt-4 p-3 rounded-md border ${
            missedSmokeReview === 'yes' 
              ? 'bg-orange-50 border-orange-200' 
              : 'bg-green-50 border-green-200'
          }`}>
            <p className={`text-sm font-medium ${
              missedSmokeReview === 'yes' ? 'text-orange-800' : 'text-green-800'
            }`}>
              {missedSmokeReview === 'yes' 
                ? 'Missed smoke detection identified' 
                : 'No missed smoke detected'
              }
            </p>
            <p className={`text-xs mt-1 ${
              missedSmokeReview === 'yes' ? 'text-orange-700' : 'text-green-700'
            }`}>
              {missedSmokeReview === 'yes'
                ? 'This information will help improve the model\'s detection capabilities.'
                : 'The model appears to have detected all visible smoke and fire.'
              }
            </p>
          </div>
        )}
      </div>

      <MissedSmokeInstructionsModal
        isOpen={showInstructionsModal}
        onClose={() => setShowInstructionsModal(false)}
      />
    </>
  );
}