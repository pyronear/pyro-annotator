import { LocalizationQueueItem } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { laneNeedsLocalization } from '@/utils/annotation/localizeUtils';
import { deriveSequenceOutcome, formatSmokeType, rollupOutcomes } from '@/utils/modelAccuracy';
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

interface LocalizeQueueTableProps {
  items: LocalizationQueueItem[];
  onItemClick: (item: LocalizationQueueItem) => void;
}

// Objects the annotator will draw boxes on (smoke or missed smoke, not unsure).
function smokeLanes(item: LocalizationQueueItem) {
  return item.lanes.filter(laneNeedsLocalization);
}

// Classify-phase smoke types across the alert's smoke objects, deduped.
// `?? []` guards payloads from a backend that predates the field.
function smokeTypes(item: LocalizationQueueItem): string[] {
  return [...new Set(smokeLanes(item).flatMap(l => l.smoke_types ?? []))];
}

// Images the annotator will draw boxes on: each smoke object replays the
// alert's frames, so two objects x 10 frames is 20 boxes of work.
function smokeFrames(item: LocalizationQueueItem): number {
  return smokeLanes(item).reduce((sum, l) => sum + l.total_detections, 0);
}

// Outcome rollup over the lanes this screen is actually about — the ones
// you'll box. Rolling up every lane made an alert advertise `?` for an unsure
// object the localize screen never shows (spec: 2026-08-05 unsure lanes gate
// the localize queue), and counted objects the Objects column doesn't.
// ClassifyDoneTable and LocalizeDoneQueueTable still roll up every lane —
// there, the other objects genuinely are part of the summary.
function alertOutcome(item: LocalizationQueueItem) {
  return rollupOutcomes(
    smokeLanes(item).flatMap(lane => {
      const outcome = deriveSequenceOutcome(lane);
      return outcome ? [outcome] : [];
    })
  );
}

export function LocalizeQueueTable({ items, onItemClick }: LocalizeQueueTableProps) {
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
            <ColumnHeader label="Smoke types" tip="Smoke types assigned during classification" />
            <ColumnHeader
              label="Objects"
              tip="Smoke objects to localize in this alert"
              align="right"
            />
            <ColumnHeader
              label="Frames"
              tip="Images to box across all smoke objects"
              align="right"
            />
            <ColumnHeader
              label="Result"
              tip="Model outcome — TP correct, FP false alarm, ⚑ FN missed smoke, ? unsure — dominant across the alert's objects; +N counts the others"
              align="right"
            />
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
                <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                  {smokeTypes(item).map(formatSmokeType).join(', ')}
                </td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>{smokeLanes(item).length}</td>
                <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>{smokeFrames(item)}</td>
                <td className={CELL_CLASSES}>
                  {rollup && (
                    <OutcomeCode outcome={rollup.outcome} extraCount={rollup.extraCount} />
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
