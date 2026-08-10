import { LocalizeDoneQueueItem } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { laneNeedsLocalization } from '@/utils/annotation/localizeUtils';
import { deriveSequenceOutcome, rollupOutcomes } from '@/utils/modelAccuracy';
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
import { TemporalScoreCell } from '@/components/sequences/TemporalScoreCell';
import type { QueueOrderBy } from '@/types/api';

interface LocalizeDoneQueueTableProps {
  items: LocalizeDoneQueueItem[];
  onItemClick: (item: LocalizeDoneQueueItem) => void;
  /** When supplied, the Score header becomes a sort control. */
  sort?: {
    orderBy: QueueOrderBy;
    orderDirection: 'asc' | 'desc';
    onSort: (field: QueueOrderBy) => void;
  };
}

// The alert's smoke objects (smoke or missed smoke, not unsure) — the ones
// that go through localization. Mirrors LocalizeQueueTable's smokeLanes.
function smokeLanes(item: LocalizeDoneQueueItem) {
  return item.lanes.filter(laneNeedsLocalization);
}

// "2 objects" once every smoke object is localized, or "3 objects · 1
// localized" while the alert is still mixed (some siblings not yet ANNOTATED).
function objectsCell(item: LocalizeDoneQueueItem): string {
  const lanes = smokeLanes(item);
  const localized = lanes.filter(l => l.processing_stage === 'annotated').length;
  const objectsText = `${lanes.length} ${lanes.length === 1 ? 'object' : 'objects'}`;
  return localized < lanes.length ? `${objectsText} · ${localized} localized` : objectsText;
}

// Alert-level rollup over every lane (not just smoke lanes): dominant
// outcome + count of the other objects. Identical to LocalizeQueueTable.
function alertOutcome(item: LocalizeDoneQueueItem) {
  return rollupOutcomes(
    item.lanes.flatMap(lane => {
      const outcome = deriveSequenceOutcome(lane);
      return outcome ? [outcome] : [];
    })
  );
}

export function LocalizeDoneQueueTable({ items, onItemClick, sort }: LocalizeDoneQueueTableProps) {
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
            <ColumnHeader label="Recorded" tip="When the alert was recorded" />
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
              label="Objects"
              tip="Smoke objects localized in this alert"
              align="right"
            />
            <ColumnHeader
              label="Result"
              tip="Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — dominant across the alert's objects; +N counts the others"
              align="right"
            />
            <ColumnHeader label="Annotators" tip="Who classified or localized this alert" />
          </tr>
        </thead>
        <tbody className={TBODY_CLASSES}>
          {items.map(item => {
            const rollup = alertOutcome(item);
            return (
              <tr
                key={`${item.source_api}-${item.platform_alert_id}`}
                onClick={() => onItemClick(item)}
                className={ROW_CLASSES}
              >
                <td className="px-4 py-2">
                  <DetectionImageThumbnail
                    sequenceId={item.lanes[0].sequence_id}
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
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>{objectsCell(item)}</td>
                <td className={CELL_CLASSES}>
                  {rollup && (
                    <OutcomeCode outcome={rollup.outcome} extraCount={rollup.extraCount} />
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
