import { useState } from 'react';
import { clsx } from 'clsx';
import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from '@/utils/modelAccuracy';
import ModelAccuracyFilter from './ModelAccuracyFilter';
import FalsePositiveFilter from './FalsePositiveFilter';
import SelectFilter, { createOptionsFromItems, createBooleanOptions, parseBooleanValue } from './shared/SelectFilter';
import DateRangeFilter, { calculatePresetDateRange } from './shared/DateRangeFilter';
import { 
  countActiveFilters, 
  calculateTabTransition, 
  mergeFilterState, 
  createInitialFilterState,
  ExtendedFilterState,
  FilterCategory 
} from '@/utils/filter-state';

interface Camera {
  readonly id: number;
  readonly name: string;
}

interface Organization {
  readonly id: number;
  readonly name: string;
}

interface TabbedFiltersRefactoredProps {
  // Current filter values
  readonly filters: ExtendedSequenceFilters;
  readonly onFiltersChange: (filters: Partial<ExtendedSequenceFilters>) => void;
  
  // Additional states
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly onDateFromChange: (value: string) => void;
  readonly onDateToChange: (value: string) => void;
  readonly onDateRangeSet: (preset: string) => void;
  readonly onDateRangeClear: () => void;
  
  readonly selectedFalsePositiveTypes: readonly string[];
  readonly onFalsePositiveTypesChange: (types: string[]) => void;
  
  readonly selectedModelAccuracy: ModelAccuracyType | 'all';
  readonly onModelAccuracyChange: (accuracy: ModelAccuracyType | 'all') => void;
  
  // Data
  readonly cameras: readonly Camera[];
  readonly organizations: readonly Organization[];
  readonly camerasLoading: boolean;
  readonly organizationsLoading: boolean;
  
  // Configuration
  readonly showModelAccuracy?: boolean;
  readonly showFalsePositiveTypes?: boolean;
  
  readonly className?: string;
  readonly defaultTab?: FilterCategory;
  readonly simpleTabLabel?: string;
  readonly advancedTabLabel?: string;
}

/**
 * Source API options for the dropdown
 * 
 * @pure Constant configuration array
 */
const SOURCE_API_OPTIONS = [
  { value: 'pyronear_french', label: 'Pyronear French' },
  { value: 'alert_wildfire', label: 'Alert Wildfire' },
  { value: 'api_cenia', label: 'API Cenia' },
] as const;

/**
 * Refactored tabbed filters component using functional patterns
 * 
 * This component provides a tabbed interface for filtering sequences with:
 * - Simple tab: Basic camera and organization filters
 * - Advanced tab: All filters including date range and advanced options
 * - Shared components for consistent UI
 * - Pure state management utilities
 * - Proper accessibility and TypeScript safety
 * 
 * @param props - Tabbed filter configuration
 * @returns JSX element for tabbed filter interface
 * 
 * @example
 * <TabbedFiltersRefactored
 *   filters={currentFilters}
 *   onFiltersChange={handleFiltersChange}
 *   dateFrom={dateFrom}
 *   dateTo={dateTo}
 *   onDateFromChange={setDateFrom}
 *   onDateToChange={setDateTo}
 *   cameras={cameras}
 *   organizations={organizations}
 *   showModelAccuracy={true}
 * />
 */
