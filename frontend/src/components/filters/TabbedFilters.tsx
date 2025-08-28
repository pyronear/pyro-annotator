import { clsx } from 'clsx';
import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from '@/utils/modelAccuracy';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
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

interface TabbedFiltersProps {
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
  defaultTab?: 'simple' | 'advanced';
  simpleTabLabel?: string;
  advancedTabLabel?: string;
}

export default function TabbedFilters({
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
  defaultTab = 'simple',
  simpleTabLabel = 'Simple',
  advancedTabLabel = 'Advanced',
}: TabbedFiltersProps) {
  const [activeTab, setActiveTab] = usePersistedTabState('tabbed-filters-active-tab', defaultTab);

  // Count active filters for each tab
  // Note: We exclude system filters like 'processing_stage', 'page', 'size', 'include_annotation'
  // which are not user-visible filters
  const countActiveSimpleFilters = () => {
    let count = 0;
    if (filters.camera_name) count++;
    if (filters.organisation_name) count++;
    if (selectedModelAccuracy && selectedModelAccuracy !== 'all' && showModelAccuracy) count++;
    if (selectedUnsure && selectedUnsure !== 'all' && showUnsureFilter) count++;
    return count;
  };

  const countActiveAdvancedFilters = () => {
    let count = 0;
    // Include simple filters
    if (filters.camera_name) count++;
    if (filters.organisation_name) count++;
    if (selectedModelAccuracy && selectedModelAccuracy !== 'all' && showModelAccuracy) count++;
    if (selectedUnsure && selectedUnsure !== 'all' && showUnsureFilter) count++;
    // Include advanced-only filters
    if (filters.source_api) count++;
    if (filters.is_wildfire_alertapi !== undefined) count++;
    if (dateFrom || dateTo) count++;
    if (selectedFalsePositiveTypes.length > 0) count++;
    if (selectedSmokeTypes && selectedSmokeTypes.length > 0) count++;
    return count;
  };

  // Handle tab switch - simplified without filter reset
  const handleTabSwitch = (newTab: 'simple' | 'advanced') => {
    if (newTab === activeTab) return;
    setActiveTab(newTab);
  };

  // Render simple filters (Camera, Organization, Model Accuracy)
  const renderSimpleFilters = () => (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Camera</label>
        <select
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
        <select
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

      {/* Model Accuracy Filter - Only show on review page */}
      {showModelAccuracy && (
        <ModelAccuracyFilter
          selectedAccuracy={selectedModelAccuracy}
          onSelectionChange={onModelAccuracyChange}
          className="w-full"
        />
      )}
    </>
  );

  // Render advanced filters (All Simple filters + extras)
  const renderAdvancedFilters = () => (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Camera</label>
        <select
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Organization</label>
        <select
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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Source API</label>
        <select
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Wildfire Alert</label>
        <select
          value={
            filters.is_wildfire_alertapi === undefined
              ? ''
              : filters.is_wildfire_alertapi.toString()
          }
          onChange={e => {
            const value = e.target.value;
            onFiltersChange({
              is_wildfire_alertapi: value === '' ? undefined : value === 'true',
            });
          }}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="">All</option>
          <option value="true">Wildfire Alert</option>
          <option value="false">No Alert</option>
        </select>
      </div>

      {/* Model Accuracy Filter - Only show on review page */}
      {showModelAccuracy && (
        <ModelAccuracyFilter
          selectedAccuracy={selectedModelAccuracy}
          onSelectionChange={onModelAccuracyChange}
          className="w-full"
        />
      )}

      {/* Unsure Filter - Only show on sequence review page */}
      {showUnsureFilter && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Certainty</label>
          <select
            value={selectedUnsure}
            onChange={e => onUnsureChange(e.target.value as 'all' | 'unsure' | 'not-unsure')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="all">All</option>
            <option value="unsure">Only Unsure</option>
            <option value="not-unsure">Not Unsure</option>
          </select>
        </div>
      )}

      <div className="md:col-span-3">
        <DateRangeFilter
          label="Date Range (Recorded)"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
          onPresetSelect={onDateRangeSet}
          onClear={onDateRangeClear}
          className="w-full"
          data-testid="tabbed-filters-date-range"
        />
      </div>

      {/* False Positive Filter - Only show on review page */}
      {showFalsePositiveTypes && (
        <div className="md:col-span-3">
          <FalsePositiveFilter
            selectedTypes={selectedFalsePositiveTypes}
            onSelectionChange={onFalsePositiveTypesChange}
            className="w-full"
          />
        </div>
      )}

      {/* Smoke Type Filter - Only show on review page */}
      {showSmokeTypes && (
        <div className="md:col-span-3">
          <SmokeTypeFilter
            selectedTypes={selectedSmokeTypes}
            onSelectionChange={onSmokeTypesChange}
            className="w-full"
          />
        </div>
      )}
    </>
  );

  // Check if any filters are active across both tabs
  const hasActiveFilters = () => {
    return countActiveAdvancedFilters() > 0; // Always check all filters since advanced includes simple
  };

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <div className="flex justify-between items-center">
          <nav className="-mb-px flex">
            <button
              onClick={() => handleTabSwitch('simple')}
              className={clsx(
                'py-3 px-6 text-sm font-medium rounded-tl-lg transition-colors duration-200',
                activeTab === 'simple'
                  ? 'border-b-2 border-primary-500 text-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              <div className="flex items-center space-x-2">
                <span>{simpleTabLabel}</span>
                {countActiveSimpleFilters() > 0 && (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                    {countActiveSimpleFilters()}
                  </span>
                )}
              </div>
            </button>
            <button
              onClick={() => handleTabSwitch('advanced')}
              className={clsx(
                'py-3 px-6 text-sm font-medium transition-colors duration-200',
                activeTab === 'advanced'
                  ? 'border-b-2 border-primary-500 text-primary-600 bg-primary-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              <div className="flex items-center space-x-2">
                <span>{advancedTabLabel}</span>
                {countActiveAdvancedFilters() > 0 && (
                  <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                    {countActiveAdvancedFilters()}
                  </span>
                )}
              </div>
            </button>
          </nav>
          {/* Reset All Filters Button */}
          {onResetFilters && hasActiveFilters() && (
            <button
              onClick={onResetFilters}
              className="mr-4 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors duration-200"
              title="Reset all filters to default values"
            >
              Reset All Filters
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4">
        <div
          className={clsx(
            'transition-all duration-200 ease-in-out',
            activeTab === 'simple'
              ? 'opacity-100 visible'
              : 'opacity-0 invisible h-0 overflow-hidden'
          )}
        >
          {activeTab === 'simple' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {renderSimpleFilters()}
            </div>
          )}
        </div>

        <div
          className={clsx(
            'transition-all duration-200 ease-in-out',
            activeTab === 'advanced'
              ? 'opacity-100 visible'
              : 'opacity-0 invisible h-0 overflow-hidden'
          )}
        >
          {activeTab === 'advanced' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {renderAdvancedFilters()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
