import { SequenceWithAnnotation } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { PlatformAnnotationLabel } from './PlatformAnnotationLabel';

interface ClassifyQueueTableProps {
  sequences: SequenceWithAnnotation[];
  onSequenceClick: (sequence: SequenceWithAnnotation) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap text-sm';

export function ClassifyQueueTable({ sequences, onSequenceClick }: ClassifyQueueTableProps) {
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
            <th className={HEADER_CLASSES}>Alert API annotation</th>
            <th className={HEADER_CLASSES}>Source</th>
            <th className={HEADER_CLASSES}>Azimuth</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sequences.map(sequence => (
            <tr
              key={sequence.id}
              onClick={() => onSequenceClick(sequence)}
              className="cursor-pointer hover:bg-gray-50"
            >
              <td className="px-4 py-2">
                <DetectionImageThumbnail sequenceId={sequence.id} className="h-10 w-16" />
              </td>
              <td className={`${CELL_CLASSES} font-medium text-gray-900`}>
                {sequence.camera_name}
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>{sequence.organisation_name}</td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {new Date(sequence.recorded_at).toLocaleString()}
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                <PlatformAnnotationLabel value={sequence.is_wildfire_alertapi} />
              </td>
              <td className={CELL_CLASSES}>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  {sequence.source_api}
                </span>
              </td>
              <td className={`${CELL_CLASSES} text-gray-500`}>
                {sequence.azimuth !== null && sequence.azimuth !== undefined
                  ? `${sequence.azimuth}°`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
