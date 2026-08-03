import { ClassifyQueueItem } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { PlatformAnnotationPill } from './PlatformAnnotationPill';

interface ClassifyAlertQueueTableProps {
  items: ClassifyQueueItem[];
  onAlertClick: (item: ClassifyQueueItem) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap text-sm';

// "3 objects · 1 classified"; drops the classified suffix when nothing is
// classified yet, and pluralizes "object(s)" correctly.
function formatObjectsCell(totalObjects: number, classifiedObjects: number): string {
  const objectsText = `${totalObjects} ${totalObjects === 1 ? 'object' : 'objects'}`;
  return classifiedObjects > 0 ? `${objectsText} · ${classifiedObjects} classified` : objectsText;
}

export function ClassifyAlertQueueTable({ items, onAlertClick }: ClassifyAlertQueueTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className={HEADER_CLASSES}>
              <span className="sr-only">Thumbnail</span>
            </th>
            <th className={HEADER_CLASSES}>Camera</th>
            <th className={HEADER_CLASSES}>Organisation</th>
            <th className={HEADER_CLASSES}>Recorded</th>
            <th className={HEADER_CLASSES}>Platform annotation</th>
            <th className={HEADER_CLASSES}>Source</th>
            <th className={HEADER_CLASSES}>Azimuth</th>
            <th className={HEADER_CLASSES}>Objects</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map(item => (
            <tr
              key={`${item.source_api}-${item.platform_alert_id}`}
              onClick={() => onAlertClick(item)}
              className="cursor-pointer hover:bg-gray-50"
            >
              <td className="px-4 py-2">
                <DetectionImageThumbnail
                  sequenceId={item.primary_sequence_id}
                  className="h-10 w-16"
                />
              </td>
              <td className={`${CELL_CLASSES} font-medium text-gray-900`}>{item.camera_name}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>{item.organisation_name}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {new Date(item.recorded_at).toLocaleString()}
              </td>
              <td className={CELL_CLASSES}>
                <PlatformAnnotationPill value={item.is_wildfire_alertapi} />
              </td>
              <td className={CELL_CLASSES}>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {item.source_api}
                </span>
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {item.azimuth !== null && item.azimuth !== undefined ? `${item.azimuth}°` : ''}
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {formatObjectsCell(item.total_objects, item.classified_objects)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
