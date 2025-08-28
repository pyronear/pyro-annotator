import { PaginatedResponse, SequenceWithDetectionProgress } from '@/types/api';

interface DetectionReviewPaginationProps {
  filteredSequences: PaginatedResponse<SequenceWithDetectionProgress>;
  onPageChange: (page: number) => void;
}

export function DetectionReviewPagination({
  filteredSequences,
  onPageChange,
}: DetectionReviewPaginationProps) {
  if (filteredSequences.pages <= 1) return null;

  return (
    <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <button
          onClick={() => onPageChange(filteredSequences.page - 1)}
          disabled={filteredSequences.page === 1}
          className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Previous
        </button>
        <span className="text-sm text-gray-700">
          Page {filteredSequences.page} of {filteredSequences.pages}
        </span>
        <button
          onClick={() => onPageChange(filteredSequences.page + 1)}
          disabled={filteredSequences.page === filteredSequences.pages}
          className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
