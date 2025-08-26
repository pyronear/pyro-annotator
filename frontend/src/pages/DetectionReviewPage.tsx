import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, SequenceWithDetectionProgress } from '@/types/api';
import { QUERY_KEYS, PAGINATION_OPTIONS } from '@/utils/constants';
import {
  analyzeSequenceAccuracy,
  getRowBackgroundClasses,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  parseFalsePositiveTypes,
  getSmokeTypeEmoji,
  formatSmokeType
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import TabbedFilters from '@/components/filters/TabbedFilters';
import ContributorList from '@/components/ui/ContributorList';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/DateRangeFilter';
import { hasActiveUserFilters } from '@/utils/filterHelpers';

export default function DetectionReviewPage() {
  const navigate = useNavigate();

  // Create default state specific to detection review page
  const defaultState = {
    ...createDefaultFilterState('annotated'),
    filters: {
      ...createDefaultFilterState('annotated').filters,
      detection_annotation_completion: 'complete' as const,
      include_detection_stats: true,
      processing_stage: 'annotated' as const, // Only show sequences that have completed sequence-level annotation
      is_unsure: false, // Exclude unsure sequences from detection annotation workflow
    },
  };

  // Use persisted filters hook
  const {
    filters,
    dateFrom,
    dateTo,
    selectedFalsePositiveTypes,
    selectedSmokeTypes,
    selectedModelAccuracy,
    setFilters,
    setDateFrom,
    setDateTo,
    setSelectedFalsePositiveTypes,
    setSelectedSmokeTypes,
    setSelectedModelAccuracy,
    resetFilters,
  } = usePersistedFilters('filters-detections-review', defaultState);

  // Fetch cameras, organizations, and source APIs for dropdown options
  const { data: cameras = [], isLoading: camerasLoading } = useCameras();
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations();
  const { data: sourceApis = [], isLoading: sourceApisLoading } = useSourceApis();

  // Date range helper functions
  const setDateRange = (preset: string) => {
    const { dateFrom: startDateStr, dateTo: endDateStr } = calculatePresetDateRange(preset);

    setDateFrom(startDateStr);
    setDateTo(endDateStr);

    // Convert to API datetime format if dates are valid
    const startDateTime = startDateStr ? startDateStr + 'T00:00:00' : undefined;
    const endDateTime = endDateStr ? endDateStr + 'T23:59:59' : undefined;

    handleFilterChange({
      recorded_at_gte: startDateTime,
      recorded_at_lte: endDateTime
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
    setFilters({ ...filters, ...newFilters, page: 1 });
  };

  const handleFalsePositiveFilterChange = (selectedTypes: string[]) => {
    // Only call setSelectedFalsePositiveTypes (which now does atomic update)
    setSelectedFalsePositiveTypes(selectedTypes);
  };

  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
  };

  const handleSequenceClick = (clickedSequence: SequenceWithDetectionProgress) => {
    // Navigate to detection annotation interface for review purposes
    navigate(`/detections/${clickedSequence.id}/annotate?from=detections-review`);
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

  // Empty state when no sequences are available for review
  if (filteredSequences && filteredSequences.items.length === 0) {
    // Check if user has applied filters
    const hasFilters = hasActiveUserFilters(
      filters,
      dateFrom,
      dateTo,
      selectedFalsePositiveTypes,
      selectedSmokeTypes,
      selectedModelAccuracy,
      'all', // selectedUnsure
      true, // showModelAccuracy
      true, // showFalsePositiveTypes
      true, // showSmokeTypes
      false // showUnsureFilter
    );

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detections</h1>
            <p className="text-gray-600">
              Review and verify annotated wildfire detections
            </p>
          </div>
        </div>

        {/* Filters */}
        <TabbedFilters
          filters={filters}
          onFiltersChange={handleFilterChange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={handleDateFromChange}
          onDateToChange={handleDateToChange}
          onDateRangeSet={setDateRange}
          onDateRangeClear={clearDateRange}
          selectedFalsePositiveTypes={selectedFalsePositiveTypes}
          onFalsePositiveTypesChange={handleFalsePositiveFilterChange}
          selectedSmokeTypes={selectedSmokeTypes}
          onSmokeTypesChange={setSelectedSmokeTypes}
          selectedModelAccuracy={selectedModelAccuracy}
          onModelAccuracyChange={setSelectedModelAccuracy}
          onResetFilters={resetFilters}
          cameras={cameras}
          organizations={organizations}
          sourceApis={sourceApis}
          camerasLoading={camerasLoading}
          organizationsLoading={organizationsLoading}
          sourceApisLoading={sourceApisLoading}
          showModelAccuracy={true}
          showFalsePositiveTypes={true}
          showSmokeTypes={true}
        />

        {/* Empty state message */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            {hasFilters ? (
              // Filtered results - no matches
              <>
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No matching sequences found</h3>
                <p className="text-gray-500 mb-4">
                  No sequences with completed detection annotations match your current filters.
                </p>
                <p className="text-gray-400 text-sm">Try adjusting your search criteria above.</p>
              </>
            ) : (
              // No filters - no sequences available
              <p className="text-gray-500">No sequences with completed detection annotations to review at the moment.</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Detection Review</h1>
          <p className="text-gray-600">
            Review and verify annotated wildfire detections
          </p>
        </div>
      </div>

      {/* Filters */}
      <TabbedFilters
        filters={filters}
        onFiltersChange={handleFilterChange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={handleDateFromChange}
        onDateToChange={handleDateToChange}
        onDateRangeSet={setDateRange}
        onDateRangeClear={clearDateRange}
        selectedFalsePositiveTypes={selectedFalsePositiveTypes}
        onFalsePositiveTypesChange={handleFalsePositiveFilterChange}
        selectedModelAccuracy={selectedModelAccuracy}
        onModelAccuracyChange={setSelectedModelAccuracy}
        onResetFilters={resetFilters}
        cameras={cameras}
        organizations={organizations}
        sourceApis={sourceApis}
        camerasLoading={camerasLoading}
        organizationsLoading={organizationsLoading}
        sourceApisLoading={sourceApisLoading}
        showModelAccuracy={true}
        showFalsePositiveTypes={true}
        selectedSmokeTypes={selectedSmokeTypes}
        onSmokeTypesChange={setSelectedSmokeTypes}
        showSmokeTypes={true}
      />

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
                  {PAGINATION_OPTIONS.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
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
                  <div className="w-3 h-3 bg-orange-200 border border-orange-300 rounded"></div>
                  <span className="text-gray-600">Smoke Types</span>
                </div>
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

                        {sequence.azimuth !== null && sequence.azimuth !== undefined && (
                          <>
                            <span className="text-gray-400">•</span>
                            <span className="text-gray-400 text-xs">
                              Azimuth: {sequence.azimuth}°
                            </span>
                          </>
                        )}
                      </div>

                    </div>

                    {/* Right Column - False Positive Pills and Contributors */}
                    {annotation && (
                      <div className="flex-shrink-0 self-start">
                        <div className="flex flex-col gap-2">
                          {/* False Positive Pills */}
                          <div className="flex flex-wrap gap-1 justify-end">
                            {(() => {
                              const falsePositiveTypes = parseFalsePositiveTypes(annotation.false_positive_types);
                              return falsePositiveTypes.map((type: string) => (
                                <span
                                  key={type}
                                  className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                                >
                                  {getFalsePositiveEmoji(type)} {formatFalsePositiveType(type)}
                                </span>
                              ));
                            })()}
                          </div>
                          {/* Smoke Type Pills */}
                          <div className="flex flex-wrap gap-1 justify-end">
                            {annotation.smoke_types?.map((type: string) => (
                              <span
                                key={type}
                                className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
                              >
                                {getSmokeTypeEmoji(type)} {formatSmokeType(type)}
                              </span>
                            ))}
                          </div>

                          {/* Contributors - Bottom Right */}
                          {annotation.contributors && annotation.contributors.length > 0 && (
                            <div className="flex justify-end">
                              <ContributorList
                                contributors={annotation.contributors}
                                displayMode="compact"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

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
