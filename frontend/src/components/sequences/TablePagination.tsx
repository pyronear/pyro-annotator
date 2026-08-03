import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TablePaginationProps {
  page: number;
  pages: number;
  /** Total item count; when set the label reads "Page X of Y · N <itemsLabel>". */
  total?: number;
  /** Noun for the total — "sequences", "alerts", "groups". */
  itemsLabel?: string;
  onPageChange: (page: number) => void;
}

const BUTTON_CLASSES =
  'inline-flex items-center rounded-lg border border-line bg-paper px-3 py-1.5 font-body text-sm font-medium text-char hover:bg-ash disabled:cursor-not-allowed disabled:opacity-50';

/** In-card table footer pagination — shared by all five list pages. */
export function TablePagination({
  page,
  pages,
  total,
  itemsLabel = 'items',
  onPageChange,
}: TablePaginationProps) {
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3">
      <p className="font-body text-sm text-haze">
        Page {page} of {pages}
        {total !== undefined && ` · ${total} ${itemsLabel}`}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className={BUTTON_CLASSES}
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className={BUTTON_CLASSES}
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
