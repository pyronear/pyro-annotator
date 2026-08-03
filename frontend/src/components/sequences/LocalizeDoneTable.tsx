import { SequenceAnnotation, SequenceWithDetectionProgress } from '@/types/api';
import {
  analyzeSequenceAccuracy,
  formatFalsePositiveType,
  formatSmokeType,
  getRowBackgroundClasses,
  parseFalsePositiveTypes,
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { ColumnHeader } from './ColumnHeader';

interface LocalizeDoneTableProps {
  sequences: SequenceWithDetectionProgress[];
  annotations: Record<number, SequenceAnnotation | undefined>;
  onSequenceClick: (sequence: SequenceWithDetectionProgress) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap text-sm';

// Accuracy-based row coloring (amber for unsure), matching the SequencesLegend.
function rowClasses(
  sequence: SequenceWithDetectionProgress,
  annotation: SequenceAnnotation | undefined
): string {
  if (annotation) {
    if (annotation.is_unsure) return 'cursor-pointer bg-amber-50 hover:bg-amber-100';
    return `cursor-pointer ${getRowBackgroundClasses(
      analyzeSequenceAccuracy({ ...sequence, annotation })
    )}`;
  }
  return 'cursor-pointer hover:bg-gray-50';
}

// Human decision as plain text: unsure marker, then FP types. Smoke types
// have their own column.
function resultText(annotation: SequenceAnnotation): string {
  return [
    ...(annotation.is_unsure ? ['⚠️ Unsure'] : []),
    ...parseFalsePositiveTypes(annotation.false_positive_types).map(formatFalsePositiveType),
  ].join(', ');
}

export function LocalizeDoneTable({
  sequences,
  annotations,
  onSequenceClick,
}: LocalizeDoneTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={HEADER_CLASSES}>
              <span className="sr-only">Thumbnail</span>
            </th>
            <ColumnHeader label="Camera" tip="Camera that recorded the sequence" />
            <ColumnHeader label="Organisation" tip="Organisation operating the camera" />
            <ColumnHeader label="Recorded" tip="When the sequence was recorded" />
            <ColumnHeader label="Source" tip="Platform the sequence was imported from" />
            <ColumnHeader label="Azimuth" tip="Camera viewing direction, in degrees" />
            <ColumnHeader label="Smoke types" tip="Smoke types assigned during classification" />
            <ColumnHeader label="Frames" tip="Images in this sequence" />
            <ColumnHeader
              label="Result"
              tip="Classification outcome: unsure flag and false-positive types"
            />
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sequences.map(sequence => {
            const annotation = annotations[sequence.id];
            return (
              <tr
                key={sequence.id}
                onClick={() => onSequenceClick(sequence)}
                className={rowClasses(sequence, annotation)}
              >
                <td className="px-4 py-2">
                  <DetectionImageThumbnail sequenceId={sequence.id} className="h-10 w-16" />
                </td>
                <td className={`${CELL_CLASSES} font-medium text-gray-900`}>
                  {sequence.camera_name}
                </td>
                <td className={`${CELL_CLASSES} text-gray-500`}>{sequence.organisation_name}</td>
                <td className={`${CELL_CLASSES} text-gray-500`}>
                  {new Date(sequence.recorded_at).toLocaleString()}
                </td>
                <td className={`${CELL_CLASSES} text-gray-500`}>{sequence.source_api}</td>
                <td className={`${CELL_CLASSES} text-gray-500`}>
                  {sequence.azimuth !== null && sequence.azimuth !== undefined
                    ? `${sequence.azimuth}°`
                    : ''}
                </td>
                <td className={`${CELL_CLASSES} text-gray-500`}>
                  {(annotation?.smoke_types ?? []).map(formatSmokeType).join(', ')}
                </td>
                <td className={`${CELL_CLASSES} text-gray-500`}>
                  {sequence.detection_annotation_stats?.total_detections ?? ''}
                </td>
                <td className="px-4 py-2 text-sm text-gray-500">
                  {annotation ? resultText(annotation) : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
