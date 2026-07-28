const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Compact relative age for list rows: "just now", "45 min ago", "2 h ago",
 * "yesterday", "3 days ago", then a short date ("Jul 1", "Dec 31, 2025").
 * `now` is injectable for tests.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < MINUTE_MS) return 'just now';
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)} min ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)} h ago`;
  if (diffMs < 2 * DAY_MS) return 'yesterday';
  if (diffMs < 7 * DAY_MS) return `${Math.floor(diffMs / DAY_MS)} days ago`;
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
