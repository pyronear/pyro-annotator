import { clsx } from 'clsx';
import { Popover } from '@headlessui/react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from '@/utils/modelAccuracy';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { buildFilterPills, FilterPillId } from '@/utils/filterPills';
import ModelAccuracyFilter from './ModelAccuracyFilter';
import FalsePositiveFilter from './FalsePositiveFilter';
import SmokeTypeFilter from './SmokeTypeFilter';
import DateRangeFilter from './shared/DateRangeFilter';

interface Camera {
  id: number;
  name: string;
}

interface Organization {
  id: number;
  name: string;
}

interface SourceApi {
  id: string;
  name: string;
}

interface FilterPopoverProps {
  // Current filter values
  filters: ExtendedSequenceFilters;
  onFiltersChange: (filters: Partial<ExtendedSequenceFilters>) => void;

  // Additional states
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onDateRangeSet: (preset: string) => void;
  onDateRangeClear: () => void;

  selectedFalsePositiveTypes: string[];
  onFalsePositiveTypesChange: (types: string[]) => void;

  selectedSmokeTypes: string[];
  onSmokeTypesChange: (types: string[]) => void;

  selectedModelAccuracy: ModelAccuracyType | 'all';
  onModelAccuracyChange: (accuracy: ModelAccuracyType | 'all') => void;

  selectedUnsure?: 'all' | 'unsure' | 'not-unsure';
  onUnsureChange?: (unsure: 'all' | 'unsure' | 'not-unsure') => void;

  // Data
  cameras: Camera[];
  organizations: Organization[];
  sourceApis: SourceApi[];
  camerasLoading: boolean;
  organizationsLoading: boolean;
  sourceApisLoading: boolean;

  // Configuration
  showModelAccuracy?: boolean; // for review pages only
  showFalsePositiveTypes?: boolean; // for review pages only
  showSmokeTypes?: boolean; // for review pages only
  showUnsureFilter?: boolean; // for sequence review page only

  // Reset handler
  onResetFilters?: () => void;

  className?: string;
}

