/**
 * Canonical date rendering for the UI.
 *
 * Every user-facing date goes through here so the app reads the same way
 * everywhere: ISO-ordered, zero-padded, in the viewer's local timezone.
 * Locale-dependent helpers (`toLocaleString`, `toLocaleDateString`) are
 * deliberately not used — they render differently per browser locale.
 */

/** Shown instead of "Invalid Date" when a value can't be parsed. */
const INVALID_DATE = '—';

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Formats a date as YYYY-MM-DD in the viewer's local timezone.
 *
 * @pure Function formats dates consistently
 * @param value - Date object or parseable date string
 * @returns Date string in YYYY-MM-DD format, or an em dash if unparseable
 *
 * @example
 * formatDate('2026-08-04T15:12:45Z');
 * // Returns: "2026-08-04"
 */
export const formatDate = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return INVALID_DATE;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Formats a timestamp as YYYY-MM-DD HH:mm in the viewer's local timezone.
 *
 * Seconds are dropped — detection timestamps are meaningful to the minute.
 *
 * @pure Function formats dates consistently
 * @param value - Date object or parseable date string
 * @returns Timestamp string in YYYY-MM-DD HH:mm format, or an em dash if unparseable
 *
 * @example
 * formatDateTime('2026-08-04T15:12:45Z');
 * // Returns: "2026-08-04 17:12" (in a UTC+2 timezone)
 */
export const formatDateTime = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return INVALID_DATE;
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
