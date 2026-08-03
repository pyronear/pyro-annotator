import { ReactNode, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import {
  ClassifyQueueItem,
  ExtendedSequenceFilters,
  ProcessingStageFilter,
  SequenceWithAnnotation,
} from '@/types/api';
import { PAGINATION_OPTIONS, QUERY_KEYS } from '@/utils/constants';
import { analyzeSequenceAccuracy } from '@/utils/modelAccuracy';
import { getStageFilterLabel, stageFilterIncludes } from '@/utils/processingStage';
import FilterPopover from '@/components/filters/FilterPopover';
import {
  SequencesTableHeader,
  SequencesLegend,
  ClassifyQueueTable,
  ClassifyAlertQueueTable,
  ClassifyDoneTable,
  SequencesPagination,
} from '@/components/sequences';
import { useSequenceStore } from '@/store/useSequenceStore';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/dateRangeUtils';
import { hasActiveUserFilters } from '@/utils/filterHelpers';
import { classifyDetail } from '@/utils/routes';

interface SequencesPageProps {
  defaultProcessingStage?: ProcessingStageFilter;
  isReviewPage?: boolean;
  stageSelector?: ReactNode;
}

export default function SequencesPage({
  defaultProcessingStage = 'ready_to_annotate',
  isReviewPage = false,
  stageSelector,
}: SequencesPageProps = {}) {
  const navigate = useNavigate();
  const { startAnnotationWorkflow } = useSequenceStore();

  // Annotated-view features apply when the page's stage filter covers 'annotated'
  const isAnnotatedView = stageFilterIncludes(defaultProcessingStage, 'annotated');

  // The classify queue (alert-grouped, one row per alert) replaces the plain
  // sequences fetch/table only on the un-annotated queue page.
  const isQueueMode = !isAnnotatedView && !isReviewPage;

  // Storage key separates done vs queue filters; done filters are shared across stages.
  const storageKey = isReviewPage ? 'filters-classify-done' : 'filters-classify';

  // Use persisted filters hook
  const {
    filters,
    dateFrom,
    dateTo,
    selectedFalsePositiveTypes,
    selectedSmokeTypes,
    selectedModelAccuracy,
    selectedUnsure,
    setFilters,
    setDateFrom,
    setDateTo,
    setSelectedFalsePositiveTypes,
    setSelectedSmokeTypes,
    setSelectedModelAccuracy,
    setSelectedUnsure,
    resetFilters,
  } = usePersistedFilters(storageKey, createDefaultFilterState(defaultProcessingStage));

  // Keep filters.processing_stage in sync with the parent-controlled stage prop
  // (used by the review page stage selector). Reset to page 1 on stage change.
  // Value-compare: stage OR-lists are arrays, so identity comparison would loop.
  useEffect(() => {
    if (JSON.stringify(filters.processing_stage) !== JSON.stringify(defaultProcessingStage)) {
      setFilters({ ...filters, processing_stage: defaultProcessingStage, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultProcessingStage]);

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
      recorded_at_lte: endDateTime,
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

  // Annotated-only filters are hidden on other review stages, but their values
  // persist in shared state. Strip them from API calls so they don't silently
  // narrow results on stages where the controls aren't visible.
  const apiFilters = useMemo<ExtendedSequenceFilters>(() => {
    if (isAnnotatedView) return filters;
    const stripped: ExtendedSequenceFilters = { ...filters };
    delete stripped.false_positive_types;
    delete stripped.smoke_types;
    delete stripped.is_unsure;
    return stripped;
  }, [filters, isAnnotatedView]);

  // Fetch sequences with annotations in a single efficient call (review mode)
  const {
    data: sequences,
    isLoading: sequencesLoading,
    error: sequencesError,
  } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'with-annotations', apiFilters],
    queryFn: () => apiClient.getSequencesWithAnnotations(apiFilters),
    enabled: !isQueueMode,
  });

  // Fetch the alert-grouped classify queue — one row per alert, not per
  // object-sequence (queue mode only)
  const {
    data: classifyQueue,
    isLoading: classifyQueueLoading,
    error: classifyQueueError,
  } = useQuery({
    queryKey: ['classify-queue', apiFilters],
    queryFn: () => apiClient.getClassifyQueue(apiFilters),
    enabled: isQueueMode,
  });

  const isLoading = isQueueMode ? classifyQueueLoading : sequencesLoading;
  const error = isQueueMode ? classifyQueueError : sequencesError;

  // Filter sequences by model accuracy (only for review page)
  const filteredSequences = useMemo(() => {
    if (!sequences || selectedModelAccuracy === 'all' || !isAnnotatedView) {
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
      pages: Math.ceil(filtered.length / sequences.size),
    };
  }, [sequences, selectedModelAccuracy, isAnnotatedView]);

  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters({ ...filters, ...newFilters, page: 1 });
  };

  const handleFalsePositiveFilterChangeV2 = (selectedTypes: string[]) => {
    setSelectedFalsePositiveTypes(selectedTypes);
  };

  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
  };

  const handleSequenceClick = (clickedSequence: SequenceWithAnnotation) => {
    // Initialize annotation workflow if we have sequences data
    if (sequences?.items) {
      startAnnotationWorkflow(sequences.items, clickedSequence.id, apiFilters);
    }

    // Navigate to the annotation interface; provenance is in the path
    navigate(classifyDetail(clickedSequence.id, isReviewPage));
  };

  const handleAlertClick = (clickedItem: ClassifyQueueItem) => {
    // Workflow navigation only reads `.id` and array length off each entry
    // (see getNextSequenceInWorkflow / navigateTo{Next,Previous}InWorkflow in
    // useSequenceStore), so primary-lane id stubs are sufficient here — the
    // full SequenceWithAnnotation shape isn't needed for classify-queue rows.
    if (classifyQueue?.items) {
      startAnnotationWorkflow(
        classifyQueue.items.map(
          item => ({ id: item.primary_sequence_id }) as SequenceWithAnnotation
        ),
        clickedItem.primary_sequence_id,
        apiFilters
      );
    }

    navigate(classifyDetail(clickedItem.primary_sequence_id));
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

  // Empty state when no results are available
  const queueEmpty = isQueueMode && classifyQueue && classifyQueue.items.length === 0;
  const reviewEmpty = !isQueueMode && sequences && sequences.items.length === 0;
  if (queueEmpty || reviewEmpty) {
    // Check if user has applied filters
    const hasFilters = hasActiveUserFilters(
      filters,
      dateFrom,
      dateTo,
      selectedFalsePositiveTypes,
      selectedSmokeTypes,
      selectedModelAccuracy,
      selectedUnsure,
      isAnnotatedView,
      isAnnotatedView,
      isAnnotatedView,
      isAnnotatedView
    );

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isQueueMode ? 'Alerts' : 'Sequences'}
            </h1>
            <p className="text-gray-600">
              {isReviewPage
                ? 'Browse classified sequences and review past decisions'
                : isQueueMode
                  ? 'Classify every object of each alert'
                  : 'Manage and annotate wildfire detection sequences'}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {stageSelector}
            <FilterPopover
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
              selectedSmokeTypes={selectedSmokeTypes}
              onSmokeTypesChange={setSelectedSmokeTypes}
              selectedModelAccuracy={selectedModelAccuracy}
              onModelAccuracyChange={setSelectedModelAccuracy}
              selectedUnsure={selectedUnsure}
              onUnsureChange={setSelectedUnsure}
              onResetFilters={resetFilters}
              cameras={cameras}
              organizations={organizations}
              sourceApis={sourceApis}
              camerasLoading={camerasLoading}
              organizationsLoading={organizationsLoading}
              sourceApisLoading={sourceApisLoading}
              showModelAccuracy={defaultProcessingStage === 'annotated'}
              showFalsePositiveTypes={defaultProcessingStage === 'annotated'}
              showSmokeTypes={defaultProcessingStage === 'annotated'}
              showUnsureFilter={defaultProcessingStage === 'annotated'}
            />
          </div>
        </div>

        {/* Empty state message */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            {hasFilters ? (
              // Filtered results - no matches
              <>
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {isQueueMode ? 'No matching alerts found' : 'No matching sequences found'}
                </h3>
                <p className="text-gray-500 mb-4">
                  {isQueueMode
                    ? 'No alerts match your current filters.'
                    : 'No sequences match your current filters.'}
                </p>
                <p className="text-gray-400 text-sm">Try adjusting your search criteria above.</p>
              </>
            ) : isReviewPage ? (
              // Review page - simple message scoped to the selected stage
              <p className="text-gray-500">
                No sequences in &quot;{getStageFilterLabel(defaultProcessingStage)}&quot; at the
                moment.
              </p>
            ) : (
              // Queue page - celebratory message
              <>
                <div className="text-6xl mb-4">🎉</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">All caught up!</h3>
                <p className="text-gray-500">No alerts awaiting classification.</p>
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isQueueMode ? 'Alerts' : 'Sequences'}
          </h1>
          <p className="text-gray-600">
            {isReviewPage
              ? 'Browse classified sequences and review past decisions'
              : isQueueMode
                ? 'Classify every object of each alert'
                : 'Manage and annotate wildfire detection sequences'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {stageSelector}
          <FilterPopover
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
            selectedSmokeTypes={selectedSmokeTypes}
            onSmokeTypesChange={setSelectedSmokeTypes}
            selectedModelAccuracy={selectedModelAccuracy}
            onModelAccuracyChange={setSelectedModelAccuracy}
            selectedUnsure={selectedUnsure}
            onUnsureChange={setSelectedUnsure}
            onResetFilters={resetFilters}
            cameras={cameras}
            organizations={organizations}
            sourceApis={sourceApis}
            camerasLoading={camerasLoading}
            organizationsLoading={organizationsLoading}
            sourceApisLoading={sourceApisLoading}
            showModelAccuracy={isAnnotatedView}
            showFalsePositiveTypes={isAnnotatedView}
            showSmokeTypes={isAnnotatedView}
            showUnsureFilter={isAnnotatedView}
          />
        </div>
      </div>

      {/* Results */}
      {isQueueMode
        ? classifyQueue && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <p className="text-sm text-gray-700">
                  Showing {(classifyQueue.page - 1) * classifyQueue.size + 1} to{' '}
                  {Math.min(classifyQueue.page * classifyQueue.size, classifyQueue.total)} of{' '}
                  {classifyQueue.total} alerts
                </p>
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-gray-700">Show:</label>
                  <select
                    value={filters.size || 50}
                    onChange={e => handleFilterChange({ size: Number(e.target.value) })}
                    className="border border-gray-300 rounded px-2 py-1 text-sm"
                  >
                    {PAGINATION_OPTIONS.map(size => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <ClassifyAlertQueueTable
                items={classifyQueue.items}
                onAlertClick={handleAlertClick}
              />

              {classifyQueue.pages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handlePageChange(classifyQueue.page - 1)}
                      disabled={classifyQueue.page === 1}
                      className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-700">
                      Page {classifyQueue.page} of {classifyQueue.pages}
                    </span>
                    <button
                      onClick={() => handlePageChange(classifyQueue.page + 1)}
                      disabled={classifyQueue.page === classifyQueue.pages}
                      className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        : filteredSequences && (
            <div className="bg-white rounded-lg border border-gray-200">
              <SequencesTableHeader
                filteredSequences={filteredSequences}
                sequences={sequences}
                defaultProcessingStage={defaultProcessingStage}
                selectedModelAccuracy={selectedModelAccuracy}
                filters={filters}
                onFilterChange={handleFilterChange}
              />

              {/* Row Background Color Legend - Only show on review page */}
              {isReviewPage && <SequencesLegend />}

              {isReviewPage ? (
                <ClassifyDoneTable
                  sequences={filteredSequences.items}
                  onSequenceClick={handleSequenceClick}
                />
              ) : (
                <ClassifyQueueTable
                  sequences={filteredSequences.items}
                  onSequenceClick={handleSequenceClick}
                />
              )}

              <SequencesPagination
                filteredSequences={filteredSequences}
                onPageChange={handlePageChange}
              />
            </div>
          )}
    </div>
  );
}
