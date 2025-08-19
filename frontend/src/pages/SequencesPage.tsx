import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, ProcessingStageStatus } from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { getProcessingStageLabel, getProcessingStageColorClass } from '@/utils/processingStage';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getRowBackgroundClasses,
  parseFalsePositiveTypes
} from '@/utils/modelAccuracy';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import TabbedFilters from '@/components/filters/TabbedFilters';
import { useSequenceStore } from '@/store/useSequenceStore';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/DateRangeFilter';

interface SequencesPageProps {
  defaultProcessingStage?: ProcessingStageStatus;
}


export default function SequencesPage({ defaultProcessingStage = 'ready_to_annotate' }: SequencesPageProps = {}) {
  const navigate = useNavigate();
  const { startAnnotationWorkflow } = useSequenceStore();

  // Determine storage key based on processing stage to separate annotate vs review filters
  const storageKey = defaultProcessingStage === 'annotated' 
    ? 'filters-sequences-review' 
    : 'filters-sequences-annotate';

  // Use persisted filters hook
  const {
    filters,
    dateFrom,
    dateTo,
    selectedFalsePositiveTypes,
    selectedModelAccuracy,
    setFilters,
    setDateFrom,
    setDateTo,
    setSelectedFalsePositiveTypes,
    setSelectedFalsePositiveTypesAndFilters,
    setSelectedModelAccuracy,
    resetFilters,
  } = usePersistedFilters(
    storageKey,
    createDefaultFilterState(defaultProcessingStage)
  );


  // Fetch cameras and organizations for dropdown options
  const { data: cameras = [], isLoading: camerasLoading } = useCameras();
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations();

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


  // Fetch sequences with annotations in a single efficient call
  const { data: sequences, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'with-annotations', filters],
    queryFn: () => apiClient.getSequencesWithAnnotations(filters),
  });

  // Filter sequences by model accuracy (only for review page)
  const filteredSequences = useMemo(() => {
    if (!sequences || selectedModelAccuracy === 'all' || defaultProcessingStage !== 'annotated') {
      return sequences;
    }

    const filtered = sequences.items.filter(sequence => {
      if (!sequence.annotation) {
        return selectedModelAccuracy === 'unknown';
      }

      const accuracy = analyzeSequenceAccuracy(sequence);
      return accuracy.type === selectedModelAccuracy;
    });

    return {
      ...sequences,
      items: filtered,
      total: filtered.length,
      pages: Math.ceil(filtered.length / sequences.size)
    };
  }, [sequences, selectedModelAccuracy, defaultProcessingStage]);

  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters({ ...filters, ...newFilters, page: 1 });
  };

  const handleFalsePositiveFilterChangeV2 = (selectedTypes: string[]) => {
    setSelectedFalsePositiveTypes(selectedTypes);
  };

  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
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
          onFalsePositiveTypesChange={handleFalsePositiveFilterChangeV2}
          selectedModelAccuracy={selectedModelAccuracy}
          onModelAccuracyChange={setSelectedModelAccuracy}
          onResetFilters={resetFilters}
          cameras={cameras}
          organizations={organizations}
          camerasLoading={camerasLoading}
          organizationsLoading={organizationsLoading}
          showModelAccuracy={defaultProcessingStage === 'annotated'}
          showFalsePositiveTypes={defaultProcessingStage === 'annotated'}
        />

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
        onFalsePositiveTypesChange={handleFalsePositiveFilterChangeV2}
        selectedModelAccuracy={selectedModelAccuracy}
        onModelAccuracyChange={setSelectedModelAccuracy}
        onResetFilters={resetFilters}
        cameras={cameras}
        organizations={organizations}
        camerasLoading={camerasLoading}
        organizationsLoading={organizationsLoading}
        showModelAccuracy={defaultProcessingStage === 'annotated'}
        showFalsePositiveTypes={defaultProcessingStage === 'annotated'}
      />

      {/* Results */}
      {filteredSequences && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {((filteredSequences.page - 1) * filteredSequences.size) + 1} to{' '}
                {Math.min(filteredSequences.page * filteredSequences.size, filteredSequences.total)} of{' '}
                {filteredSequences.total} results
                {selectedModelAccuracy !== 'all' && defaultProcessingStage === 'annotated' && sequences && (
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

          {/* Row Background Color Legend - Only show on review page */}
          {defaultProcessingStage === 'annotated' && (
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
          )}

          {/* Sequence List */}
          <div className="divide-y divide-gray-200">
            {filteredSequences.items.map((sequence) => {
              // Calculate row background based on model accuracy for review pages
              let rowClasses = "p-4 cursor-pointer";
              if (defaultProcessingStage === 'annotated' && sequence.annotation) {
                const accuracy = analyzeSequenceAccuracy(sequence);
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
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            🔥 Wildfire Alert
                          </span>
                        )}
                        {/* Processing stage pill - conditionally hidden based on page context */}
                        {(() => {
                          const processingStage = sequence.annotation?.processing_stage || 'no_annotation';
                          // Hide "ready_to_annotate" pills on annotate page, hide "annotated" pills on review page
                          const shouldHidePill = (
                            (defaultProcessingStage === 'ready_to_annotate' && processingStage === 'ready_to_annotate') ||
                            (defaultProcessingStage === 'annotated' && processingStage === 'annotated')
                          );

                          if (shouldHidePill) return null;

                          return (
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getProcessingStageColorClass(processingStage)}`}>
                              {getProcessingStageLabel(processingStage)}
                            </span>
                          );
                        })()}
                      </div>

                      <div className="mt-2 flex items-center text-sm text-gray-500 space-x-2">
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
                    </div>

                    {/* False Positive Pills - Top Right Area (Review page only) */}
                    {defaultProcessingStage === 'annotated' && sequence.annotation && (
                      <div className="flex-shrink-0 self-start">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {(() => {
                            const falsePositiveTypes = parseFalsePositiveTypes(sequence.annotation.false_positive_types);
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