export default function TabbedFiltersRefactored({
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
  selectedModelAccuracy,
  onModelAccuracyChange,
  cameras,
  organizations,
  camerasLoading,
  organizationsLoading,
  showModelAccuracy = false,
  showFalsePositiveTypes = false,
  className = '',
  defaultTab = 'simple',
  simpleTabLabel = 'Simple',
  advancedTabLabel = 'Advanced',
}: TabbedFiltersRefactoredProps) {
  const [activeTab, setActiveTab] = useState<FilterCategory>(defaultTab);

  // Create filter state object for utility functions
  const filterState: ExtendedFilterState = {
    filters,
    dateFrom,
    dateTo,
    selectedFalsePositiveTypes,
    selectedModelAccuracy
  };

  // Create option arrays using pure utility functions
  const cameraOptions = createOptionsFromItems(cameras, 'name', 'name');
  const organizationOptions = createOptionsFromItems(organizations, 'name', 'name');
  const wildfireOptions = createBooleanOptions({
    allLabel: 'All',
    trueLabel: 'Wildfire Alert',
    falseLabel: 'No Alert'
  });

  /**
   * Calculates active filter count for simple tab
   * 
   * @pure Function uses utility for consistent counting
   */
  const simpleFilterCount = countActiveFilters(filterState, 'simple', {
    includeSharedFilters: true,
    includeAdvancedFilters: false,
    showModelAccuracy,
    showFalsePositiveTypes: false
  });

  /**
   * Calculates active filter count for advanced tab
   * 
   * @pure Function uses utility for consistent counting
   */
  const advancedFilterCount = countActiveFilters(filterState, 'advanced', {
    includeSharedFilters: true,
    includeAdvancedFilters: true,
    showModelAccuracy,
    showFalsePositiveTypes
  });

  /**
   * Handles tab switching with proper state transitions
   * 
   * Uses pure utility function to calculate state changes
   */
  const handleTabSwitch = (newTab: FilterCategory) => {
    if (newTab === activeTab) return;
    
    const transition = calculateTabTransition(filterState, newTab);
    
    // Apply filter changes
    onFiltersChange(transition.newFilters);
    
    // Apply reset values if provided
    if (transition.resetValues) {
      if (transition.resetValues.dateFrom !== undefined) {
        onDateFromChange(transition.resetValues.dateFrom);
      }
      if (transition.resetValues.dateTo !== undefined) {
        onDateToChange(transition.resetValues.dateTo);
      }
      if (transition.resetValues.selectedFalsePositiveTypes) {
        onFalsePositiveTypesChange([...transition.resetValues.selectedFalsePositiveTypes]);
      }
    }
    
    setActiveTab(newTab);
  };

  /**
   * Handles camera selection changes
   */
  const handleCameraChange = (value: string | undefined) => {
    onFiltersChange({ camera_name: value });
  };

  /**
   * Handles organization selection changes
   */
  const handleOrganizationChange = (value: string | undefined) => {
    onFiltersChange({ organisation_name: value });
  };

  /**
   * Handles source API selection changes
   */
  const handleSourceApiChange = (value: string | undefined) => {
    onFiltersChange({ source_api: value as any });
  };

  /**
   * Handles wildfire alert selection changes
   */
  const handleWildfireAlertChange = (value: string | undefined) => {
    const booleanValue = parseBooleanValue(value || '');
    onFiltersChange({ is_wildfire_alertapi: booleanValue });
  };

  /**
   * Handles date range preset selection
   */
  const handleDatePresetSelect = (preset: string) => {
    const { dateFrom: newDateFrom, dateTo: newDateTo } = calculatePresetDateRange(preset);
    onDateFromChange(newDateFrom);
    onDateToChange(newDateTo);
    onDateRangeSet(preset);
  };

  /**
   * Renders simple tab content with shared filters only
   * 
   * @pure Function renders consistent UI for same props
   */
  const renderSimpleFilters = () => (
    <>
      <SelectFilter
        label="Camera"
        value={filters.camera_name}
        onChange={handleCameraChange}
        options={cameraOptions}
        placeholder="All Cameras"
        disabled={camerasLoading}
        data-testid="camera-select"
      />

      <SelectFilter
        label="Organization"
        value={filters.organisation_name}
        onChange={handleOrganizationChange}
        options={organizationOptions}
        placeholder="All Organizations"
        disabled={organizationsLoading}
        data-testid="organization-select"
      />

      {showModelAccuracy && (
        <ModelAccuracyFilter
          selectedAccuracy={selectedModelAccuracy}
          onSelectionChange={onModelAccuracyChange}
          className="w-full"
        />
      )}
    </>
  );

  /**
   * Renders advanced tab content with all filters
   * 
   * @pure Function renders consistent UI for same props
   */
  const renderAdvancedFilters = () => (
    <>
      <SelectFilter
        label="Camera"
        value={filters.camera_name}
        onChange={handleCameraChange}
        options={cameraOptions}
        placeholder="All Cameras"
        disabled={camerasLoading}
        data-testid="camera-select-advanced"
      />

      <SelectFilter
        label="Organization"
        value={filters.organisation_name}
        onChange={handleOrganizationChange}
        options={organizationOptions}
        placeholder="All Organizations"
        disabled={organizationsLoading}
        data-testid="organization-select-advanced"
      />

      <SelectFilter
        label="Source API"
        value={filters.source_api}
        onChange={handleSourceApiChange}
        options={SOURCE_API_OPTIONS}
        placeholder="All Sources"
        data-testid="source-api-select"
      />

      <SelectFilter
        label="Wildfire Alert"
        value={filters.is_wildfire_alertapi?.toString() || ''}
        onChange={handleWildfireAlertChange}
        options={wildfireOptions}
        placeholder="All"
        data-testid="wildfire-alert-select"
      />

      {showModelAccuracy && (
        <ModelAccuracyFilter
          selectedAccuracy={selectedModelAccuracy}
          onSelectionChange={onModelAccuracyChange}
          className="w-full"
        />
      )}

      <DateRangeFilter
        label="Date Range (Recorded)"
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        onPresetSelect={handleDatePresetSelect}
        onClear={onDateRangeClear}
        className="md:col-span-3"
        data-testid="date-range-filter"
      />

      {showFalsePositiveTypes && (
        <div className="md:col-span-3">
          <FalsePositiveFilter
            selectedTypes={selectedFalsePositiveTypes}
            onSelectionChange={onFalsePositiveTypesChange}
            className="w-full"
          />
        </div>
      )}
    </>
  );

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'simple'}
            aria-controls="simple-tab-panel"
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
              {simpleFilterCount > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  {simpleFilterCount}
                </span>
              )}
            </div>
          </button>
          
          <button
            role="tab"
            aria-selected={activeTab === 'advanced'}
            aria-controls="advanced-tab-panel"
            onClick={() => handleTabSwitch('advanced')}
            className={clsx(
              'py-3 px-6 text-sm font-medium rounded-tr-lg transition-colors duration-200',
              activeTab === 'advanced'
                ? 'border-b-2 border-primary-500 text-primary-600 bg-primary-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <div className="flex items-center space-x-2">
              <span>{advancedTabLabel}</span>
              {advancedFilterCount > 0 && (
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  {advancedFilterCount}
                </span>
              )}
            </div>
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="p-4">
        <div
          role="tabpanel"
          id="simple-tab-panel"
          aria-labelledby="simple-tab"
          className={clsx(
            'transition-all duration-200 ease-in-out',
            activeTab === 'simple' ? 'opacity-100 visible' : 'opacity-0 invisible h-0 overflow-hidden'
          )}
        >
          {activeTab === 'simple' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {renderSimpleFilters()}
            </div>
          )}
        </div>

        <div
          role="tabpanel"
          id="advanced-tab-panel"
          aria-labelledby="advanced-tab"
          className={clsx(
            'transition-all duration-200 ease-in-out',
            activeTab === 'advanced' ? 'opacity-100 visible' : 'opacity-0 invisible h-0 overflow-hidden'
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