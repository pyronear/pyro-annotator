import { SequenceWithAnnotation, ProcessingStageStatus } from '@/types/api';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getRowBackgroundClasses,
  parseFalsePositiveTypes,
  getSmokeTypeEmoji,
  formatSmokeType,
} from '@/utils/modelAccuracy';
import { getProcessingStageLabel, getProcessingStageColorClass } from '@/utils/processingStage';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import ContributorList from '@/components/ui/ContributorList';

interface SequenceTableRowProps {
  sequence: SequenceWithAnnotation;
  defaultProcessingStage: ProcessingStageStatus;
  onSequenceClick: (sequence: SequenceWithAnnotation) => void;
}

export function SequenceTableRow({
  sequence,
  defaultProcessingStage,
  onSequenceClick,
}: SequenceTableRowProps) {
  // Calculate row background based on model accuracy for review pages
  let rowClasses = 'p-4 cursor-pointer';
  if (defaultProcessingStage === 'annotated' && sequence.annotation) {
    // Special background for unsure sequences
    if (sequence.annotation.is_unsure) {
      rowClasses = 'p-4 cursor-pointer bg-amber-50 hover:bg-amber-100';
    } else {
      const accuracy = analyzeSequenceAccuracy(sequence);
      rowClasses = `p-4 cursor-pointer ${getRowBackgroundClasses(accuracy)}`;
    }
  } else {
    rowClasses = 'p-4 hover:bg-gray-50 cursor-pointer';
  }

  return (
    <div key={sequence.id} className={rowClasses} onClick={() => onSequenceClick(sequence)}>
      <div className="flex items-start space-x-4">
        {/* Detection Image Thumbnail */}
        <div className="flex-shrink-0">
          <DetectionImageThumbnail sequenceId={sequence.id} className="h-16" />
        </div>

        {/* Sequence Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-3">
            <h3 className="text-sm font-medium text-gray-900 truncate">{sequence.camera_name}</h3>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              {sequence.source_api}
            </span>
            {sequence.is_wildfire_alertapi && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                🔥 Wildfire Alert
              </span>
            )}
            {/* Unsure indicator for review page */}
            {defaultProcessingStage === 'annotated' && sequence.annotation?.is_unsure && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                ⚠️ Unsure
              </span>
            )}
            {/* Processing stage pill - conditionally hidden based on page context */}
            {(() => {
              const processingStage = sequence.annotation?.processing_stage || 'no_annotation';
              // Hide "ready_to_annotate" pills on annotate page, hide "annotated" pills on review page
              const shouldHidePill =
                (defaultProcessingStage === 'ready_to_annotate' &&
                  processingStage === 'ready_to_annotate') ||
                (defaultProcessingStage === 'annotated' && processingStage === 'annotated');

              if (shouldHidePill) return null;

              return (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getProcessingStageColorClass(processingStage)}`}
                >
                  {getProcessingStageLabel(processingStage)}
                </span>
              );
            })()}
          </div>

          <div className="mt-2 flex items-center text-sm text-gray-500 space-x-2">
            <span>{new Date(sequence.recorded_at).toLocaleString()}</span>

            <span className="text-gray-400">•</span>
            <span>{sequence.organisation_name}</span>

            {sequence.azimuth !== null && sequence.azimuth !== undefined && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-gray-400 text-xs">Azimuth: {sequence.azimuth}°</span>
              </>
            )}
          </div>
        </div>

        {/* Right Column - False Positive Pills and Contributors (Review page only) */}
        {defaultProcessingStage === 'annotated' && sequence.annotation && (
          <div className="flex-shrink-0 self-start">
            <div className="flex flex-col gap-2">
              {/* False Positive Pills */}
              <div className="flex flex-wrap gap-1 justify-end">
                {(() => {
                  const falsePositiveTypes = parseFalsePositiveTypes(
                    sequence.annotation.false_positive_types
                  );
                  return falsePositiveTypes.map((type: string) => (
                    <span
                      key={type}
                      className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                    >
                      {getFalsePositiveEmoji(type)} {formatFalsePositiveType(type)}
                    </span>
                  ));
                })()}
              </div>

              {/* Smoke Type Pills */}
              <div className="flex flex-wrap gap-1 justify-end">
                {sequence.annotation.smoke_types?.map((type: string) => (
                  <span
                    key={type}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
                  >
                    {getSmokeTypeEmoji(type)} {formatSmokeType(type)}
                  </span>
                ))}
              </div>

              {/* Contributors - Bottom Right */}
              {sequence.annotation.contributors && sequence.annotation.contributors.length > 0 && (
                <div className="flex justify-end">
                  <ContributorList
                    contributors={sequence.annotation.contributors}
                    displayMode="compact"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
