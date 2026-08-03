import {
  ProcessingStageFilter,
  PaginatedResponse,
  SequenceWithAnnotation,
  ExtendedSequenceFilters,
} from '@/types/api';
import { PAGINATION_OPTIONS } from '@/utils/constants';
import { stageFilterIncludes } from '@/utils/processingStage';

interface SequencesTableHeaderProps {
  filteredSequences: PaginatedResponse<SequenceWithAnnotation>;
  sequences?: PaginatedResponse<SequenceWithAnnotation>;
  defaultProcessingStage: ProcessingStageFilter;
  selectedModelAccuracy: string;
  filters: ExtendedSequenceFilters;
  onFilterChange: (update: { size: number }) => void;
}

export function SequencesTableHeader({
  filteredSequences,
  sequences,
  defaultProcessingStage,
  selectedModelAccuracy,
  filters,
  onFilterChange,
}: SequencesTableHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-line">
      <div className="flex items-center justify-between">
        <p className="font-body text-sm text-haze">
          Showing {(filteredSequences.page - 1) * filteredSequences.size + 1} to{' '}
          {Math.min(filteredSequences.page * filteredSequences.size, filteredSequences.total)} of{' '}
          {filteredSequences.total} results
          {selectedModelAccuracy !== 'all' &&
            stageFilterIncludes(defaultProcessingStage, 'annotated') &&
            sequences && <span> (filtered from {sequences.total} total)</span>}
        </p>
        <div className="flex items-center space-x-2">
          <label className="font-body text-sm text-haze">Show:</label>
          <select
            value={filters.size || 50}
            onChange={e => onFilterChange({ size: Number(e.target.value) })}
            className="border border-line rounded px-2 py-1 font-body text-sm"
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
