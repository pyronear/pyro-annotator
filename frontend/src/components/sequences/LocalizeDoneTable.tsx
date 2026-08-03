import { SequenceAnnotation, SequenceWithDetectionProgress } from '@/types/api';
import {
  analyzeSequenceAccuracy,
  formatFalsePositiveType,
  formatSmokeType,
  getRowBackgroundClasses,
  parseFalsePositiveTypes,
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { PlatformAnnotationPill } from './PlatformAnnotationPill';

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

// Human decision as plain text: unsure marker, then FP types, then smoke types.
function resultText(annotation: SequenceAnnotation): string {
  return [
    ...(annotation.is_unsure ? ['⚠️ Unsure'] : []),
    ...parseFalsePositiveTypes(annotation.false_positive_types).map(formatFalsePositiveType),
    ...(annotation.smoke_types ?? []).map(formatSmokeType),
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
            <th className={HEADER_CLASSES}>Camera</th>
            <th className={HEADER_CLASSES}>Organisation</th>
            <th className={HEADER_CLASSES}>Recorded</th>
            <th className={HEADER_CLASSES}>Alert API annotation</th>
            <th className={HEADER_CLASSES}>Source</th>
            <th className={HEADER_CLASSES}>Azimuth</th>
            <th className={HEADER_CLASSES}>Result</th>
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
                <td className={CELL_CLASSES}>
                  <PlatformAnnotationPill value={sequence.is_wildfire_alertapi} />
                </td>
                <td className={`${CELL_CLASSES} text-gray-500`}>{sequence.source_api}</td>
                <td className={`${CELL_CLASSES} text-gray-500`}>
                  {sequence.azimuth !== null && sequence.azimuth !== undefined
                    ? `${sequence.azimuth}°`
                    : ''}
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
