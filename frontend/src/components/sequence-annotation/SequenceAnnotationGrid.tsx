/**
 * Sequence annotation grid component.
 * Contains the main bbox annotation cards with classification controls.
 */

import React from 'react';
import { Keyboard, CheckCircle, AlertCircle } from 'lucide-react';
import { SequenceBbox, SequenceAnnotation, FalsePositiveType, SmokeType } from '@/types/api';
import { FALSE_POSITIVE_TYPES, SMOKE_TYPES } from '@/utils/constants';
import { getClassificationType, shouldShowAsAnnotated, isAnnotationDataValid } from '@/utils/annotation/sequenceUtils';
import { getSmokeTypeEmoji, formatSmokeType } from '@/utils/modelAccuracy';
import FullImageSequence from '@/components/annotation/FullImageSequence';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';

interface SequenceAnnotationGridProps {
  bboxes: SequenceBbox[];
  annotation: SequenceAnnotation | null;
  sequenceId: number;
  activeDetectionIndex: number;
  primaryClassification: Record<number, 'unselected' | 'smoke' | 'false_positive'>;
  detectionRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  
  onDetectionClick: (index: number) => void;
  onBboxChange: (index: number, updatedBbox: SequenceBbox) => void;
  onPrimaryClassificationChange: (updates: Record<number, 'unselected' | 'smoke' | 'false_positive'>) => void;
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
  onPrimaryClassificationChange
}) => {
  const formatLabel = (type: string) => 
    type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  
  // Get the keyboard shortcut for false positive type
  const getKeyForType = (type: string) => {
    const keyMap: Record<string, string> = {
      'antenna': 'A',
      'building': 'B', 
      'cliff': 'C',
      'dark': 'D',
      'dust': 'U',
      'high_cloud': 'H',
      'low_cloud': 'L',
      'lens_flare': 'G',
      'lens_droplet': 'P',
      'light': 'I',
      'rain': 'R',
      'trail': 'T',
      'road': 'O',
      'sky': 'K',
      'tree': 'E',
      'water_body': 'W',
      'other': 'X',
    };
    return keyMap[type];
  };

  return (
    <div className="space-y-8">
      {bboxes.map((bbox, index) => {
        const isActive = activeDetectionIndex === index;
        const isAnnotated = shouldShowAsAnnotated(bbox, annotation?.processing_stage || '');
        
        return (
          <div 
            key={index} 
            ref={(el) => detectionRefs.current[index] = el}
            className={`relative rounded-lg cursor-pointer transition-all duration-200 ${
              isActive 
                ? 'border-4 border-blue-500 ring-2 ring-blue-200 bg-blue-50' 
                : isAnnotated
                ? 'border-4 border-green-500 bg-green-50 hover:border-green-600 hover:bg-green-100'
                : 'border-4 border-orange-400 bg-orange-50 hover:border-orange-500 hover:bg-orange-100 animate-pulse-subtle'
            } p-6`}
            onClick={() => onDetectionClick(index)}
          >
            {/* Status Badge Overlay */}
            <div className={`absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-semibold backdrop-blur-sm ${
              isAnnotated 
                ? 'bg-green-600/90 text-white' 
                : 'bg-orange-500/90 text-white'
            }`}>
              {isAnnotated ? 'Reviewed' : 'Pending'}
            </div>

            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <h4 className="text-lg font-medium text-gray-900">
                  Detection {index + 1}
                </h4>
                {isActive && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    <Keyboard className="w-3 h-3 mr-1" />
                    Active
                  </span>
                )}
              </div>
              <span className="text-sm text-gray-500">
                {bbox.bboxes.length} bbox{bbox.bboxes.length !== 1 ? 'es' : ''}
              </span>
            </div>
            
            {/* Visual Content - Image Sequences */}
            <div className="space-y-6 mb-8">
              {/* Image Sequences - Only render when annotation data matches current sequence */}
              {bbox.bboxes && bbox.bboxes.length > 0 && isAnnotationDataValid(annotation, sequenceId) ? (
                <>
                  {/* Full Image Sequence */}
                  <div className="text-center">
                    <h5 className="text-sm font-medium text-gray-700 mb-3">Full Sequence</h5>
                    <FullImageSequence bboxes={bbox.bboxes} sequenceId={sequenceId} />
                  </div>
                  
                  {/* Cropped Image Sequence */}
                  <div className="text-center mt-6">
                    <h5 className="text-sm font-medium text-gray-700 mb-3">Cropped View</h5>
                    <CroppedImageSequence bboxes={bbox.bboxes} sequenceId={sequenceId} />
                  </div>
                </>
              ) : (
                /* Loading state when annotation data is being fetched */
                <div className="text-center py-8">
                  <div className="flex items-center justify-center space-x-2 text-gray-500">
                    <div className="animate-spin w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full"></div>
                    <span>Loading sequence images...</span>
                  </div>
                </div>
              )}
            </div>
          
            {/* Annotation Controls */}
            <div className="space-y-4">
              {/* Step 1: Primary Classification */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Sequence Classification
                </label>
                <div className="space-y-2">
                  {(() => {
                    // Use the new classification helper
                    const classificationType = getClassificationType(bbox, index, primaryClassification);
                    
                    return (
                      <>
                        {/* Smoke Sequence Option */}
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <input
                            type="radio"
                            name={`classification-${index}`}
                            checked={classificationType === 'smoke'}
                            onChange={() => {
                              // Update UI state
                              onPrimaryClassificationChange({
                                ...primaryClassification,
                                [index]: 'smoke'
                              });
                              
                              // Update backend data
                              const updatedBbox = { ...bbox };
                              updatedBbox.is_smoke = true;
                              // Keep existing smoke_type if available, otherwise set to undefined for user to select
                              updatedBbox.false_positive_types = []; // Clear false positive types
                              onBboxChange(index, updatedBbox);
                            }}
                            className="w-4 h-4 text-green-600 focus:ring-green-500 border-gray-300"
                          />
                          <span className="text-sm text-gray-900">🔥 This is smoke</span>
                          {isActive && (
                            <kbd className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">S</kbd>
                          )}
                        </label>

                        {/* False Positive Option */}
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <input
                            type="radio"
                            name={`classification-${index}`}
                            checked={classificationType === 'false_positive'}
                            onChange={() => {
                              // Update UI state
                              onPrimaryClassificationChange({
                                ...primaryClassification,
                                [index]: 'false_positive'
                              });
                              
                              // Update backend data
                              const updatedBbox = { ...bbox };
                              updatedBbox.is_smoke = false;
                              updatedBbox.smoke_type = undefined; // Clear smoke type
                              // Keep existing false_positive_types for user to modify
                              onBboxChange(index, updatedBbox);
                            }}
                            className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300"
                          />
                          <span className="text-sm text-gray-900">❌ This is a false positive</span>
                          {isActive && (
                            <kbd className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">F</kbd>
                          )}
                        </label>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Step 2: Smoke Type Selection (shown when smoke is selected) */}
              {getClassificationType(bbox, index, primaryClassification) === 'smoke' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    Smoke Type
                  </label>
                  <div className="space-y-2">
                    {SMOKE_TYPES.map((smokeType) => (
                      <label key={smokeType} className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="radio"
                          name={`smoke-type-${index}`}
                          checked={bbox.smoke_type === smokeType}
                          onChange={() => {
                            const updatedBbox = { ...bbox };
                            updatedBbox.smoke_type = smokeType as SmokeType;
                            onBboxChange(index, updatedBbox);
                          }}
                          className="w-4 h-4 text-green-600 focus:ring-green-500 border-gray-300"
                        />
                        <span className="text-sm text-gray-900">
                          {getSmokeTypeEmoji(smokeType)} {formatSmokeType(smokeType)}
                        </span>
                        {isActive && smokeType === 'wildfire' && (
                          <kbd className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">W</kbd>
                        )}
                        {isActive && smokeType === 'industrial' && (
                          <kbd className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">N</kbd>
                        )}
                        {isActive && smokeType === 'other' && (
                          <kbd className="px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">M</kbd>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: False Positive Types (shown when false positive is selected) */}
              {getClassificationType(bbox, index, primaryClassification) === 'false_positive' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    False Positive Types (Select all that apply)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
                    {FALSE_POSITIVE_TYPES.map((fpType) => {
                      const isSelected = bbox.false_positive_types.includes(fpType);
                      
                      return (
                        <label key={fpType} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const updatedBbox = { ...bbox };
                              if (e.target.checked) {
                                // Add the false positive type
                                updatedBbox.false_positive_types = [
                                  ...bbox.false_positive_types,
                                  fpType as FalsePositiveType
                                ];
                              } else {
                                // Remove the false positive type
                                updatedBbox.false_positive_types = bbox.false_positive_types.filter(
                                  type => type !== fpType
                                );
                              }
                              onBboxChange(index, updatedBbox);
                            }}
                            className="w-3 h-3 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                          />
                          <span className="text-xs text-gray-600">
                            {formatLabel(fpType)}
                          </span>
                          {isActive && getKeyForType(fpType) && (
                            <kbd className="ml-1 px-1 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-mono">
                              {getKeyForType(fpType)}
                            </kbd>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  
                  {/* Selected types display */}
                  {bbox.false_positive_types.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-gray-700 mb-2">Selected:</div>
                      <div className="flex flex-wrap gap-1">
                        {bbox.false_positive_types.map((type) => (
                          <span
                            key={type}
                            className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200"
                          >
                            {type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                            <button
                              onClick={() => {
                                const updatedBbox = { ...bbox };
                                updatedBbox.false_positive_types = bbox.false_positive_types.filter(
                                  t => t !== type
                                );
                                onBboxChange(index, updatedBbox);
                              }}
                              className="ml-1 hover:opacity-80 text-red-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Enhanced Status Bar */}
              <div className={`flex items-center justify-between p-3 rounded-lg ${
                isAnnotated ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'
              }`}>
                <div className="flex items-center space-x-2">
                  {isAnnotated ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                  )}
                  <span className={`text-sm font-medium ${
                    isAnnotated ? 'text-green-700' : 'text-orange-700'
                  }`}>
                    {isAnnotated ? 'Detection Reviewed' : 'Needs Review'}
                  </span>
                </div>
                
                {/* Current Selection Summary */}
                <div className="text-xs text-gray-600">
                  {bbox.is_smoke && bbox.smoke_type && (
                    <span className="text-green-700 font-medium">
                      {getSmokeTypeEmoji(bbox.smoke_type)} {formatSmokeType(bbox.smoke_type)}
                    </span>
                  )}
                  {bbox.is_smoke && !bbox.smoke_type && (
                    <span className="text-orange-600 font-medium">Smoke (type needed)</span>
                  )}
                  {!bbox.is_smoke && bbox.false_positive_types.length > 0 && (
                    <span className="text-red-700 font-medium">
                      False Positive ({bbox.false_positive_types.length})
                    </span>
                  )}
                  {!bbox.is_smoke && bbox.false_positive_types.length === 0 && (
                    <span className="text-gray-500">No classification</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};