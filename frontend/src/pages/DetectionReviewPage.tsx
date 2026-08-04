import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { BoxSelect, Search } from 'lucide-react';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, LocalizeDoneQueueItem } from '@/types/api';
import { PAGINATION_OPTIONS } from '@/utils/constants';
import FilterPopover from '@/components/filters/FilterPopover';
import { LocalizeDoneQueueTable, TablePagination } from '@/components/sequences';
import { TABLE_CARD_CLASSES } from '@/components/sequences/tableStyles';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/dateRangeUtils';
import { hasActiveUserFilters } from '@/utils/filterHelpers';
import { localizeDetail, ROUTES } from '@/utils/routes';

// Default filter contract for /localize/done — imported by its defaults test.
// Membership (which alerts qualify) is entirely server-side now, via
// GET /sequences/localize-done-queue; the page only carries pagination plus
// the camera/org/source/date filters that endpoint accepts.
// eslint-disable-next-line react-refresh/only-export-components
export const detectionReviewDefaultState = createDefaultFilterState();

export default function DetectionReviewPage() {
  const navigate = useNavigate();

  const defaultState = detectionReviewDefaultState;

  // Use persisted filters hook. v3: annotation-type/model-accuracy filters
  // don't apply to alert rows and are hidden on this page (see task-10b
  // report) — bumped so stale v2 filter state can't confuse the new endpoint.
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
  } = usePersistedFilters('filters-localize-done-v3', defaultState);

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

  // Alert-grouped localize-done queue — one row per alert.
  const { data, isLoading, error } = useQuery({
    queryKey: ['localize-done-queue', filters],
    queryFn: () =>
      apiClient.getLocalizeDoneQueue({
        page: filters.page,
        size: filters.size,
        camera_name: filters.camera_name,
        organisation_name: filters.organisation_name,
        source_api: filters.source_api,
        recorded_at_gte: filters.recorded_at_gte,
        recorded_at_lte: filters.recorded_at_lte,
      }),
  });

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

  const handleAlertClick = (item: LocalizeDoneQueueItem) => {
    // Any lane of the alert gets there: the detail page resolves the whole
    // alert from the sequence id (getSequence -> getAlertDetail) and renders
    // every object, so the first lane is just the entry point.
    const first = item.lanes[0];
    if (first) {
      navigate(localizeDetail(first.sequence_id, undefined, true));
    }
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

  const items = data?.items ?? [];

  // Empty state when no alerts are available for review
  if (items.length === 0) {
    // Check if user has applied filters
    const hasFilters = hasActiveUserFilters(
      filters,
      dateFrom,
      dateTo,
      selectedFalsePositiveTypes,
      selectedSmokeTypes,
      selectedModelAccuracy,
      'all' // selectedUnsure
      // showModelAccuracy / showFalsePositiveTypes / showSmokeTypes / showUnsureFilter
      // all default false — those filters don't apply to alert rows
    );

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detections</h1>
            <p className="text-gray-600">
              Browse localized smoke detections and review past annotations
            </p>
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
          />
        </div>

        {/* Empty state message */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center max-w-md">
            {hasFilters ? (
              // Filtered results - no matches
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-line bg-white"
                >
                  <Search className="h-6 w-6 text-haze" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  No matching alerts
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Nothing localized matches your current filters. Loosen or clear them to see more.
                </p>
                <button
                  onClick={resetFilters}
                  className="mt-5 inline-block rounded-lg border border-line bg-white px-7 py-2.5 font-body text-[13.5px] font-semibold text-char hover:bg-ash focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Clear filters
                </button>
              </>
            ) : (
              // No filters - nothing localized yet
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ember-soft"
                >
                  <BoxSelect className="h-6 w-6 text-ember" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  No localized alerts yet
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Finished localizations show up here for review. Head to the queue to box your
                  first alert.
                </p>
                <Link
                  to={ROUTES.LOCALIZE}
                  className="mt-5 inline-block rounded-lg bg-ember px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
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
          <h1 className="text-2xl font-bold text-gray-900">Detections</h1>
          <p className="text-gray-600">
            Browse localized smoke detections and review past annotations
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          />
        </div>
      </div>

      {/* Results */}
      {data && (
        <div className={TABLE_CARD_CLASSES}>
          <LocalizeDoneQueueTable items={items} onItemClick={handleAlertClick} />

          <TablePagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            itemsLabel="alerts"
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
