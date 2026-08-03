import { SequenceAnnotation, SequenceWithDetectionProgress } from '@/types/api';
import {
  deriveSequenceOutcome,
  formatFalsePositiveType,
  formatSmokeType,
  parseFalsePositiveTypes,
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { ColumnHeader } from './ColumnHeader';
import { OutcomeCode } from './OutcomeCode';

interface LocalizeDoneTableProps {
  sequences: SequenceWithDetectionProgress[];
  annotations: Record<number, SequenceAnnotation | undefined>;
  onSequenceClick: (sequence: SequenceWithDetectionProgress) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap';

// Quiet text after the outcome code: false-positive types. Smoke types have
// their own column, and unsure is carried by the code itself.
function resultDetail(annotation: SequenceAnnotation): string {
  return parseFalsePositiveTypes(annotation.false_positive_types)
    .map(formatFalsePositiveType)
    .join(', ');
}

export function LocalizeDoneTable({
  sequences,
  annotations,
  onSequenceClick,
}: LocalizeDoneTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-line">
        <thead className="bg-ash">
          <tr>
            <th className={HEADER_CLASSES}>
              <span className="sr-only">Thumbnail</span>
            </th>
            <ColumnHeader label="Camera" tip="Camera that recorded the sequence" />
            <ColumnHeader label="Organisation" tip="Organisation operating the camera" />
            <ColumnHeader label="Recorded" tip="When the sequence was recorded" />
            <ColumnHeader label="Source" tip="Alert API the sequence was imported from" />
            <ColumnHeader label="Azimuth" tip="Camera viewing direction, in degrees" />
            <ColumnHeader label="Smoke types" tip="Smoke types assigned during classification" />
            <ColumnHeader label="Frames" tip="Images in this sequence" align="right" />
            <ColumnHeader
              label="Result"
              tip="Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — and false-positive types"
              align="right"
            />
          </tr>
        </thead>
        <tbody className="bg-paper divide-y divide-line">
          {sequences.map(sequence => {
            const annotation = annotations[sequence.id];
            const outcome = deriveSequenceOutcome(annotation);
            const detail = annotation ? resultDetail(annotation) : '';
            return (
              <tr
                key={sequence.id}
                onClick={() => onSequenceClick(sequence)}
                className="cursor-pointer hover:bg-ash"
              >
                <td className="px-4 py-2">
                  <DetectionImageThumbnail sequenceId={sequence.id} className="h-10 w-16" />
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm font-medium text-char`}>
                  {sequence.camera_name}
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm text-haze`}>
                  {sequence.organisation_name}
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {new Date(sequence.recorded_at).toLocaleString()}
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm text-haze`}>
                  {sequence.source_api}
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {sequence.azimuth !== null && sequence.azimuth !== undefined
                    ? `${sequence.azimuth}°`
                    : ''}
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm text-haze`}>
                  {(annotation?.smoke_types ?? []).map(formatSmokeType).join(', ')}
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {sequence.detection_annotation_stats?.total_detections ?? ''}
                </td>
                <td className={CELL_CLASSES}>
                  {outcome && (
                    <>
                      <OutcomeCode outcome={outcome} />
                      {detail && (
                        <span className="ml-2.5 font-body text-detail text-haze">{detail}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
