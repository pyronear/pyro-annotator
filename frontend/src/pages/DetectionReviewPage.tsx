import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { BoxSelect, Search } from 'lucide-react';
import { apiClient } from '@/services/api';
import {
  ExtendedSequenceFilters,
  SequenceWithDetectionProgress,
  SequenceAnnotation,
} from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { analyzeSequenceAccuracy } from '@/utils/modelAccuracy';
import FilterPopover from '@/components/filters/FilterPopover';
import {
  DetectionReviewTableHeader,
  SequencesLegend,
  DetectionReviewTableRow,
  DetectionReviewPagination,
} from '@/components/sequences';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/dateRangeUtils';
import { hasActiveUserFilters } from '@/utils/filterHelpers';
import { localizeDetail, ROUTES } from '@/utils/routes';

// Default filter contract for /localize/done — imported by its defaults test.
// eslint-disable-next-line react-refresh/only-export-components
export const detectionReviewDefaultState = {
  ...createDefaultFilterState('annotated'),
  filters: {
    ...createDefaultFilterState('annotated').filters,
    detection_annotation_completion: 'complete' as const,
    include_detection_stats: true,
    processing_stage: 'annotated' as const, // Only show sequences that have completed sequence-level annotation
    is_unsure: false, // Exclude unsure sequences from detection annotation workflow
    // Verification is for localized boxes (smoke or missed smoke); auto-final
    // FP lanes have nothing to verify (their classification is reviewed in
    // Sequences > Review). Unsure lanes resolve through sequence review.
    needs_localization: true,
  },
};

export default function DetectionReviewPage() {
  const navigate = useNavigate();

  const defaultState = detectionReviewDefaultState;

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
  } = usePersistedFilters('filters-localize-done-v2', defaultState);

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

  // Fetch sequences with complete detection annotations
  const {
    data: sequences,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-review', filters],
    queryFn: () => apiClient.getSequences(filters),
  });

  // Fetch sequence annotations for model accuracy analysis
  const { data: sequenceAnnotations } = useQuery({
    queryKey: [
      ...QUERY_KEYS.SEQUENCE_ANNOTATIONS,
      'detection-review',
      sequences?.items?.map(s => s.id),
    ],
    queryFn: async () => {
      if (!sequences?.items?.length) return [];

      const annotationPromises = sequences.items.map(sequence =>
        apiClient
          .getSequenceAnnotations({ sequence_id: sequence.id, size: 1 })
          .then(response => ({ sequenceId: sequence.id, annotation: response.items[0] || null }))
          .catch(() => ({ sequenceId: sequence.id, annotation: null }))
      );

      return Promise.all(annotationPromises);
    },
    enabled: !!sequences?.items?.length,
  });

  // Create a map for quick annotation lookup
  const annotationMap = useMemo(
    () =>
      sequenceAnnotations?.reduce(
        (acc, { sequenceId, annotation }) => {
          acc[sequenceId] = annotation || undefined;
          return acc;
        },
        {} as Record<number, SequenceAnnotation | undefined>
      ) || {},
    [sequenceAnnotations]
  );

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
        annotation: annotation,
      });

      return accuracy.type === selectedModelAccuracy;
    });

    return {
      ...sequences,
      items: filtered,
      total: filtered.length,
      pages: Math.ceil(filtered.length / sequences.size),
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
    navigate(localizeDetail(clickedSequence.id, undefined, true));
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
            showModelAccuracy={true}
            showFalsePositiveTypes={true}
            showSmokeTypes={true}
          />
        </div>

        {/* Empty state message */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center max-w-md">
            {hasFilters ? (
              // Filtered results - no matches
              <>
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-line bg-white">
                  <Search className="h-6 w-6 text-haze" />
                </span>
                <p className="mt-4 font-display text-base font-semibold text-char">
                  No matching alerts
                </p>
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
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ember-soft">
                  <BoxSelect className="h-6 w-6 text-ember" />
                </span>
                <p className="mt-4 font-display text-base font-semibold text-char">
                  No localized alerts yet
                </p>
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
          showModelAccuracy={true}
          showFalsePositiveTypes={true}
          showSmokeTypes={true}
        />
      </div>

      {/* Results */}
      {filteredSequences && (
        <div className="bg-white rounded-lg border border-gray-200">
          <DetectionReviewTableHeader
            filteredSequences={filteredSequences}
            sequences={sequences}
            selectedModelAccuracy={selectedModelAccuracy}
            filters={filters}
            onFilterChange={handleFilterChange}
          />

          <SequencesLegend />

          {/* Sequence List */}
          <div className="divide-y divide-gray-200">
            {filteredSequences.items.map(sequence => (
              <DetectionReviewTableRow
                key={sequence.id}
                sequence={sequence}
                annotation={annotationMap[sequence.id] || undefined}
                onSequenceClick={handleSequenceClick}
              />
            ))}
          </div>

          <DetectionReviewPagination
            filteredSequences={filteredSequences}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
