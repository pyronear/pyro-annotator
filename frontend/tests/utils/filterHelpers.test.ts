import { describe, it, expect } from 'vitest';
import { hasActiveUserFilters } from '@/utils/filterHelpers';
import { ExtendedSequenceFilters } from '@/types/api';

// Only the filters argument varies here; everything else stays at its
// "nothing selected" value so a true result can only come from `filters`.
const check = (filters: ExtendedSequenceFilters) =>
  hasActiveUserFilters(filters, '', '', [], [], 'all', 'all');

describe('hasActiveUserFilters', () => {
  it('is false with no filters applied', () => {
    expect(check({})).toBe(false);
  });

  it('counts the filters shown on every page', () => {
    expect(check({ camera_name: 'CAM_01' })).toBe(true);
    expect(check({ organisation_name: 'Pyronear' })).toBe(true);
    expect(check({ source_api: 'pyronear_french' })).toBe(true);
    expect(check({ recorded_at_gte: '2026-01-01T00:00:00' })).toBe(true);
  });

  it('counts the Alert API annotation filter, including Unclassified', () => {
    expect(check({ is_wildfire_alertapi: 'wildfire_smoke' })).toBe(true);
    // null is the Unclassified choice — a selection, not an absent filter.
    expect(check({ is_wildfire_alertapi: null })).toBe(true);
  });
});
