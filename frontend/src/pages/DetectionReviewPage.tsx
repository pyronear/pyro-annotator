import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, SequenceWithDetectionProgress } from '@/types/api';
import { QUERY_KEYS, PAGINATION_DEFAULTS } from '@/utils/constants';
import {
  analyzeSequenceAccuracy,
  getRowBackgroundClasses,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  ModelAccuracyType
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import FalsePositiveFilter from '@/components/filters/FalsePositiveFilter';
import ModelAccuracyFilter from '@/components/filters/ModelAccuracyFilter';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';

export default function DetectionReviewPage() {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<ExtendedSequenceFilters>({
    page: PAGINATION_DEFAULTS.PAGE,
    size: PAGINATION_DEFAULTS.SIZE,
    detection_annotation_completion: 'complete',
    include_detection_stats: true,
    processing_stage: 'annotated', // Only show sequences that have completed sequence-level annotation
  });

  // Fetch cameras and organizations for dropdown options
  const { data: cameras = [], isLoading: camerasLoading } = useCameras();
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations();

  // Date range state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // False positive filter state
  const [selectedFalsePositiveTypes, setSelectedFalsePositiveTypes] = useState<string[]>([]);

  // Model accuracy filter state
  const [selectedModelAccuracy, setSelectedModelAccuracy] = useState<ModelAccuracyType | 'all'>('all');

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

  // Fetch sequences with complete detection annotations
  const { data: sequences, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-review', filters],
    queryFn: () => apiClient.getSequences(filters),
  });

  // Fetch sequence annotations for model accuracy analysis
  const { data: sequenceAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'detection-review', sequences?.items?.map(s => s.id)],
    queryFn: async () => {
      if (!sequences?.items?.length) return [];

      const annotationPromises = sequences.items.map(sequence =>
        apiClient.getSequenceAnnotations({ sequence_id: sequence.id, size: 1 })
          .then(response => ({ sequenceId: sequence.id, annotation: response.items[0] || null }))
          .catch(() => ({ sequenceId: sequence.id, annotation: null }))
      );

      return Promise.all(annotationPromises);
    },
    enabled: !!sequences?.items?.length,
  });

  // Create a map for quick annotation lookup
  const annotationMap = sequenceAnnotations?.reduce((acc, { sequenceId, annotation }) => {
    acc[sequenceId] = annotation;
    return acc;
  }, {} as Record<number, any>) || {};

  // Filter sequences by model accuracy
  const filteredSequences = useMemo(() => {
    if (!sequences || selectedModelAccuracy === 'all') {
      return sequences;
    }

    const filtered = sequences.items.filter(sequence => {
      const annotation = annotationMap[sequence.id];
      if (!annotation) {
        return selectedModelAccuracy === 'unknown';
      }

      const accuracy = analyzeSequenceAccuracy({
        ...sequence,
        annotation: annotation
      });
      
      return accuracy.type === selectedModelAccuracy;
    });

    return {
      ...sequences,
      items: filtered,
      total: filtered.length,
      pages: Math.ceil(filtered.length / sequences.size)
    };
  }, [sequences, annotationMap, selectedModelAccuracy]);

  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  const handleFalsePositiveFilterChange = (selectedTypes: string[]) => {
    setSelectedFalsePositiveTypes(selectedTypes);
    handleFilterChange({
      false_positive_types: selectedTypes.length > 0 ? selectedTypes : undefined
    });
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleSequenceClick = (clickedSequence: SequenceWithDetectionProgress) => {
    // Navigate to detection annotation interface for review purposes
    navigate(`/detections/${clickedSequence.id}/annotate`);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Detection Review</h1>
          <p className="text-gray-600">
            Sequences with completed detection annotations ready for review
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 lg:grid-cols-7 gap-4">
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

          {/* False Positive Filter */}
          <FalsePositiveFilter
            selectedTypes={selectedFalsePositiveTypes}
            onSelectionChange={handleFalsePositiveFilterChange}
            className="w-full"
          />

          {/* Model Accuracy Filter */}
          <ModelAccuracyFilter
            selectedAccuracy={selectedModelAccuracy}
            onSelectionChange={setSelectedModelAccuracy}
            className="w-full"
          />
        </div>
      </div>

      {/* Results */}
      {filteredSequences && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {((filteredSequences.page - 1) * filteredSequences.size) + 1} to{' '}
                {Math.min(filteredSequences.page * filteredSequences.size, filteredSequences.total)} of{' '}
                {filteredSequences.total} fully annotated sequences
                {selectedModelAccuracy !== 'all' && sequences && (
                  <span className="text-gray-500"> (filtered from {sequences.total} total)</span>
                )}
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

          {/* Row Background Color Legend */}
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center space-x-6">
                <span className="font-medium text-gray-700">Row Colors:</span>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-green-200 border border-green-300 rounded"></div>
                  <span className="text-gray-600">True Positive (Model correct)</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-red-200 border border-red-300 rounded"></div>
                  <span className="text-gray-600">False Positive (Model incorrect)</span>
                </div>
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-blue-200 border border-blue-300 rounded"></div>
                  <span className="text-gray-600">False Negative (Model missed smoke)</span>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1">
                  <div className="w-3 h-3 bg-yellow-200 border border-yellow-300 rounded"></div>
                  <span className="text-gray-600">False Positive Types</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sequence List */}
          <div className="divide-y divide-gray-200">
            {filteredSequences.items.map((sequence) => {
              // Calculate row background based on model accuracy
              let rowClasses = "p-4 cursor-pointer";
              const annotation = annotationMap[sequence.id];
              if (annotation) {
                const accuracy = analyzeSequenceAccuracy({
                  ...sequence,
                  annotation: annotation
                });
                rowClasses = `p-4 cursor-pointer ${getRowBackgroundClasses(accuracy)}`;
              } else {
                rowClasses = "p-4 hover:bg-gray-50 cursor-pointer";
              }

              return (
                <div
                  key={sequence.id}
                  className={rowClasses}
                  onClick={() => handleSequenceClick(sequence)}
                >
                  <div className="flex items-start space-x-4">
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
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                            🔥 Wildfire Alert
                          </span>
                        )}

                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✅ Fully Annotated
                        </span>
                      </div>

                      {/* Detection Progress */}
                      {sequence.detection_annotation_stats && (
                        <div className="mt-2 flex items-center space-x-4">
                          <div className="flex items-center space-x-2">
                            <div className="w-32 bg-gray-200 rounded-full h-2">
                              <div className="bg-green-600 h-2 rounded-full w-full"></div>
                            </div>
                            <span className="text-xs text-green-600 font-medium">
                              {sequence.detection_annotation_stats.annotated_detections}/{sequence.detection_annotation_stats.total_detections} detections completed
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center text-sm text-gray-500 space-x-2">
                        <span>{new Date(sequence.recorded_at).toLocaleString()}</span>
                        <span className="text-gray-400">•</span>
                        <span>{sequence.organisation_name}</span>

                        <span className="text-gray-400">•</span>
                        {sequence.azimuth && (
                          <span className="text-gray-400 text-xs">
                            Azimuth: {sequence.azimuth}°
                          </span>
                        )}
                      </div>
                      {sequence.azimuth && (
                        <div className="mt-1 text-xs text-gray-400">
                          Azimuth: {sequence.azimuth}°
                        </div>
                      )}
                    </div>

                    {/* False Positive Pills - Top Right Area */}
                    {annotation && (
                      <div className="flex-shrink-0 self-start">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {(() => {
                            try {
                              const falsePositiveTypes = annotation.false_positive_types
                                ? JSON.parse(annotation.false_positive_types)
                                : [];
                              return falsePositiveTypes.map((type: string) => (
                                <span
                                  key={type}
                                  className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                                >
                                  {getFalsePositiveEmoji(type)} {formatFalsePositiveType(type)}
                                </span>
                              ));
                            } catch (e) {
                              return null;
                            }
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {filteredSequences.items.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                <p>No sequences with completed detection annotations to review at the moment.</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {filteredSequences.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(filteredSequences.page - 1)}
                  disabled={filteredSequences.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {filteredSequences.page} of {filteredSequences.pages}
                </span>
                <button
                  onClick={() => handlePageChange(filteredSequences.page + 1)}
                  disabled={filteredSequences.page === filteredSequences.pages}
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
