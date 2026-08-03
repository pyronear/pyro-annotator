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
  'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap text-sm';

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
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
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
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map(item => (
            <tr
              key={`${item.source_api}-${item.platform_alert_id}`}
              onClick={() => onItemClick(item)}
              className="cursor-pointer hover:bg-gray-50"
            >
              <td className="px-4 py-2">
                <DetectionImageThumbnail
                  sequenceId={item.lanes[0].sequence_id}
                  className="h-10 w-16"
                />
              </td>
              <td className={`${CELL_CLASSES} font-medium text-gray-900`}>{item.camera_name}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>{item.organisation_name}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {new Date(item.recorded_at).toLocaleString()}
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>{item.source_api}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {item.azimuth !== null && item.azimuth !== undefined ? `${item.azimuth}°` : ''}
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {smokeTypes(item).map(formatSmokeType).join(', ')}
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>{smokeLanes(item).length}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>{smokeFrames(item)}</td>
              <td className={CELL_CLASSES}>
                {(() => {
                  const rollup = alertOutcome(item);
                  return rollup ? (
                    <OutcomeCode outcome={rollup.outcome} extraCount={rollup.extraCount} />
                  ) : null;
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
