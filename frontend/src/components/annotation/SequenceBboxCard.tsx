import { useState } from 'react';
import { CheckCircle, AlertCircle, Eye, MapPin } from 'lucide-react';
import { SequenceBbox, FalsePositiveType, GifBboxUrls } from '@/types/api';
import { FALSE_POSITIVE_TYPES } from '@/utils/constants';
import GifViewer from './GifViewer';

interface SequenceBboxCardProps {
  bbox: SequenceBbox;
  bboxIndex: number;
  gifData?: GifBboxUrls;
  onChange: (updatedBbox: SequenceBbox) => void;
  className?: string;
}

export default function SequenceBboxCard({ 
  bbox, 
  bboxIndex, 
  gifData, 
  onChange, 
  className = '' 
}: SequenceBboxCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleSmokeToggle = (isSmoke: boolean) => {
    const updatedBbox = {
      ...bbox,
      is_smoke: isSmoke,
      // Clear false positives if marking as smoke
      false_positive_types: isSmoke ? [] : bbox.false_positive_types
    };
    onChange(updatedBbox);
  };

  const handleFalsePositiveToggle = (fpType: FalsePositiveType, isSelected: boolean) => {
    let updatedFalsePositives: FalsePositiveType[];
    
    if (isSelected) {
      // Add false positive type
      updatedFalsePositives = [...bbox.false_positive_types, fpType];
    } else {
      // Remove false positive type
      updatedFalsePositives = bbox.false_positive_types.filter(type => type !== fpType);
    }

    const updatedBbox = {
      ...bbox,
      false_positive_types: updatedFalsePositives,
      // Clear smoke if selecting false positives
      is_smoke: updatedFalsePositives.length > 0 ? false : bbox.is_smoke
    };
    onChange(updatedBbox);
  };

  const isAnnotated = bbox.is_smoke || bbox.false_positive_types.length > 0;

  return (
    <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
      {/* Card Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              isAnnotated 
                ? 'bg-green-100 text-green-600' 
                : 'bg-gray-100 text-gray-400'
            }`}>
              {isAnnotated ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Bbox #{bboxIndex + 1}
              </h3>
              <p className="text-sm text-gray-500">
                {bbox.bboxes.length} detection{bbox.bboxes.length !== 1 ? 's' : ''}
                {isAnnotated && (
                  <span className="ml-2 text-green-600 font-medium">
                    ✓ Annotated
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 rounded-md hover:bg-gray-100"
          >
            <Eye className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Annotation Controls */}
      <div className="p-4 space-y-4">
        {/* Smoke Classification */}
        <div>
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={bbox.is_smoke}
              onChange={(e) => handleSmokeToggle(e.target.checked)}
              className="w-4 h-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
            />
            <span className="text-sm font-medium text-gray-900">
              🔥 Contains Smoke/Fire
            </span>
          </label>
        </div>

        {/* False Positive Types */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            False Positive Types
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {FALSE_POSITIVE_TYPES.map((fpType) => (
              <label key={fpType} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={bbox.false_positive_types.includes(fpType)}
                  onChange={(e) => handleFalsePositiveToggle(fpType, e.target.checked)}
                  disabled={bbox.is_smoke} // Disable if marked as smoke
                  className="w-3 h-3 text-red-600 focus:ring-red-500 border-gray-300 rounded disabled:opacity-50"
                />
                <span className="text-xs text-gray-600 capitalize">
                  {fpType.replace('_', ' ')}
                </span>
              </label>
            ))}
          </div>
          {bbox.is_smoke && (
            <p className="text-xs text-gray-500 mt-1">
              False positive types are disabled when smoke is detected
            </p>
          )}
        </div>

        {/* Detection Bboxes Summary */}
        <div className="bg-gray-50 rounded-md p-3">
          <div className="flex items-center space-x-2 mb-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">
              Detection Coordinates
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {bbox.bboxes.slice(0, 4).map((detection) => (
              <div key={detection.detection_id} className="text-xs text-gray-600">
                <span className="font-medium">Det #{detection.detection_id}:</span>{' '}
                [{detection.xyxyn.map(coord => coord.toFixed(3)).join(', ')}]
              </div>
            ))}
            {bbox.bboxes.length > 4 && (
              <div className="text-xs text-gray-500 col-span-2">
                ... and {bbox.bboxes.length - 4} more detections
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded GIF View */}
      {isExpanded && gifData && (
        <div className="border-t border-gray-200 p-4">
          <GifViewer 
            gifData={gifData} 
            bboxIndex={bboxIndex}
          />
        </div>
      )}

      {/* Error State */}
      {isExpanded && !gifData && (
        <div className="border-t border-gray-200 p-4">
          <div className="text-center py-8">
            <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              GIF data not available for this bbox
            </p>
          </div>
        </div>
      )}
    </div>
  );
}