import { ClassifyQueueItem } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { ColumnHeader } from './ColumnHeader';
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

interface ClassifyAlertQueueTableProps {
  items: ClassifyQueueItem[];
  onAlertClick: (item: ClassifyQueueItem) => void;
}

// "3 · 1 classified"; drops the classified suffix when nothing is
// classified yet.
function formatObjectsCell(totalObjects: number, classifiedObjects: number): string {
  return classifiedObjects > 0
    ? `${totalObjects} · ${classifiedObjects} classified`
    : `${totalObjects}`;
}

export function ClassifyAlertQueueTable({ items, onAlertClick }: ClassifyAlertQueueTableProps) {
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
            <ColumnHeader label="Objects" tip="Objects to classify in this alert" align="right" />
            <ColumnHeader
              label="Alert API annotation"
              tip="Annotation reported by the alert platform"
              align="right"
            />
          </tr>
        </thead>
        <tbody className={TBODY_CLASSES}>
          {items.map(item => (
            <tr
              key={`${item.source_api}-${item.platform_alert_id}`}
              onClick={() => onAlertClick(item)}
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
                {formatObjectsCell(item.total_objects, item.classified_objects)}
              </td>
              <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                <PlatformAnnotationLabel value={item.is_wildfire_alertapi} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
