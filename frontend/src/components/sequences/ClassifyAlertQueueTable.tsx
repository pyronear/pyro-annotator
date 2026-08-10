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
import { TemporalScoreCell } from '@/components/sequences/TemporalScoreCell';
import type { QueueOrderBy } from '@/types/api';

interface ClassifyAlertQueueTableProps {
  items: ClassifyQueueItem[];
  onAlertClick: (item: ClassifyQueueItem) => void;
  /** Skipped-backlog mode: rows carry skip metadata + an Unskip action and are not clickable. */
  skippedView?: boolean;
  onUnskip?: (item: ClassifyQueueItem) => void;
  /** When supplied, the Score header becomes a sort control. */
  sort?: {
    orderBy: QueueOrderBy;
    orderDirection: 'asc' | 'desc';
    onSort: (field: QueueOrderBy) => void;
  };
}

// "3 · 1 classified"; drops the classified suffix when nothing is
// classified yet.
function formatObjectsCell(totalObjects: number, classifiedObjects: number): string {
  return classifiedObjects > 0
    ? `${totalObjects} · ${classifiedObjects} classified`
    : `${totalObjects}`;
}

export function ClassifyAlertQueueTable({
  items,
  onAlertClick,
  skippedView = false,
  onUnskip,
  sort,
}: ClassifyAlertQueueTableProps) {
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
              tip="Platform temporal-model confidence that this alert is smoke. — means the platform never scored it."
              align="right"
              sort={
                sort && {
                  active: sort.orderBy === 'temporal_model_score',
                  direction: sort.orderDirection,
                  onSort: () => sort.onSort('temporal_model_score'),
                }
              }
            />
            <ColumnHeader label="Objects" tip="Objects to classify in this alert" align="right" />
            <ColumnHeader
              label="Alert API annotation"
              tip="Annotation reported by the alert platform"
              align="right"
            />
            {skippedView && (
              <>
                <ColumnHeader label="Skipped" tip="When the alert was skipped" />
                <ColumnHeader label="By" tip="Who skipped the alert" />
                <ColumnHeader label="Note" tip="Why the alert was skipped" />
                <th className={HEADER_CELL_CLASSES}>
                  <span className="sr-only">Actions</span>
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody className={TBODY_CLASSES}>
          {items.map(item => (
            <tr
              key={`${item.source_api}-${item.platform_alert_id}`}
              onClick={skippedView ? undefined : () => onAlertClick(item)}
              className={skippedView ? undefined : ROW_CLASSES}
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
              <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                {formatObjectsCell(item.total_objects, item.classified_objects)}
              </td>
              <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                <PlatformAnnotationLabel value={item.is_wildfire_alertapi} />
              </td>
              {skippedView && (
                <>
                  <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                    {item.skip ? formatDateTime(item.skip.skipped_at) : '—'}
                  </td>
                  <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{item.skip?.skipped_by ?? '—'}</td>
                  <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{item.skip?.note ?? '—'}</td>
                  <td className={CELL_CLASSES}>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onUnskip?.(item);
                      }}
                      className="whitespace-nowrap rounded-lg border border-line bg-paper px-2 py-1 font-body text-xs font-medium text-char hover:bg-ash"
                    >
                      Unskip
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
