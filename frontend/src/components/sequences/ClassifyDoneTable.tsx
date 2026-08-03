import { SequenceAnnotation, SequenceWithAnnotation } from '@/types/api';
import {
  SequenceOutcome,
  deriveSequenceOutcome,
  formatFalsePositiveType,
  formatSmokeType,
  parseFalsePositiveTypes,
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { ColumnHeader } from './ColumnHeader';
import { OutcomeCode } from './OutcomeCode';
import { PlatformAnnotationLabel } from './PlatformAnnotationLabel';
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

interface ClassifyDoneTableProps {
  sequences: SequenceWithAnnotation[];
  onSequenceClick: (sequence: SequenceWithAnnotation) => void;
}

// Quiet text after the outcome code: what the human concluded.
function resultDetail(annotation: SequenceAnnotation, outcome: SequenceOutcome): string {
  switch (outcome) {
    case 'unsure':
      return 'Unsure';
    case 'fn':
      return ['Missed smoke', ...(annotation.smoke_types ?? []).map(formatSmokeType)].join(' · ');
    case 'tp':
      return (annotation.smoke_types ?? []).map(formatSmokeType).join(', ');
    case 'fp':
      return parseFalsePositiveTypes(annotation.false_positive_types)
        .map(formatFalsePositiveType)
        .join(', ');
  }
}

export function ClassifyDoneTable({ sequences, onSequenceClick }: ClassifyDoneTableProps) {
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
            <ColumnHeader
              label="Alert API annotation"
              tip="Annotation reported by the alert platform (🔥 wildfire / 💨 other smoke / ○ other)"
            />
            <ColumnHeader
              label="Result"
              tip="Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — and the classification detail"
              align="right"
            />
          </tr>
        </thead>
        <tbody className={TBODY_CLASSES}>
          {sequences.map(sequence => {
            const outcome = deriveSequenceOutcome(sequence.annotation);
            const detail =
              sequence.annotation && outcome ? resultDetail(sequence.annotation, outcome) : '';
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
                  {new Date(sequence.recorded_at).toLocaleString()}
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{sequence.source_api}</td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                  {sequence.azimuth !== null && sequence.azimuth !== undefined
                    ? `${sequence.azimuth}°`
                    : ''}
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                  <PlatformAnnotationLabel value={sequence.is_wildfire_alertapi} />
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
