import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, ProcessingStageStatus } from '@/types/api';
import { QUERY_KEYS, PAGINATION_DEFAULTS } from '@/utils/constants';
import { getProcessingStageLabel, getProcessingStageColorClass } from '@/utils/processingStage';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { useSequenceStore } from '@/store/useSequenceStore';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';

interface SequencesPageProps {
  defaultProcessingStage?: ProcessingStageStatus;
}

// Emoji mapping for false positive types
const getFalsePositiveEmoji = (type: string): string => {
  const emojiMap: Record<string, string> = {
    antenna: '📡',
    building: '🏢',
    cliff: '⛰️',
    dark: '🌚',
    dust: '🌪️',
    high_cloud: '☁️',
    low_cloud: '☁️',
    lens_flare: '✨',
    lens_droplet: '💧',
    light: '💡',
    rain: '🌧️',
    trail: '🛤️',
    road: '🛣️',
    sky: '🌌',
    tree: '🌳',
    water_body: '🌊',
    other: '❓'
  };
  return emojiMap[type] || '❓';
};

export default function SequencesPage({ defaultProcessingStage = 'ready_to_annotate' }: SequencesPageProps = {}) {
  const navigate = useNavigate();
  const { startAnnotationWorkflow } = useSequenceStore();
  
  const [filters, setFilters] = useState<ExtendedSequenceFilters>({
    page: PAGINATION_DEFAULTS.PAGE,
    size: PAGINATION_DEFAULTS.SIZE,
    processing_stage: defaultProcessingStage,
  });

  // Fetch cameras and organizations for dropdown options
  const { data: cameras = [], isLoading: camerasLoading } = useCameras();
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations();

  // Date range state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Date range helper functions
  const setDateRange = (preset: string) => {
    const now = new Date();
    const endDateStr = now.toISOString().split('T')[0]; // Today for UI display
    const endDateTime = endDateStr + 'T23:59:59'; // End of day for API
    let startDateStr = '';
    let startDateTime = '';

    switch (preset) {
      case '7d':
        startDateStr = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        startDateTime = startDateStr + 'T00:00:00';
        break;
      case '30d':
        startDateStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        startDateTime = startDateStr + 'T00:00:00';
        break;
      case '90d':
        startDateStr = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        startDateTime = startDateStr + 'T00:00:00';
        break;
    }

    setDateFrom(startDateStr);
    setDateTo(endDateStr);
    handleFilterChange({ 
      recorded_at_gte: startDateTime || undefined, 
      recorded_at_lte: endDateTime || undefined 
    });
  };

  const clearDateRange = () => {
    setDateFrom('');
    setDateTo('');
    handleFilterChange({ recorded_at_gte: undefined, recorded_at_lte: undefined });
  };

  // Update filters when date range changes
  const handleDateFromChange = (value: string) => {
    setDateFrom(value);
    const dateTimeValue = value ? value + 'T00:00:00' : undefined;
    handleFilterChange({ recorded_at_gte: dateTimeValue });
  };

  const handleDateToChange = (value: string) => {
    setDateTo(value);
    const dateTimeValue = value ? value + 'T23:59:59' : undefined;
    handleFilterChange({ recorded_at_lte: dateTimeValue });
  };


  // Fetch sequences with annotations in a single efficient call
  const { data: sequences, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'with-annotations', filters],
    queryFn: () => apiClient.getSequencesWithAnnotations(filters),
  });

  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleSequenceClick = (clickedSequence: any) => {
    // Initialize annotation workflow if we have sequences data
    if (sequences?.items) {
      startAnnotationWorkflow(sequences.items, clickedSequence.id, filters);
    }
    
    // Navigate to annotation interface with context about source page
    const queryParam = defaultProcessingStage === 'annotated' ? '?from=review' : '';
    navigate(`/sequences/${clickedSequence.id}/annotate${queryParam}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load sequences</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
        </div>
      </div>
    );
  }

  // Empty state when no sequences are available
  if (sequences && sequences.items.length === 0) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sequences</h1>
            <p className="text-gray-600">
              Manage and annotate wildfire detection sequences
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Source API
                </label>
                <select
                  value={filters.source_api || ''}
                  onChange={(e) => handleFilterChange({ source_api: e.target.value as any || undefined })}
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
                  Camera
                </label>
                <select
                  value={filters.camera_name || ''}
                  onChange={(e) => handleFilterChange({ camera_name: e.target.value || undefined })}
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
                  onChange={(e) => handleFilterChange({ organisation_name: e.target.value || undefined })}
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
                  Wildfire Alert
                </label>
                <select
                  value={filters.is_wildfire_alertapi === undefined ? '' : filters.is_wildfire_alertapi.toString()}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleFilterChange({ 
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date Range (Recorded)
                </label>
                
                {/* Preset Buttons */}
                <div className="flex gap-1 mb-2">
                  <button
                    onClick={() => setDateRange('7d')}
                    className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
                  >
                    7d
                  </button>
                  <button
                    onClick={() => setDateRange('30d')}
                    className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
                  >
                    30d
                  </button>
                  <button
                    onClick={() => setDateRange('90d')}
                    className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
                  >
                    90d
                  </button>
                  <button
                    onClick={clearDateRange}
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
                    onChange={(e) => handleDateFromChange(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
                    placeholder="From"
                  />
                  <input 
                    type="date" 
                    value={dateTo} 
                    onChange={(e) => handleDateToChange(e.target.value)} 
                    className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
                    placeholder="To"
                  />
                </div>
              </div>

          </div>
        </div>

        {/* Empty state message */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            {defaultProcessingStage === 'annotated' ? (
              // Review page - simple message without celebration
              <p className="text-gray-500">No completed sequences to review at the moment.</p>
            ) : (
              // Annotation page - celebratory message
              <>
                <div className="text-6xl mb-4">🎉</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">All caught up!</h3>
                <p className="text-gray-500">No sequences available for annotation at the moment.</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sequences</h1>
          <p className="text-gray-600">
            Manage and annotate wildfire detection sequences
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source API
              </label>
              <select
                value={filters.source_api || ''}
                onChange={(e) => handleFilterChange({ source_api: e.target.value as any || undefined })}
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
                Camera
              </label>
              <select
                value={filters.camera_name || ''}
                onChange={(e) => handleFilterChange({ camera_name: e.target.value || undefined })}
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
                onChange={(e) => handleFilterChange({ organisation_name: e.target.value || undefined })}
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
                Wildfire Alert
              </label>
              <select
                value={filters.is_wildfire_alertapi === undefined ? '' : filters.is_wildfire_alertapi.toString()}
                onChange={(e) => {
                  const value = e.target.value;
                  handleFilterChange({ 
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

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date Range (Recorded)
              </label>
              
              {/* Preset Buttons */}
              <div className="flex gap-1 mb-2">
                <button
                  onClick={() => setDateRange('7d')}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
                >
                  7d
                </button>
                <button
                  onClick={() => setDateRange('30d')}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
                >
                  30d
                </button>
                <button
                  onClick={() => setDateRange('90d')}
                  className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 focus:ring-1 focus:ring-primary-500"
                >
                  90d
                </button>
                <button
                  onClick={clearDateRange}
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
                  onChange={(e) => handleDateFromChange(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
                  placeholder="From"
                />
                <input 
                  type="date" 
                  value={dateTo} 
                  onChange={(e) => handleDateToChange(e.target.value)} 
                  className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-primary-500 focus:border-primary-500"
                  placeholder="To"
                />
              </div>
            </div>

        </div>
      </div>

      {/* Results */}
      {sequences && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {((sequences.page - 1) * sequences.size) + 1} to{' '}
                {Math.min(sequences.page * sequences.size, sequences.total)} of{' '}
                {sequences.total} results
              </p>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700">Show:</label>
                <select
                  value={filters.size}
                  onChange={(e) => handleFilterChange({ size: Number(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>

          {/* Sequence List */}
          <div className="divide-y divide-gray-200">
            {sequences.items.map((sequence) => (
              <div 
                key={sequence.id} 
                className="p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => handleSequenceClick(sequence)}
              >
                <div className="flex items-center space-x-4">
                  {/* Detection Image Thumbnail */}
                  <div className="flex-shrink-0">
                    <DetectionImageThumbnail 
                      sequenceId={sequence.id} 
                      className="h-16"
                    />
                  </div>
                  
                  {/* Sequence Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {sequence.camera_name}
                      </h3>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {sequence.source_api}
                      </span>
                      {sequence.is_wildfire_alertapi && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          🔥 Wildfire Alert
                        </span>
                      )}
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getProcessingStageColorClass(sequence.annotation?.processing_stage || 'no_annotation')}`}>
                        {getProcessingStageLabel(sequence.annotation?.processing_stage || 'no_annotation')}
                      </span>
                    </div>
                    
                    {/* Annotation Details - Only show for annotated sequences (review page) */}
                    {defaultProcessingStage === 'annotated' && sequence.annotation && (
                      <div className="mt-2 flex items-center flex-wrap gap-2">
                        {/* Smoke Detection Badge */}
                        {sequence.annotation.has_smoke ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            💨 Smoke Detected
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            ✅ No Smoke
                          </span>
                        )}

                        {/* False Positive Types */}
                        {(() => {
                          try {
                            const falsePositiveTypes = sequence.annotation.false_positive_types 
                              ? JSON.parse(sequence.annotation.false_positive_types) 
                              : [];
                            return falsePositiveTypes.map((type: string) => (
                              <span 
                                key={type} 
                                className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                              >
                                {getFalsePositiveEmoji(type)} {type.replace(/_/g, ' ')}
                              </span>
                            ));
                          } catch (e) {
                            return null;
                          }
                        })()}

                        {/* Missed Smoke Warning */}
                        {sequence.annotation.has_missed_smoke && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            🚨 Missed Smoke
                          </span>
                        )}
                      </div>
                    )}

                    <div className="mt-1 flex items-center text-sm text-gray-500 space-x-4">
                      <span>{new Date(sequence.recorded_at).toLocaleString()}</span>
                      <span>Org: {sequence.organisation_name}</span>
                    </div>
                    {sequence.azimuth && (
                      <div className="mt-1 text-xs text-gray-400">
                        Azimuth: {sequence.azimuth}°
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {sequences.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(sequences.page - 1)}
                  disabled={sequences.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {sequences.page} of {sequences.pages}
                </span>
                <button
                  onClick={() => handlePageChange(sequences.page + 1)}
                  disabled={sequences.page === sequences.pages}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}