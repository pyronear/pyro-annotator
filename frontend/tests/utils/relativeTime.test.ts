import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '@/utils/relativeTime';

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-28T12:00:00Z');

  it('renders sub-minute ages as "just now"', () => {
    expect(formatRelativeTime('2026-07-28T11:59:30Z', now)).toBe('just now');
  });

  it('renders minutes', () => {
    expect(formatRelativeTime('2026-07-28T11:15:00Z', now)).toBe('45 min ago');
  });

  it('renders hours', () => {
    expect(formatRelativeTime('2026-07-28T09:30:00Z', now)).toBe('2 h ago');
  });

  it('renders yesterday', () => {
    expect(formatRelativeTime('2026-07-27T10:00:00Z', now)).toBe('yesterday');
  });

  it('renders days within a week', () => {
    expect(formatRelativeTime('2026-07-25T12:00:00Z', now)).toBe('3 days ago');
  });

  it('falls back to a short date beyond a week', () => {
    expect(formatRelativeTime('2026-07-01T12:00:00Z', now)).toBe('Jul 1');
  });

  it('includes the year for other years', () => {
    expect(formatRelativeTime('2025-12-31T12:00:00Z', now)).toBe('Dec 31, 2025');
  });
});
