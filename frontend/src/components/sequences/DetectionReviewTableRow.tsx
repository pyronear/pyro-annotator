import { SequenceWithDetectionProgress, SequenceAnnotation } from '@/types/api';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getRowBackgroundClasses,
  parseFalsePositiveTypes,
  getSmokeTypeEmoji,
  formatSmokeType,
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import ContributorList from '@/components/ui/ContributorList';

interface DetectionReviewTableRowProps {
  sequence: SequenceWithDetectionProgress;
  annotation: SequenceAnnotation | undefined;
  onSequenceClick: (sequence: SequenceWithDetectionProgress) => void;
}

export function DetectionReviewTableRow({
  sequence,
  annotation,
  onSequenceClick,
}: DetectionReviewTableRowProps) {
  // Calculate row background based on model accuracy
  let rowClasses = 'p-4 cursor-pointer';
  if (annotation) {
    const accuracy = analyzeSequenceAccuracy({
      ...sequence,
      annotation: annotation,
    });
    rowClasses = `p-4 cursor-pointer ${getRowBackgroundClasses(accuracy)}`;
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
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                🔥 Wildfire Alert
              </span>
            )}
          </div>

          {/* Detection Progress */}
          {sequence.detection_annotation_stats && (
            <div className="mt-2 flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full w-full"></div>
                </div>
                <span className="text-xs text-green-600 font-medium">
                  {sequence.detection_annotation_stats.annotated_detections}/
                  {sequence.detection_annotation_stats.total_detections} detections completed
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center text-sm text-gray-500 space-x-2">
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

        {/* Right Column - False Positive Pills and Contributors */}
        {annotation && (
          <div className="flex-shrink-0 self-start">
            <div className="flex flex-col gap-2">
              {/* False Positive Pills */}
              <div className="flex flex-wrap gap-1 justify-end">
                {(() => {
                  const falsePositiveTypes = parseFalsePositiveTypes(
                    annotation.false_positive_types
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
                {annotation.smoke_types?.map((type: string) => (
                  <span
                    key={type}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
                  >
                    {getSmokeTypeEmoji(type)} {formatSmokeType(type)}
                  </span>
                ))}
              </div>

              {/* Contributors - Bottom Right */}
              {annotation.contributors && annotation.contributors.length > 0 && (
                <div className="flex justify-end">
                  <ContributorList contributors={annotation.contributors} displayMode="compact" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
