import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters, ProcessingStageStatus } from '@/types/api';
import { QUERY_KEYS } from '@/utils/constants';
import { analyzeSequenceAccuracy } from '@/utils/modelAccuracy';
import TabbedFilters from '@/components/filters/TabbedFilters';
import {
  SequencesTableHeader,
  SequencesLegend,
  SequenceTableRow,
  SequencesPagination,
} from '@/components/sequences';
import { useSequenceStore } from '@/store/useSequenceStore';
import { useCameras } from '@/hooks/useCameras';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useSourceApis } from '@/hooks/useSourceApis';
import { usePersistedFilters, createDefaultFilterState } from '@/hooks/usePersistedFilters';
import { calculatePresetDateRange } from '@/components/filters/shared/dateRangeUtils';
import { hasActiveUserFilters } from '@/utils/filterHelpers';

interface SequencesPageProps {
  defaultProcessingStage?: ProcessingStageStatus;
}

export default function SequencesPage({
  defaultProcessingStage = 'ready_to_annotate',
}: SequencesPageProps = {}) {
  const navigate = useNavigate();
  const { startAnnotationWorkflow } = useSequenceStore();

  // Determine storage key based on processing stage to separate annotate vs review filters
  const storageKey =
    defaultProcessingStage === 'annotated'
      ? 'filters-sequences-review'
      : 'filters-sequences-annotate';

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

  // Fetch sequences with annotations in a single efficient call
  const {
    data: sequences,
    isLoading,
    error,
  } = useQuery({
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
      pages: Math.ceil(filtered.length / sequences.size),
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
    // Check if user has applied filters
    const hasFilters = hasActiveUserFilters(
      filters,
      dateFrom,
      dateTo,
      selectedFalsePositiveTypes,
      selectedSmokeTypes,
      selectedModelAccuracy,
      selectedUnsure,
      defaultProcessingStage === 'annotated',
      defaultProcessingStage === 'annotated',
      defaultProcessingStage === 'annotated',
      defaultProcessingStage === 'annotated'
    );

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sequences</h1>
            <p className="text-gray-600">Manage and annotate wildfire detection sequences</p>
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
                  {defaultProcessingStage === 'annotated'
                    ? 'No completed sequences match your current filters.'
                    : 'No sequences match your current filters.'}
                </p>
                <p className="text-gray-400 text-sm">Try adjusting your search criteria above.</p>
              </>
            ) : defaultProcessingStage === 'annotated' ? (
              // Review page - simple message without celebration
              <p className="text-gray-500">No completed sequences to review at the moment.</p>
            ) : (
              // Annotation page - celebratory message
              <>
                <div className="text-6xl mb-4">🎉</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">All caught up!</h3>
                <p className="text-gray-500">
                  No sequences available for annotation at the moment.
                </p>
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
          <p className="text-gray-600">Manage and annotate wildfire detection sequences</p>
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
          {defaultProcessingStage === 'annotated' && <SequencesLegend />}

          {/* Sequence List */}
          <div className="divide-y divide-gray-200">
            {filteredSequences.items.map(sequence => (
              <SequenceTableRow
                key={sequence.id}
                sequence={sequence}
                defaultProcessingStage={defaultProcessingStage}
                onSequenceClick={handleSequenceClick}
              />
            ))}
          </div>

          <SequencesPagination
            filteredSequences={filteredSequences}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}
