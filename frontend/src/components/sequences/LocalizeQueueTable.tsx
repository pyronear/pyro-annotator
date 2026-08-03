import { LocalizationQueueItem } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { laneNeedsLocalization } from '@/utils/annotation/localizeUtils';
import { deriveSequenceOutcome, formatSmokeType, rollupOutcomes } from '@/utils/modelAccuracy';
import { ColumnHeader } from './ColumnHeader';
import { OutcomeCode } from './OutcomeCode';

interface LocalizeQueueTableProps {
  items: LocalizationQueueItem[];
  onItemClick: (item: LocalizationQueueItem) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap';

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

// Alert-level rollup over every lane (not just smoke lanes): dominant
// outcome + count of the other objects.
function alertOutcome(item: LocalizationQueueItem) {
  return rollupOutcomes(
    item.lanes.flatMap(lane => {
      const outcome = deriveSequenceOutcome(lane);
      return outcome ? [outcome] : [];
    })
  );
}

export function LocalizeQueueTable({ items, onItemClick }: LocalizeQueueTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-line">
        <thead className="bg-ash">
          <tr>
            <th className={HEADER_CLASSES}>
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
        <tbody className="bg-paper divide-y divide-line">
          {items.map(item => {
            const rollup = alertOutcome(item);
            return (
              <tr
                key={`${item.source_api}-${item.platform_alert_id}`}
                onClick={() => onItemClick(item)}
                className="cursor-pointer hover:bg-ash"
              >
                <td className="px-4 py-2">
                  <DetectionImageThumbnail
                    sequenceId={item.lanes[0].sequence_id}
                    className="h-10 w-16"
                  />
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm font-medium text-char`}>
                  {item.camera_name}
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm text-haze`}>
                  {item.organisation_name}
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {new Date(item.recorded_at).toLocaleString()}
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm text-haze`}>{item.source_api}</td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {item.azimuth !== null && item.azimuth !== undefined ? `${item.azimuth}°` : ''}
                </td>
                <td className={`${CELL_CLASSES} font-body text-sm text-haze`}>
                  {smokeTypes(item).map(formatSmokeType).join(', ')}
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {smokeLanes(item).length}
                </td>
                <td className={`${CELL_CLASSES} font-data text-detail text-haze`}>
                  {smokeFrames(item)}
                </td>
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
