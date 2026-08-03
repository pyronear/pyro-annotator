interface ColumnHeaderProps {
  label: string;
  tip: string;
  // 'right' anchors the bubble to the column's right edge — use for columns
  // near the table's right side, where a left-anchored bubble would be
  // clipped by the overflow-x-auto scroll container.
  align?: 'left' | 'right';
}

/**
 * Table column header with a CSS-only hover tooltip explaining the column.
 * The bubble resets the th's uppercase/tracking styles so the tip reads as
 * normal text.
 */
export function ColumnHeader({ label, tip, align = 'left' }: ColumnHeaderProps) {
  return (
    <th className="group relative px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      <span className="cursor-help">{label}</span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-10 mt-1 hidden w-max max-w-[16rem] whitespace-normal rounded bg-gray-900 px-2 py-1 text-xs font-normal normal-case tracking-normal text-white shadow group-hover:block ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {tip}
      </span>
    </th>
  );
}
