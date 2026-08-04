import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ListChecks, Search } from 'lucide-react';
import { apiClient } from '@/services/api';
import {
  ClassifyDoneItem,
  ClassifyQueueItem,
  ExtendedSequenceFilters,
  ProcessingStageFilter,
  SequenceWithAnnotation,
} from '@/types/api';
import { PAGINATION_OPTIONS } from '@/utils/constants';
import { getStageFilterLabel, stageFilterIncludes } from '@/utils/processingStage';
import FilterPopover from '@/components/filters/FilterPopover';
import {
  ClassifyAlertQueueTable,
  ClassifyDoneTable,
  TablePagination,
} from '@/components/sequences';
import { TABLE_CARD_CLASSES } from '@/components/sequences/tableStyles';
import { useSequenceStore } from '@/store/useSequenceStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/dateRangeUtils';
import { hasActiveUserFilters } from '@/utils/filterHelpers';
import { classifyDetail, ROUTES } from '@/utils/routes';

// UI accuracy filter value → classify-done query param.
const MODEL_ACCURACY_PARAM: Partial<Record<string, 'tp' | 'fp' | 'fn'>> = {
  true_positive: 'tp',
  false_positive: 'fp',
  false_negative: 'fn',
};

interface SequencesPageProps {
  defaultProcessingStage?: ProcessingStageFilter;
  isReviewPage?: boolean;
}

export default function SequencesPage({
  defaultProcessingStage = 'ready_to_annotate',
  isReviewPage = false,
}: SequencesPageProps = {}) {
  const navigate = useNavigate();
  const { startAnnotationWorkflow } = useSequenceStore();
  const { canLocalize } = useAuthStore();

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

  // Keep filters.processing_stage in sync with the parent-controlled stage prop.
  // Reset to page 1 on stage change.
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

  // Fetch the alert-grouped done list — one row per fully classified alert
  const {
    data: classifyDone,
    isLoading: classifyDoneLoading,
    error: classifyDoneError,
  } = useQuery({
    queryKey: ['classify-done', apiFilters, selectedModelAccuracy],
    queryFn: () => {
      // processing_stage is a sequences-endpoint concept; classify-done's
      // membership (fully classified) replaces it.
      const rest = { ...apiFilters };
      delete rest.processing_stage;
      return apiClient.getClassifyDone({
        ...rest,
        model_accuracy: MODEL_ACCURACY_PARAM[selectedModelAccuracy],
      });
    },
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

  const isLoading = isQueueMode ? classifyQueueLoading : classifyDoneLoading;
  const error = isQueueMode ? classifyQueueError : classifyDoneError;

  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters({ ...filters, ...newFilters, page: 1 });
  };

  const handleFalsePositiveFilterChangeV2 = (selectedTypes: string[]) => {
    setSelectedFalsePositiveTypes(selectedTypes);
  };

  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
  };

  const handleDoneClick = (item: ClassifyDoneItem) => {
    // Workflow navigation only reads `.id` off each entry, so primary-lane
    // id stubs are sufficient here (same trick as handleAlertClick).
    if (classifyDone?.items) {
      startAnnotationWorkflow(
        classifyDone.items.map(
          done => ({ id: done.primary_sequence_id }) as SequenceWithAnnotation
        ),
        item.primary_sequence_id,
        apiFilters
      );
    }
    navigate(classifyDetail(item.primary_sequence_id, true));
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

  // Empty state when the server page comes back empty (all filters,
  // including model accuracy, are applied server-side).
  const queueEmpty = isQueueMode && classifyQueue && classifyQueue.items.length === 0;
  const reviewEmpty = !isQueueMode && classifyDone && classifyDone.items.length === 0;
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
                  {isQueueMode ? 'No matching alerts' : 'No matching sequences'}
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
              // Classification queue is clear - every alert has been classified
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
                  Nice work — every alert has been classified. New ones appear here as imports come
                  in.
                </p>
                {canLocalize() && (
                  <Link
                    to={ROUTES.LOCALIZE}
                    className="mt-5 inline-block rounded-lg bg-pine px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                  >
                    Start localizing
                  </Link>
                )}
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
          <div className="flex items-center space-x-2">
            <label htmlFor="page-size" className="font-body text-sm text-haze">
              Show:
            </label>
            <select
              id="page-size"
              value={filters.size || 50}
              onChange={e => handleFilterChange({ size: Number(e.target.value) })}
              className="border border-line rounded px-2 py-1 font-body text-sm"
            >
              {PAGINATION_OPTIONS.map(size => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
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
            <div className={TABLE_CARD_CLASSES}>
              <ClassifyAlertQueueTable
                items={classifyQueue.items}
                onAlertClick={handleAlertClick}
              />

              <TablePagination
                page={classifyQueue.page}
                pages={classifyQueue.pages}
                total={classifyQueue.total}
                itemsLabel="alerts"
                onPageChange={handlePageChange}
              />
            </div>
          )
        : classifyDone && (
            <div className={TABLE_CARD_CLASSES}>
              <ClassifyDoneTable items={classifyDone.items} onItemClick={handleDoneClick} />

              <TablePagination
                page={classifyDone.page}
                pages={classifyDone.pages}
                total={classifyDone.total}
                itemsLabel="alerts"
                onPageChange={handlePageChange}
              />
            </div>
          )}
    </div>
  );
}
