import { ClassifyDoneItem, ClassifyDoneLane } from '@/types/api';
import {
  deriveSequenceOutcome,
  formatFalsePositiveType,
  formatSmokeType,
  rollupOutcomes,
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
import { formatDateTime } from '@/utils/datetime';
import { TemporalScoreCell } from '@/components/sequences/TemporalScoreCell';
import type { QueueOrderBy } from '@/types/api';

interface ClassifyDoneTableProps {
  items: ClassifyDoneItem[];
  onItemClick: (item: ClassifyDoneItem) => void;
  /** When supplied, the Score header becomes a sort control. */
  sort?: {
    orderBy: QueueOrderBy;
    orderDirection: 'asc' | 'desc';
    onSort: (field: QueueOrderBy) => void;
  };
}

// Alert-level rollup over every lane: dominant outcome + count of the others.
function alertOutcome(lanes: ClassifyDoneLane[]) {
  return rollupOutcomes(
    lanes.flatMap(lane => {
      const outcome = deriveSequenceOutcome(lane);
      return outcome ? [outcome] : [];
    })
  );
}

// Quiet text after the outcome code: everything the annotators concluded,
// across all lanes — missed smoke first, then smoke types, then FP types.
function alertDetail(lanes: ClassifyDoneLane[]): string {
  const parts: string[] = [];
  if (lanes.some(lane => lane.has_missed_smoke)) parts.push('Missed smoke');
  parts.push(
    ...[...new Set(lanes.filter(lane => lane.has_smoke).flatMap(lane => lane.smoke_types))].map(
      formatSmokeType
    )
  );
  parts.push(
    ...[...new Set(lanes.flatMap(lane => lane.false_positive_types))].map(formatFalsePositiveType)
  );
  return parts.join(' · ');
}

export function ClassifyDoneTable({ items, onItemClick, sort }: ClassifyDoneTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={TABLE_CLASSES}>
        <thead className={THEAD_CLASSES}>
          <tr>
            <th className={HEADER_CELL_CLASSES}>
              <span className="sr-only">Thumbnail</span>
            </th>
            <ColumnHeader label="Camera" tip="Camera that recorded the alert" />
            <ColumnHeader label="Organisation" tip="Organisation operating the camera" />
            <ColumnHeader
              label="Recorded"
              tip="When the alert was recorded"
              sort={
                sort && {
                  active: sort.orderBy === 'recorded_at',
                  direction: sort.orderDirection,
                  onSort: () => sort.onSort('recorded_at'),
                }
              }
            />
            <ColumnHeader label="Source" tip="Alert API the alert was imported from" />
            <ColumnHeader label="Azimuth" tip="Camera viewing direction, in degrees" />
            <ColumnHeader
              label="Score"
              tip="Alert API temporal-model confidence that this alert is smoke. — means the Alert API never scored it."
              align="right"
              sort={
                sort && {
                  active: sort.orderBy === 'temporal_model_score',
                  direction: sort.orderDirection,
                  onSort: () => sort.onSort('temporal_model_score'),
                }
              }
            />
            <ColumnHeader
              label="Alert API annotation"
              tip="Annotation reported by the alert platform"
            />
            <ColumnHeader
              label="Result"
              tip="Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — and the classification detail"
              align="right"
            />
            <ColumnHeader label="Annotators" tip="Who classified or localized this alert" />
          </tr>
        </thead>
        <tbody className={TBODY_CLASSES}>
          {items.map(item => {
            const rollup = alertOutcome(item.lanes);
            const detail = alertDetail(item.lanes);
            return (
              <tr
                key={`${item.source_api}-${item.platform_alert_id}`}
                onClick={() => onItemClick(item)}
                className={ROW_CLASSES}
              >
                <td className="px-4 py-2">
                  <DetectionImageThumbnail
                    sequenceId={item.primary_sequence_id}
                    className="h-10 w-16"
                  />
                </td>
                <td className={`${CELL_CLASSES} ${PRIMARY_CELL_TEXT}`}>{item.camera_name}</td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{item.organisation_name}</td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                  {formatDateTime(item.recorded_at)}
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{item.source_api}</td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                  {item.azimuth !== null && item.azimuth !== undefined ? `${item.azimuth}°` : ''}
                </td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                  <TemporalScoreCell score={item.temporal_model_score} />
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                  <PlatformAnnotationLabel value={item.is_wildfire_alertapi} />
                </td>
                <td className={CELL_CLASSES}>
                  {rollup && (
                    <>
                      <OutcomeCode outcome={rollup.outcome} extraCount={rollup.extraCount} />
                      {detail && (
                        <span className="ml-2.5 font-body text-detail text-haze">{detail}</span>
                      )}
                    </>
                  )}
                </td>
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                  {item.annotators.length > 0 ? (
                    item.annotators.join(', ')
                  ) : (
                    <span className="text-haze">—</span>
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
