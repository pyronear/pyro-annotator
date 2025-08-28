import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, SequenceWithDetectionProgress } from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { analyzeSequenceAccuracy } from '@/utils/modelAccuracy';
import TabbedFilters from '@/components/filters/TabbedFilters';
import {
  DetectionAnnotateTableHeader,
  SequencesLegend,
  DetectionAnnotateTableRow,
  DetectionReviewPagination,
} from '@/components/sequences';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/DateRangeFilter';
import { hasActiveUserFilters } from '@/utils/filterHelpers';

export default function DetectionAnnotatePage() {
  const navigate = useNavigate();

  // Create default state specific to detection annotation page
  const defaultState = {
    ...createDefaultFilterState('annotated'),
    filters: {
      ...createDefaultFilterState('annotated').filters,
      detection_annotation_completion: 'incomplete' as const,
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
  } = usePersistedFilters('filters-detection-annotate', defaultState);

  // Filter change handlers
  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters({ ...filters, ...newFilters, page: 1 });
  };

  const handlePageChange = (page: number) => {
    setFilters({ ...filters, page });
  };

  // Clear preset date range
  const handleClearPresetDateRange = () => {
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

  // Fetch sequences for annotation
  const {
    data: sequences,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'detection-annotate', filters],
    queryFn: () => apiClient.getSequences(filters),
  });

  // Fetch sequence annotations for model accuracy analysis
  const { data: sequenceAnnotations } = useQuery({
    queryKey: [
      ...QUERY_KEYS.SEQUENCE_ANNOTATIONS,
      'detection-annotate',
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
  const annotationMap =
    sequenceAnnotations?.reduce(
      (acc, { sequenceId, annotation }) => {
        acc[sequenceId] = annotation;
        return acc;
      },
      {} as Record<number, any>
    ) || {};

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

  // Navigation handlers
  const handleSequenceClick = (sequence: SequenceWithDetectionProgress) => {
    // Store current state before navigation
    localStorage.setItem('detection-annotate-return-filters', JSON.stringify(filters));
    navigate(`/detections/${sequence.id}/annotate?from=detections-annotate`);
  };

  // Fetch cameras, organizations, and source APIs for dropdown options
  const { data: cameras = [], isLoading: camerasLoading } = useCameras();
  const { data: organizations = [], isLoading: organizationsLoading } = useOrganizations();
  const { data: sourceApis = [], isLoading: sourceApisLoading } = useSourceApis();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-gray-500">Failed to load sequences</p>
        </div>
      </div>
    );
  }

  // No sequences found
  if (!filteredSequences || filteredSequences.items.length === 0) {
    return (
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detection Annotation</h1>
            <p className="mt-1 text-sm text-gray-500">
              Annotate individual detections within sequences
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
          onDateRangeSet={(preset: string) => {
            const { dateFrom: startDateStr, dateTo: endDateStr } = calculatePresetDateRange(preset);
            setDateFrom(startDateStr);
            setDateTo(endDateStr);
            const startDateTime = startDateStr ? startDateStr + 'T00:00:00' : undefined;
            const endDateTime = endDateStr ? endDateStr + 'T23:59:59' : undefined;
            handleFilterChange({ recorded_at_gte: startDateTime, recorded_at_lte: endDateTime });
          }}
          onDateRangeClear={handleClearPresetDateRange}
          selectedFalsePositiveTypes={selectedFalsePositiveTypes}
          onFalsePositiveTypesChange={setSelectedFalsePositiveTypes}
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

        {/* Empty State */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            {hasActiveUserFilters(
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
            ) ? (
              <>
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No sequences match your filters</h3>
                <p className="text-gray-500 mb-4">
                  Try adjusting your search criteria or clearing some filters.
                </p>
                <button
                  onClick={resetFilters}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors"
                >
                  Clear all filters
                </button>
              </>
            ) : (
              <>
                <div className="text-6xl mb-4">🎉</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">All sequences annotated!</h3>
                <p className="text-gray-500">There are no sequences requiring detection annotation at this time.</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Detection Annotation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Annotate individual detections within sequences
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
        onDateRangeSet={(preset: string) => {
          const { dateFrom: startDateStr, dateTo: endDateStr } = calculatePresetDateRange(preset);
          setDateFrom(startDateStr);
          setDateTo(endDateStr);
          const startDateTime = startDateStr ? startDateStr + 'T00:00:00' : undefined;
          const endDateTime = endDateStr ? endDateStr + 'T23:59:59' : undefined;
          handleFilterChange({ recorded_at_gte: startDateTime, recorded_at_lte: endDateTime });
        }}
        onDateRangeClear={handleClearPresetDateRange}
        selectedFalsePositiveTypes={selectedFalsePositiveTypes}
        onFalsePositiveTypesChange={setSelectedFalsePositiveTypes}
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

      {/* Results */}
      {filteredSequences && (
        <div className="bg-white rounded-lg border border-gray-200">
          <DetectionAnnotateTableHeader
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
              <DetectionAnnotateTableRow
                key={sequence.id}
                sequence={sequence}
                annotation={annotationMap[sequence.id]}
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