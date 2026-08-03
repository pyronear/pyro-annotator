import { ArrowDown, ArrowUp } from 'lucide-react';
import { HEADER_CELL_CLASSES } from './tableStyles';

interface SortState {
  active: boolean;
  direction: 'asc' | 'desc';
  onSort: () => void;
}

interface ColumnHeaderProps {
  label: string;
  tip: string;
  // 'right' anchors the bubble to the column's right edge — use for columns
  // near the table's right side, where a left-anchored bubble would be
  // clipped by the overflow-x-auto scroll container.
  align?: 'left' | 'right';
  // Sortable columns render the label as a button with an active-direction arrow.
  sort?: SortState;
}

/**
 * Table column header with a CSS-only hover tooltip explaining the column.
 * The bubble resets the th's uppercase/tracking styles so the tip reads as
 * normal text.
 */
export function ColumnHeader({ label, tip, align = 'left', sort }: ColumnHeaderProps) {
  const Arrow = sort?.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={`group relative ${HEADER_CELL_CLASSES}`}
      aria-sort={sort?.active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {sort ? (
        <button
          type="button"
          onClick={sort.onSort}
          className="select-none uppercase hover:text-char"
        >
          {label}
          {sort.active && <Arrow className="ml-1 inline h-3 w-3 text-ember" />}
        </button>
      ) : (
        <span className="cursor-help">{label}</span>
      )}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-10 mt-1 hidden w-max max-w-[16rem] whitespace-normal rounded bg-char px-2 py-1 font-body text-xs font-normal normal-case tracking-normal text-white group-hover:block ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {tip}
      </span>
    </th>
  );
}
