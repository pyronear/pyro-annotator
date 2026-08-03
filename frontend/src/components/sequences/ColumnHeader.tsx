interface ColumnHeaderProps {
  label: string;
  tip: string;
}

/**
 * Table column header with a CSS-only hover tooltip explaining the column.
 * The bubble resets the th's uppercase/tracking styles so the tip reads as
 * normal text.
 */
export function ColumnHeader({ label, tip }: ColumnHeaderProps) {
  return (
    <th className="group relative px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      <span className="cursor-help">{label}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-max max-w-[16rem] whitespace-normal rounded bg-gray-900 px-2 py-1 text-xs font-normal normal-case tracking-normal text-white shadow group-hover:block"
      >
        {tip}
      </span>
    </th>
  );
}
