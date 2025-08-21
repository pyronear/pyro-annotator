import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from './modelAccuracy';

/**
 * Determines if the user has applied any filters beyond the default system filters.
 * This helps distinguish between "no data available" vs "no data matching filters".
 * 
 * @param filters - The current filter state
 * @param dateFrom - Date from value
 * @param dateTo - Date to value
 * @param selectedFalsePositiveTypes - Selected false positive types
 * @param selectedModelAccuracy - Selected model accuracy filter
 * @param selectedUnsure - Selected unsure filter
 * @param showModelAccuracy - Whether model accuracy filter is shown (review pages)
 * @param showFalsePositiveTypes - Whether false positive types filter is shown (review pages)
 * @param showUnsureFilter - Whether unsure filter is shown (sequence review page)
 * @returns true if user has applied any filters that could cause empty results
 */
export function hasActiveUserFilters(
  filters: ExtendedSequenceFilters,
  dateFrom: string,
  dateTo: string,
  selectedFalsePositiveTypes: string[],
  selectedModelAccuracy: ModelAccuracyType | 'all',
  selectedUnsure: 'all' | 'unsure' | 'not-unsure',
  showModelAccuracy: boolean = false,
  showFalsePositiveTypes: boolean = false,
  showUnsureFilter: boolean = false
): boolean {
  // Check date range filters
  if (dateFrom || dateTo) {
    return true;
  }

  // Check basic filters
  if (filters.camera_name || filters.organisation_name) {
    return true;
  }

  // Check review-specific filters (only relevant on review pages)
  if (showModelAccuracy && selectedModelAccuracy !== 'all') {
    return true;
  }

  if (showFalsePositiveTypes && selectedFalsePositiveTypes.length > 0) {
    return true;
  }

  if (showUnsureFilter && selectedUnsure !== 'all') {
    return true;
  }

  // Check other potential filter fields that could be added in the future
  if (filters.recorded_at_gte || filters.recorded_at_lte) {
    return true;
  }

  return false;
}