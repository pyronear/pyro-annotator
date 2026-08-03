import { ReactNode, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ListChecks, Search } from 'lucide-react';
import { apiClient } from '@/services/api';
import {
  ExtendedSequenceFilters,
  ProcessingStageFilter,
  SequenceWithAnnotation,
} from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { analyzeSequenceAccuracy } from '@/utils/modelAccuracy';
import { getStageFilterLabel, stageFilterIncludes } from '@/utils/processingStage';
import FilterPopover from '@/components/filters/FilterPopover';
import {
  SequencesTableHeader,
  SequencesLegend,
  ClassifyQueueTable,
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
import { classifyDetail, ROUTES } from '@/utils/routes';

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

  // Fetch sequences with annotations in a single efficient call
  const {
    data: sequences,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'with-annotations', apiFilters],
    queryFn: () => apiClient.getSequencesWithAnnotations(apiFilters),
  });

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
            <h1 className="text-2xl font-bold text-gray-900">Sequences</h1>
            <p className="text-gray-600">
              {isReviewPage
                ? 'Browse classified sequences and review past decisions'
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
          <div className="text-center max-w-md">
            {hasFilters ? (
              // Filtered results - no matches (shared by queue and done)
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-line bg-white"
                >
                  <Search className="h-6 w-6 text-haze" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  No matching sequences
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Nothing here matches your current filters. Loosen or clear them to see more.
                </p>
                <button
                  onClick={resetFilters}
                  className="mt-5 inline-block rounded-lg border border-line bg-white px-7 py-2.5 font-body text-[13.5px] font-semibold text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Clear filters
                </button>
              </>
            ) : isReviewPage ? (
              // Review page - nothing classified yet (stage-aware)
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ember-soft"
                >
                  <ListChecks className="h-6 w-6 text-ember" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  {/* An array stage is the "All classified" pseudo-stage (see getStageFilterLabel) */}
                  {Array.isArray(defaultProcessingStage)
                    ? 'No classified sequences yet'
                    : `No sequences in "${getStageFilterLabel(defaultProcessingStage)}"`}
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Sequences you classify land here for review.
                </p>
                <Link
                  to={ROUTES.CLASSIFY}
                  className="mt-5 inline-block rounded-lg bg-ember px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Start classifying
                </Link>
              </>
            ) : (
              // Annotation queue - all imported sequences classified
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft"
                >
                  <Check className="h-7 w-7 text-pine" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  Classification queue is clear
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Nice work — every imported sequence has been classified. New ones appear here as
                  imports come in.
                </p>
                <Link
                  to={ROUTES.LOCALIZE}
                  className="mt-5 inline-block rounded-lg bg-pine px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Start localizing
                </Link>
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
          <h1 className="text-2xl font-bold text-gray-900">Sequences</h1>
          <p className="text-gray-600">
            {isReviewPage
              ? 'Browse classified sequences and review past decisions'
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
      {filteredSequences && (
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
