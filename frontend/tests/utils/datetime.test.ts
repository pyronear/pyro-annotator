import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime } from '@/utils/datetime';

// These tests must pass in any host timezone, so they never hardcode a UTC
// offset. Timezone handling is covered by round-tripping: a Date built from
// local components is serialised to UTC via toISOString(), and the formatter
// has to recover the original local components. A formatter written against
// getUTC*() fails these in any non-UTC timezone.
const localIso = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('formatDateTime', () => {
  it('formats an ISO timestamp as YYYY-MM-DD HH:mm', () => {
    expect(formatDateTime('2026-08-04T15:12:45')).toBe('2026-08-04 15:12');
  });

  it('zero-pads single-digit month, day, hour and minute', () => {
    expect(formatDateTime('2026-01-02T03:04:00')).toBe('2026-01-02 03:04');
  });

  it('renders midnight as 00:00 rather than 24:00 or a blank time', () => {
    expect(formatDateTime('2026-08-04T00:00:00')).toBe('2026-08-04 00:00');
  });

  it('accepts a Date object as well as a string', () => {
    expect(formatDateTime(new Date(2026, 7, 4, 15, 12))).toBe('2026-08-04 15:12');
  });

  it('renders a UTC instant in the viewer timezone (summer)', () => {
    expect(formatDateTime(localIso(2026, 8, 4, 22, 30))).toBe('2026-08-04 22:30');
  });

  it('renders a UTC instant in the viewer timezone (winter, other side of DST)', () => {
    expect(formatDateTime(localIso(2026, 1, 15, 22, 30))).toBe('2026-01-15 22:30');
  });

  it('appends seconds when asked, for frames that sit seconds apart', () => {
    expect(formatDateTime('2026-08-04T15:12:45', { seconds: true })).toBe('2026-08-04 15:12:45');
  });

  it('zero-pads seconds', () => {
    expect(formatDateTime('2026-08-04T15:12:05', { seconds: true })).toBe('2026-08-04 15:12:05');
  });

  it('distinguishes frames five seconds apart when seconds are on', () => {
    const a = formatDateTime('2026-01-01T10:00:00', { seconds: true });
    const b = formatDateTime('2026-01-01T10:00:05', { seconds: true });
    expect(a).not.toBe(b);
  });

  it('returns an em dash for an unparseable value', () => {
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDateTime('not-a-date', { seconds: true })).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats an ISO timestamp as YYYY-MM-DD, dropping the time', () => {
    expect(formatDate('2026-08-04T15:12:45')).toBe('2026-08-04');
  });

  it('formats a Date object as YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 0, 2))).toBe('2026-01-02');
  });

  it('uses the local calendar day for a late-evening UTC instant', () => {
    expect(formatDate(localIso(2026, 8, 4, 23, 30))).toBe('2026-08-04');
  });

  it('returns an em dash for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });
});
