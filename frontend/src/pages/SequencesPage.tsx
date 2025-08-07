import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Filter } from 'lucide-react';
import { apiClient } from '@/services/api';
import { ExtendedSequenceFilters } from '@/types/api';
import { QUERY_KEYS, PAGINATION_DEFAULTS, PROCESSING_STAGE_STATUS_OPTIONS, PROCESSING_STAGE_LABELS } from '@/utils/constants';
import { getProcessingStageLabel, getProcessingStageColorClass } from '@/utils/processingStage';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';

export default function SequencesPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ExtendedSequenceFilters>({
    page: PAGINATION_DEFAULTS.PAGE,
    size: PAGINATION_DEFAULTS.SIZE,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Fetch sequences with annotations in a single efficient call
  const { data: sequences, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'with-annotations', filters],
    queryFn: () => apiClient.getSequencesWithAnnotations(filters),
  });

  const handleFilterChange = (newFilters: Partial<ExtendedSequenceFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
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

      {/* Search and Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center space-x-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search sequences..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </button>
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source API
              </label>
              <select
                value={filters.source_api || ''}
                onChange={(e) => handleFilterChange({ source_api: e.target.value as any || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All Sources</option>
                <option value="pyronear_french">Pyronear French</option>
                <option value="alert_wildfire">Alert Wildfire</option>
                <option value="api_cenia">API Cenia</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Camera ID
              </label>
              <input
                type="number"
                value={filters.camera_id || ''}
                onChange={(e) => handleFilterChange({ camera_id: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Enter camera ID"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Organization ID
              </label>
              <input
                type="number"
                value={filters.organisation_id || ''}
                onChange={(e) => handleFilterChange({ organisation_id: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Enter organization ID"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Wildfire Alert
              </label>
              <select
                value={filters.is_wildfire_alertapi === undefined ? '' : filters.is_wildfire_alertapi.toString()}
                onChange={(e) => {
                  const value = e.target.value;
                  handleFilterChange({ 
                    is_wildfire_alertapi: value === '' ? undefined : value === 'true' 
                  });
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All</option>
                <option value="true">Wildfire Alert</option>
                <option value="false">No Alert</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Processing Stage
              </label>
              <select
                value={filters.processing_stage || ''}
                onChange={(e) => handleFilterChange({ processing_stage: e.target.value as any || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All Stages</option>
                {PROCESSING_STAGE_STATUS_OPTIONS.map((stage) => (
                  <option key={stage} value={stage}>
                    {PROCESSING_STAGE_LABELS[stage]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {sequences && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {((sequences.page - 1) * sequences.size) + 1} to{' '}
                {Math.min(sequences.page * sequences.size, sequences.total)} of{' '}
                {sequences.total} results
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

          {/* Sequence List */}
          <div className="divide-y divide-gray-200">
            {sequences.items.map((sequence) => (
              <div key={sequence.id} className="p-4 hover:bg-gray-50 cursor-pointer">
                <div className="flex items-center space-x-4">
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
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getProcessingStageColorClass(sequence.annotation?.processing_stage || 'no_annotation')}`}>
                        {getProcessingStageLabel(sequence.annotation?.processing_stage || 'no_annotation')}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center text-sm text-gray-500 space-x-4">
                      <span>{new Date(sequence.recorded_at).toLocaleString()}</span>
                      <span>Org: {sequence.organisation_name}</span>
                    </div>
                    {sequence.azimuth && (
                      <div className="mt-1 text-xs text-gray-400">
                        Azimuth: {sequence.azimuth}°
                      </div>
                    )}
                  </div>
                  
                  {/* Action Button */}
                  <div className="flex-shrink-0">
                    <button 
                      onClick={() => navigate(`/sequences/${sequence.id}`)}
                      className="text-primary-600 hover:text-primary-900 text-sm font-medium"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {sequences.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(sequences.page - 1)}
                  disabled={sequences.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {sequences.page} of {sequences.pages}
                </span>
                <button
                  onClick={() => handlePageChange(sequences.page + 1)}
                  disabled={sequences.page === sequences.pages}
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