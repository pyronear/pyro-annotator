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
import {
  CELL_CLASSES,
  CELL_TEXT,
  DATA_CELL_TEXT,
  HEADER_CELL_CLASSES,
  PRIMARY_CELL_TEXT,
  ROW_CLASSES,
  TABLE_CLASSES,
  TBODY_CLASSES,
  THEAD_CLASSES,
} from './tableStyles';
import { formatDateTime } from '@/utils/datetime';

interface LocalizeDoneTableProps {
  sequences: SequenceWithDetectionProgress[];
  annotations: Record<number, SequenceAnnotation | undefined>;
  onSequenceClick: (sequence: SequenceWithDetectionProgress) => void;
}

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
      <table className={TABLE_CLASSES}>
        <thead className={THEAD_CLASSES}>
          <tr>
            <th className={HEADER_CELL_CLASSES}>
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
        <tbody className={TBODY_CLASSES}>
          {sequences.map(sequence => {
            const annotation = annotations[sequence.id];
            const outcome = deriveSequenceOutcome(annotation);
            const detail = annotation ? resultDetail(annotation) : '';
            return (
              <tr
                key={sequence.id}
                onClick={() => onSequenceClick(sequence)}
                className={ROW_CLASSES}
              >
                <td className="px-4 py-2">
                  <DetectionImageThumbnail sequenceId={sequence.id} className="h-10 w-16" />
                </td>
                <td className={`${CELL_CLASSES} ${PRIMARY_CELL_TEXT}`}>{sequence.camera_name}</td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{sequence.organisation_name}</td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                  {formatDateTime(sequence.recorded_at)}
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{sequence.source_api}</td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                  {sequence.azimuth !== null && sequence.azimuth !== undefined
                    ? `${sequence.azimuth}°`
                    : ''}
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                  {(annotation?.smoke_types ?? []).map(formatSmokeType).join(', ')}
                </td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
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
