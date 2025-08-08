import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Eye, Edit, Download } from 'lucide-react';
import { apiClient } from '@/services/api';
import { SequenceAnnotationFilters } from '@/types/api';
import { QUERY_KEYS, PAGINATION_DEFAULTS } from '@/utils/constants';

export default function AnnotationsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<SequenceAnnotationFilters>({
    page: PAGINATION_DEFAULTS.PAGE,
    size: PAGINATION_DEFAULTS.SIZE,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { data: annotations, isLoading, error } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, filters],
    queryFn: () => apiClient.getSequenceAnnotations(filters),
  });

  const handleFilterChange = (newFilters: Partial<SequenceAnnotationFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleGenerateGifs = async (annotationId: number) => {
    try {
      await apiClient.generateGifs(annotationId);
      // Refresh the annotations to see updated status
      // This would typically trigger a refetch
    } catch (error) {
      console.error('Failed to generate GIFs:', error);
      // Handle error (show toast, etc.)
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
          <p className="text-red-600 mb-2">Failed to load annotations</p>
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
          <h1 className="text-2xl font-bold text-gray-900">Sequence Annotations</h1>
          <p className="text-gray-600">
            Review and manage annotated sequences
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
              placeholder="Search annotations..."
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Smoke Type
              </label>
              <select
                value={(filters as any).smoke_type || ''}
                onChange={(e) => handleFilterChange({ smoke_type: e.target.value as any || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All Types</option>
                <option value="wildfire">Wildfire</option>
                <option value="industrial">Industrial</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                False Positive Type
              </label>
              <select
                value={filters.false_positive_type || ''}
                onChange={(e) => handleFilterChange({ false_positive_type: e.target.value as any || undefined })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">Not False Positive</option>
                <option value="antenna">Antenna</option>
                <option value="building">Building</option>
                <option value="cliff">Cliff</option>
                <option value="dark">Dark</option>
                <option value="dust">Dust</option>
                <option value="high_cloud">High Cloud</option>
                <option value="low_cloud">Low Cloud</option>
                <option value="lens_flare">Lens Flare</option>
                <option value="lens_droplet">Lens Droplet</option>
                <option value="light">Light</option>
                <option value="rain">Rain</option>
                <option value="trail">Trail</option>
                <option value="road">Road</option>
                <option value="sky">Sky</option>
                <option value="tree">Tree</option>
                <option value="water_body">Water Body</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sequence ID
              </label>
              <input
                type="number"
                value={filters.sequence_id || ''}
                onChange={(e) => handleFilterChange({ sequence_id: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Enter sequence ID"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {annotations && (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {((annotations.page - 1) * annotations.size) + 1} to{' '}
                {Math.min(annotations.page * annotations.size, annotations.total)} of{' '}
                {annotations.total} results
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

          {/* Annotation List */}
          <div className="divide-y divide-gray-200">
            {annotations.items.map((annotation) => (
              <div key={annotation.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-sm font-medium text-gray-900">
                        Annotation #{annotation.id}
                      </h3>
                      <span className="text-sm text-gray-500">
                        Sequence #{annotation.sequence_id}
                      </span>
                      
                      {/* Annotation Type Badge */}
                      {annotation.has_smoke && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          🔥 Smoke
                        </span>
                      )}
                      
                      {annotation.has_false_positives && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          ❌ False Positive
                        </span>
                      )}
                    </div>
                    
                    <div className="text-sm text-gray-500 space-y-1">
                      <p>Created: {new Date(annotation.created_at).toLocaleString()}</p>
                      {annotation.updated_at !== annotation.created_at && (
                        <p>Updated: {new Date(annotation.updated_at!).toLocaleString()}</p>
                      )}
                      {annotation.false_positive_types && (
                        <p className="text-gray-700">False positive types: {annotation.false_positive_types}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-shrink-0 flex items-center space-x-2">
                    <button
                      onClick={() => navigate(`/sequences/${annotation.sequence_id}/annotate`)}
                      className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </button>
                    
                    <button
                      onClick={() => handleGenerateGifs(annotation.id)}
                      className="inline-flex items-center px-3 py-1 bg-primary-600 border border-transparent rounded-md text-xs font-medium text-white hover:bg-primary-700"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Generate GIFs
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {annotations.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(annotations.page - 1)}
                  disabled={annotations.page === 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-700">
                  Page {annotations.page} of {annotations.pages}
                </span>
                <button
                  onClick={() => handlePageChange(annotations.page + 1)}
                  disabled={annotations.page === annotations.pages}
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