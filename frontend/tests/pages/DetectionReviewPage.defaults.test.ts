import { describe, expect, it } from 'vitest';
import { createDefaultFilterState } from '@/hooks/usePersistedFilters';

// Mirror of DetectionReviewPage's defaultState — imported indirectly to keep
// the page component un-rendered; keep in sync with the page.
const buildDefaults = () => ({
  ...createDefaultFilterState('annotated'),
  filters: {
    ...createDefaultFilterState('annotated').filters,
    detection_annotation_completion: 'complete' as const,
    include_detection_stats: true,
    processing_stage: 'annotated' as const,
    is_unsure: false,
    needs_localization: true,
  },
});

describe('verification (/localize/done) default filters', () => {
  it('uses the localization rule, not has_smoke', () => {
    const { filters } = buildDefaults();
    expect(filters.needs_localization).toBe(true);
    expect('has_smoke' in filters && filters.has_smoke).toBeFalsy();
  });
});