export default function FilterPopover({
  filters,
  onFiltersChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onDateRangeSet,
  onDateRangeClear,
  selectedFalsePositiveTypes,
  onFalsePositiveTypesChange,
  selectedSmokeTypes,
  onSmokeTypesChange,
  selectedModelAccuracy,
  onModelAccuracyChange,
  selectedUnsure = 'all',
  onUnsureChange = () => {},
  cameras,
  organizations,
  sourceApis,
  camerasLoading,
  organizationsLoading,
  sourceApisLoading,
  showModelAccuracy = false,
  showFalsePositiveTypes = false,
  showSmokeTypes = false,
  showUnsureFilter = false,
  onResetFilters,
  className = '',
}: FilterPopoverProps) {
  const [moreState, setMoreState] = usePersistedTabState<'expanded' | 'collapsed'>(
    'filter-popover-more-expanded',
    'collapsed'
  );
  const moreExpanded = moreState === 'expanded';

  const pills = buildFilterPills({
    filters,
    dateFrom,
    dateTo,
    selectedFalsePositiveTypes,
    selectedSmokeTypes,
    selectedModelAccuracy,
    selectedUnsure,
    showModelAccuracy,
    showFalsePositiveTypes,
    showSmokeTypes,
    showUnsureFilter,
    sourceApis,
  });

  const clearPill = (id: FilterPillId) => {
    switch (id) {
      case 'camera':
        onFiltersChange({ camera_name: undefined });
        break;
      case 'organization':
        onFiltersChange({ organisation_name: undefined });
        break;
      case 'source':
        onFiltersChange({ source_api: undefined });
        break;
      case 'wildfire':
        onFiltersChange({ is_wildfire_alertapi: undefined });
        break;
      case 'accuracy':
        onModelAccuracyChange('all');
        break;
      case 'unsure':
        onUnsureChange('all');
        break;
      case 'date':
        onDateRangeClear();
        break;
      case 'falsePositiveTypes':
        onFalsePositiveTypesChange([]);
        break;
      case 'smokeTypes':
        onSmokeTypesChange([]);
        break;
    }
  };

  // Widgets living behind the More divider: Source API and Wildfire always,
  // plus whatever the page's show* flags enable.
  const moreCount =
    2 +
    (showModelAccuracy ? 1 : 0) +
    (showUnsureFilter ? 1 : 0) +
    (showFalsePositiveTypes ? 1 : 0) +
    (showSmokeTypes ? 1 : 0);

  return (
    <div className={clsx('flex items-center justify-end gap-2 flex-wrap', className)}>
      {pills.map(pill => (
        <button
          key={pill.id}
          onClick={() => clearPill(pill.id)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary-50 border border-primary-100 text-primary-700 hover:bg-primary-100 transition-colors"
          aria-label={`Clear ${pill.label}`}
          title={`Clear ${pill.label}`}
        >
          <span>{pill.label}</span>
          <X className="w-3 h-3" />
        </button>
      ))}

      <Popover className="relative">
        <Popover.Button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500">
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </Popover.Button>

        <Popover.Panel className="absolute right-0 z-20 mt-2 w-96 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto overflow-x-hidden bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-4 space-y-4">
            <div>
              <label
                htmlFor="filter-camera"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Camera
              </label>
              <select
                id="filter-camera"
                value={filters.camera_name || ''}
                onChange={e => onFiltersChange({ camera_name: e.target.value || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
                disabled={camerasLoading}
              >
                <option value="">All Cameras</option>
                {cameras.map(camera => (
                  <option key={camera.id} value={camera.name}>
                    {camera.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-organization"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Organization
              </label>
              <select
                id="filter-organization"
                value={filters.organisation_name || ''}
                onChange={e => onFiltersChange({ organisation_name: e.target.value || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
                disabled={organizationsLoading}
              >
                <option value="">All Organizations</option>
                {organizations.map(organization => (
                  <option key={organization.id} value={organization.name}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>

            <DateRangeFilter
              label="Date Range (Recorded)"
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={onDateFromChange}
              onDateToChange={onDateToChange}
              onPresetSelect={onDateRangeSet}
              onClear={onDateRangeClear}
              className="w-full"
              data-testid="filter-popover-date-range"
            />

            <button
              onClick={() => setMoreState(moreExpanded ? 'collapsed' : 'expanded')}
              className="flex items-center gap-2 w-full text-sm text-gray-500 hover:text-gray-700"
              aria-expanded={moreExpanded}
            >
              <span className="flex-1 border-t border-gray-200" aria-hidden="true" />
              <span>More filters ({moreCount})</span>
              <ChevronDown
                className={clsx('w-4 h-4 transition-transform', moreExpanded && 'rotate-180')}
              />
              <span className="flex-1 border-t border-gray-200" aria-hidden="true" />
            </button>

            {moreExpanded && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="filter-source"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Source API
                  </label>
                  <select
                    id="filter-source"
                    value={filters.source_api || ''}
                    onChange={e => onFiltersChange({ source_api: e.target.value || undefined })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
                    disabled={sourceApisLoading}
                  >
                    <option value="">All Sources</option>
                    {sourceApis.map(sourceApi => (
                      <option key={sourceApi.id} value={sourceApi.id}>
                        {sourceApi.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="filter-wildfire"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Wildfire Classification
                  </label>
                  <select
                    id="filter-wildfire"
                    value={
                      filters.is_wildfire_alertapi === null
                        ? 'null'
                        : filters.is_wildfire_alertapi || ''
                    }
                    onChange={e => {
                      const value = e.target.value;
                      onFiltersChange({
                        is_wildfire_alertapi:
                          value === ''
                            ? undefined
                            : value === 'null'
                              ? null
                              : (value as 'wildfire_smoke' | 'other_smoke' | 'other'),
                      });
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All</option>
                    <option value="wildfire_smoke">🔥 Wildfire Smoke</option>
                    <option value="other_smoke">💨 Other Smoke</option>
                    <option value="other">○ Other</option>
                    <option value="null">📝 Unclassified</option>
                  </select>
                </div>

                {showModelAccuracy && (
                  <ModelAccuracyFilter
                    selectedAccuracy={selectedModelAccuracy}
                    onSelectionChange={onModelAccuracyChange}
                    className="w-full"
                  />
                )}

                {showUnsureFilter && (
                  <div>
                    <label
                      htmlFor="filter-certainty"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Certainty
                    </label>
                    <select
                      id="filter-certainty"
                      value={selectedUnsure}
                      onChange={e =>
                        onUnsureChange(e.target.value as 'all' | 'unsure' | 'not-unsure')
                      }
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="all">All</option>
                      <option value="unsure">Only Unsure</option>
                      <option value="not-unsure">Not Unsure</option>
                    </select>
                  </div>
                )}

                {showFalsePositiveTypes && (
                  <FalsePositiveFilter
                    selectedTypes={selectedFalsePositiveTypes}
                    onSelectionChange={onFalsePositiveTypesChange}
                    className="w-full"
                  />
                )}

                {showSmokeTypes && (
                  <SmokeTypeFilter
                    selectedTypes={selectedSmokeTypes}
                    onSelectionChange={onSmokeTypesChange}
                    className="w-full"
                  />
                )}
              </div>
            )}
          </div>

          {onResetFilters && pills.length > 0 && (
            <div className="border-t border-gray-200 px-4 py-3">
              <button
                onClick={onResetFilters}
                className="text-sm font-medium text-red-600 hover:text-red-700"
                title="Reset all filters to default values"
              >
                Reset all
              </button>
            </div>
          )}
        </Popover.Panel>
      </Popover>
    </div>
  );
}
