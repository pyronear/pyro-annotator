import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import {
  ExtendedSequenceFilters,
  SequenceWithDetectionProgress,
  SequenceAnnotation,
} from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { analyzeSequenceAccuracy } from '@/utils/modelAccuracy';
import TabbedFilters from '@/components/filters/TabbedFilters';
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
            <p className="text-gray-600">Review and verify annotated wildfire detections</p>
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
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No matching sequences found
                </h3>
                <p className="text-gray-500 mb-4">
                  No sequences with completed detection annotations match your current filters.
                </p>
                <p className="text-gray-400 text-sm">Try adjusting your search criteria above.</p>
              </>
            ) : (
              // No filters - no sequences available
              <p className="text-gray-500">
                No sequences with completed detection annotations to review at the moment.
              </p>
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
          <p className="text-gray-600">Review and verify annotated wildfire detections</p>
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
