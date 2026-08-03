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
import { PlatformAnnotationPill } from './PlatformAnnotationPill';

interface ClassifyDoneTableProps {
  sequences: SequenceWithAnnotation[];
  onSequenceClick: (sequence: SequenceWithAnnotation) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap';

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
      <table className="min-w-full divide-y divide-line">
        <thead className="bg-ash">
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
            <ColumnHeader
              label="Result"
              tip="Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — and the classification detail"
              align="right"
            />
          </tr>
        </thead>
        <tbody className="bg-paper divide-y divide-line">
          {sequences.map(sequence => {
            const outcome = deriveSequenceOutcome(sequence.annotation);
            const detail =
              sequence.annotation && outcome ? resultDetail(sequence.annotation, outcome) : '';
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
                <td className={CELL_CLASSES}>
                  <PlatformAnnotationPill value={sequence.is_wildfire_alertapi} />
                </td>
                <td className={CELL_CLASSES}>
                  <span className="inline-flex rounded-full px-2 py-1 font-body text-xs font-semibold bg-ash text-haze">
                    {sequence.source_api}
                  </span>
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {sequence.azimuth !== null && sequence.azimuth !== undefined
                    ? `${sequence.azimuth}°`
                    : ''}
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
