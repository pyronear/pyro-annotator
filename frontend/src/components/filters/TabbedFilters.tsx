import { useState } from 'react';
import { clsx } from 'clsx';
import { ExtendedSequenceFilters } from '@/types/api';
import { ModelAccuracyType } from '@/utils/modelAccuracy';
import ModelAccuracyFilter from './ModelAccuracyFilter';
import FalsePositiveFilter from './FalsePositiveFilter';

interface Camera {
  id: number;
  name: string;
}

interface Organization {
  id: number;
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
  
  selectedModelAccuracy: ModelAccuracyType | 'all';
  onModelAccuracyChange: (accuracy: ModelAccuracyType | 'all') => void;
  
  // Data
  cameras: Camera[];
  organizations: Organization[];
  camerasLoading: boolean;
  organizationsLoading: boolean;
  
  // Configuration
  showModelAccuracy?: boolean; // for review pages only
  showFalsePositiveTypes?: boolean; // for review pages only
  
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
}: TabbedFiltersProps) {
  const [activeTab, setActiveTab] = useState<'simple' | 'advanced'>(defaultTab);

  // Count active filters for each tab
  const countActiveSimpleFilters = () => {
    let count = 0;
    if (filters.camera_name) count++;
    if (filters.organisation_name) count++;
    if (selectedModelAccuracy && selectedModelAccuracy !== 'all' && showModelAccuracy) count++;
    return count;
  };

  const countActiveAdvancedFilters = () => {
    let count = 0;
    // Include simple filters
    if (filters.camera_name) count++;
    if (filters.organisation_name) count++;
    if (selectedModelAccuracy && selectedModelAccuracy !== 'all' && showModelAccuracy) count++;
    // Include advanced-only filters
    if (filters.source_api) count++;
    if (filters.is_wildfire_alertapi !== undefined) count++;
    if (dateFrom || dateTo) count++;
    if (selectedFalsePositiveTypes.length > 0) count++;
    return count;
  };

  // Handle tab switch with migration logic
  const handleTabSwitch = (newTab: 'simple' | 'advanced') => {
    if (newTab === activeTab) return;
    
    // Preserve shared filter values
    const sharedFilters = {
      camera_name: filters.camera_name,
      organisation_name: filters.organisation_name,
    };
    
    if (newTab === 'simple') {
      // Reset advanced-only filters when switching to simple
      onFiltersChange({
        ...sharedFilters,
        source_api: undefined,
        is_wildfire_alertapi: undefined,
        recorded_at_gte: undefined,
        recorded_at_lte: undefined,
      });
      
      // Reset advanced-only states
      onDateFromChange('');
      onDateToChange('');
      onFalsePositiveTypesChange([]);
    } else {
      // When switching to advanced, keep all current values
      onFiltersChange(sharedFilters);
    }
    
    // Model accuracy is preserved in both directions (when available)
    setActiveTab(newTab);
  };

  // Render simple filters (Camera, Organization, Model Accuracy)
  const renderSimpleFilters = () => (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Camera
        </label>
        <select
          value={filters.camera_name || ''}
          onChange={(e) => onFiltersChange({ camera_name: e.target.value || undefined })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
          disabled={camerasLoading}
        >
          <option value="">All Cameras</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.name}>
              {camera.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Organization
        </label>
        <select
          value={filters.organisation_name || ''}
          onChange={(e) => onFiltersChange({ organisation_name: e.target.value || undefined })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
          disabled={organizationsLoading}
        >
          <option value="">All Organizations</option>
          {organizations.map((organization) => (
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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Camera
        </label>
        <select
          value={filters.camera_name || ''}
          onChange={(e) => onFiltersChange({ camera_name: e.target.value || undefined })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
          disabled={camerasLoading}
        >
          <option value="">All Cameras</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.name}>
              {camera.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Organization
        </label>
        <select
          value={filters.organisation_name || ''}
          onChange={(e) => onFiltersChange({ organisation_name: e.target.value || undefined })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
          disabled={organizationsLoading}
        >
          <option value="">All Organizations</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.name}>
              {organization.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Source API
        </label>
        <select
          value={filters.source_api || ''}
          onChange={(e) => onFiltersChange({ source_api: e.target.value as any || undefined })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="">All Sources</option>
          <option value="pyronear_french">Pyronear French</option>
          <option value="alert_wildfire">Alert Wildfire</option>
          <option value="api_cenia">API Cenia</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Wildfire Alert
        </label>
        <select
          value={filters.is_wildfire_alertapi === undefined ? '' : filters.is_wildfire_alertapi.toString()}
          onChange={(e) => {
            const value = e.target.value;
            onFiltersChange({
              is_wildfire_alertapi: value === '' ? undefined : value === 'true'
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

      <div className="md:col-span-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Date Range (Recorded)
        </label>

        {/* Preset Buttons */}
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => onDateRangeSet('7d')}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
          >
            7d
          </button>
          <button
            onClick={() => onDateRangeSet('30d')}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
          >
            30d
          </button>
          <button
            onClick={() => onDateRangeSet('90d')}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
          >
            90d
          </button>
          <button
            onClick={onDateRangeClear}
            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500 text-red-600"
          >
            Clear
          </button>
        </div>

        {/* Date Inputs */}
        <div className="flex gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
            placeholder="To"
          />
        </div>
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
    </>
  );

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
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
              'py-3 px-6 text-sm font-medium rounded-tr-lg transition-colors duration-200',
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
      </div>

      {/* Tab Content */}
      <div className="p-4">
        <div
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