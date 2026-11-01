import { beforeEach, describe, expect, it } from 'vitest';
import { CLASSIFY_QUEUE_FILTERS_KEY, readClassifyQueueFilters } from '@/utils/classifyQueueFilters';

describe('readClassifyQueueFilters', () => {
  beforeEach(() => localStorage.clear());

  it('returns no filters when nothing is stored', () => {
    expect(readClassifyQueueFilters()).toEqual({});
  });

  it('returns no filters when the stored value is corrupt', () => {
    localStorage.setItem(CLASSIFY_QUEUE_FILTERS_KEY, '{not json');
    expect(readClassifyQueueFilters()).toEqual({});
  });

  it('keeps the queue filters and drops pagination, stage and empty values', () => {
    localStorage.setItem(
      CLASSIFY_QUEUE_FILTERS_KEY,
      JSON.stringify({
        filters: {
          page: 3,
          size: 50,
          processing_stage: 'ready_to_annotate',
          organisation_name: 'sdis-07',
          camera_name: '',
        },
      })
    );
    const filters = readClassifyQueueFilters();
    expect(filters.organisation_name).toBe('sdis-07');
    expect(filters.camera_name).toBeUndefined();
    expect(filters).not.toHaveProperty('page');
    expect(filters).not.toHaveProperty('processing_stage');
  });
});
