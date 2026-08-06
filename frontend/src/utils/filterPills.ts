import { ExtendedSequenceFilters } from '@/types/api';
import {
  ModelAccuracyType,
  getModelAccuracyResult,
  formatFalsePositiveType,
  formatSmokeType,
} from '@/utils/modelAccuracy';
import { detectActivePreset } from '@/components/filters/shared/dateRangeUtils';

export type FilterPillId =
  | 'camera'
  | 'organization'
  | 'annotator'
  | 'source'
  | 'wildfire'
  | 'accuracy'
  | 'unsure'
  | 'date'
  | 'falsePositiveTypes'
  | 'smokeTypes';

export interface FilterPill {
  id: FilterPillId;
  label: string;
}

export interface FilterPillInput {
  filters: ExtendedSequenceFilters;
  dateFrom: string;
  dateTo: string;
  selectedFalsePositiveTypes: string[];
  selectedSmokeTypes: string[];
  selectedModelAccuracy: ModelAccuracyType | 'all';
  selectedUnsure: 'all' | 'unsure' | 'not-unsure';
  showModelAccuracy: boolean;
  showFalsePositiveTypes: boolean;
  showSmokeTypes: boolean;
  showUnsureFilter: boolean;
  showAnnotatorFilter?: boolean;
  sourceApis: { id: string; name: string }[];
  annotators?: { id: number; username: string }[];
}

const PRESET_LABELS: Record<string, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

const WILDFIRE_LABELS: Record<string, string> = {
  wildfire_smoke: 'Wildfire smoke',
  other_smoke: 'Other smoke',
  other: 'Other',
};

function dateRangeLabel(dateFrom: string, dateTo: string): string {
  const preset = detectActivePreset(dateFrom, dateTo);
  if (preset && PRESET_LABELS[preset]) return PRESET_LABELS[preset];
  if (dateFrom && dateTo) return `${dateFrom} – ${dateTo}`;
  if (dateFrom) return `From ${dateFrom}`;
  return `Until ${dateTo}`;
}

/**
 * Builds the list of applied-filter pills shown beside the Filters button.
 * Pill order matches the order filters appear in the popover.
 */
export function buildFilterPills(input: FilterPillInput): FilterPill[] {
  const { filters } = input;
  const pills: FilterPill[] = [];

  if (filters.camera_name) {
    pills.push({ id: 'camera', label: `Camera: ${filters.camera_name}` });
  }
  if (filters.organisation_name) {
    pills.push({ id: 'organization', label: `Org: ${filters.organisation_name}` });
  }
  if (input.showAnnotatorFilter && filters.annotator_id !== undefined) {
    const annotator = (input.annotators ?? []).find(a => a.id === filters.annotator_id);
    pills.push({
      id: 'annotator',
      label: `Annotator: ${annotator ? annotator.username : filters.annotator_id}`,
    });
  }
  if (filters.source_api) {
    const source = input.sourceApis.find(s => s.id === filters.source_api);
    pills.push({ id: 'source', label: `Source: ${source ? source.name : filters.source_api}` });
  }
  if (filters.is_wildfire_alertapi !== undefined) {
    const label =
      filters.is_wildfire_alertapi === null
        ? 'Unclassified'
        : (WILDFIRE_LABELS[filters.is_wildfire_alertapi] ?? String(filters.is_wildfire_alertapi));
    pills.push({ id: 'wildfire', label: `Alert API: ${label}` });
  }
  if (input.showModelAccuracy && input.selectedModelAccuracy !== 'all') {
    pills.push({
      id: 'accuracy',
      label: `Result: ${getModelAccuracyResult(input.selectedModelAccuracy).label}`,
    });
  }
  if (input.showUnsureFilter && input.selectedUnsure !== 'all') {
    pills.push({
      id: 'unsure',
      label: input.selectedUnsure === 'unsure' ? 'Only Unsure' : 'Not Unsure',
    });
  }
  if (input.dateFrom || input.dateTo) {
    pills.push({ id: 'date', label: dateRangeLabel(input.dateFrom, input.dateTo) });
  }
  if (input.showFalsePositiveTypes && input.selectedFalsePositiveTypes.length > 0) {
    const n = input.selectedFalsePositiveTypes.length;
    pills.push({
      id: 'falsePositiveTypes',
      label:
        n === 1
          ? `FP type: ${formatFalsePositiveType(input.selectedFalsePositiveTypes[0])}`
          : `FP types (${n})`,
    });
  }
  if (input.showSmokeTypes && input.selectedSmokeTypes.length > 0) {
    const n = input.selectedSmokeTypes.length;
    pills.push({
      id: 'smokeTypes',
      label:
        n === 1
          ? `Smoke type: ${formatSmokeType(input.selectedSmokeTypes[0])}`
          : `Smoke types (${n})`,
    });
  }

  return pills;
}
