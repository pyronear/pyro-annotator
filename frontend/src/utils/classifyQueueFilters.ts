import { ExtendedSequenceFilters } from '@/types/api';

export const CLASSIFY_QUEUE_FILTERS_KEY = 'filters-classify';

export type ClassifyQueueFilters = Pick<
  ExtendedSequenceFilters,
  | 'camera_name'
  | 'organisation_name'
  | 'source_api'
  | 'recorded_at_gte'
  | 'recorded_at_lte'
  | 'is_wildfire_alertapi'
>;

/**
 * The filters the annotator set on the classify queue page, as persisted by
 * usePersistedFilters. Only the fields the classify-queue endpoint filters on;
 * pagination and ordering stay with the caller.
 */
export function readClassifyQueueFilters(): ClassifyQueueFilters {
  try {
    const stored = localStorage.getItem(CLASSIFY_QUEUE_FILTERS_KEY);
    if (!stored) return {};
    const filters = (JSON.parse(stored) as { filters?: ExtendedSequenceFilters }).filters;
    return {
      camera_name: filters?.camera_name || undefined,
      organisation_name: filters?.organisation_name || undefined,
      source_api: filters?.source_api || undefined,
      recorded_at_gte: filters?.recorded_at_gte || undefined,
      recorded_at_lte: filters?.recorded_at_lte || undefined,
      is_wildfire_alertapi: filters?.is_wildfire_alertapi,
    };
  } catch {
    return {};
  }
}
