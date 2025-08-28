import { PaginatedResponse, SequenceWithDetectionProgress, ExtendedSequenceFilters } from '@/types/api';
import { PAGINATION_OPTIONS } from '@/utils/constants';

interface DetectionAnnotateTableHeaderProps {
  filteredSequences: PaginatedResponse<SequenceWithDetectionProgress>;
  sequences?: PaginatedResponse<SequenceWithDetectionProgress>;
  selectedModelAccuracy: string;
  filters: ExtendedSequenceFilters;
  onFilterChange: (update: { size: number }) => void;
}

export function DetectionAnnotateTableHeader({
  filteredSequences,
  sequences,
  selectedModelAccuracy,
  filters,
  onFilterChange,
}: DetectionAnnotateTableHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-gray-200">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-700">
          Showing {(filteredSequences.page - 1) * filteredSequences.size + 1} to{' '}
          {Math.min(filteredSequences.page * filteredSequences.size, filteredSequences.total)}{' '}
          of {filteredSequences.total} sequences requiring detection annotation
          {selectedModelAccuracy !== 'all' && sequences && (
            <span className="text-gray-500"> (filtered from {sequences.total} total)</span>
          )}
        </p>
        <div className="flex items-center space-x-2">
          <label className="text-sm text-gray-700">Show:</label>
          <select
            value={filters.size || 50}
            onChange={e => onFilterChange({ size: Number(e.target.value) })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {PAGINATION_OPTIONS.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}