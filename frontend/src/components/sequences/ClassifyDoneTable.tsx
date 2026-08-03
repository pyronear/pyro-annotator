import { SequenceWithAnnotation } from '@/types/api';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getRowBackgroundClasses,
  parseFalsePositiveTypes,
  getSmokeTypeEmoji,
  formatSmokeType,
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { PlatformAnnotationPill } from './PlatformAnnotationPill';

interface ClassifyDoneTableProps {
  sequences: SequenceWithAnnotation[];
  onSequenceClick: (sequence: SequenceWithAnnotation) => void;
}

const HEADER_CLASSES =
  'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
const CELL_CLASSES = 'px-4 py-2 whitespace-nowrap text-sm';

// Accuracy-based row coloring (amber for unsure), matching the SequencesLegend.
function rowClasses(sequence: SequenceWithAnnotation): string {
  if (sequence.annotation) {
    if (sequence.annotation.is_unsure) return 'cursor-pointer bg-amber-50 hover:bg-amber-100';
    return `cursor-pointer ${getRowBackgroundClasses(analyzeSequenceAccuracy(sequence))}`;
  }
  return 'cursor-pointer hover:bg-gray-50';
}

export function ClassifyDoneTable({ sequences, onSequenceClick }: ClassifyDoneTableProps) {
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
            <th className={HEADER_CLASSES}>Result</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sequences.map(sequence => (
            <tr
              key={sequence.id}
              onClick={() => onSequenceClick(sequence)}
              className={rowClasses(sequence)}
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
              <td className={CELL_CLASSES}>
                <PlatformAnnotationPill value={sequence.is_wildfire_alertapi} />
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
              <td className="px-4 py-2 text-sm">
                {sequence.annotation && (
                  <div className="flex flex-wrap gap-1">
                    {sequence.annotation.is_unsure && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        ⚠️ Unsure
                      </span>
                    )}
                    {parseFalsePositiveTypes(sequence.annotation.false_positive_types).map(
                      (type: string) => (
                        <span
                          key={type}
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                        >
                          {getFalsePositiveEmoji(type)} {formatFalsePositiveType(type)}
                        </span>
                      )
                    )}
                    {sequence.annotation.smoke_types?.map((type: string) => (
                      <span
                        key={type}
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
                      >
                        {getSmokeTypeEmoji(type)} {formatSmokeType(type)}
                      </span>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
