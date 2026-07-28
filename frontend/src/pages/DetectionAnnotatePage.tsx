import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/services/api';
import { LocalizationQueueItem } from '@/types/api';
import { pickNextLocalizeLane } from '@/utils/annotation/localizeUtils';
import { formatRelativeTime } from '@/utils/relativeTime';
import { localizeDetail } from '@/utils/routes';

function unfinishedSmokeLanes(item: LocalizationQueueItem): number {
  return item.lanes.filter(l => l.has_smoke && l.processing_stage === 'seq_annotation_done').length;
}

function totalBoxes(item: LocalizationQueueItem): number {
  return item.lanes.filter(l => l.has_smoke).reduce((sum, l) => sum + l.total_detections, 0);
}

function annotatedBoxes(item: LocalizationQueueItem): number {
  return item.lanes.filter(l => l.has_smoke).reduce((sum, l) => sum + l.annotated_detections, 0);
}

export default function DetectionAnnotatePage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['localization-queue', page],
    queryFn: () => apiClient.getLocalizationQueue({ page, size: 50 }),
  });

  // Clamp when alerts drain below the current page (e.g. last alert of the
  // last page was submitted) — otherwise the user is stranded on an empty
  // page with the pager hidden.
  useEffect(() => {
    if (data && data.pages >= 1 && page > data.pages) {
      setPage(data.pages);
    }
  }, [data, page]);

  const handleAlertClick = (item: LocalizationQueueItem) => {
    // -1 never matches a sequence id: picks the alert's first unfinished lane.
    const first = pickNextLocalizeLane(item.lanes, -1);
    if (first !== null) {
      navigate(localizeDetail(first));
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
          <p className="text-gray-500">Failed to load the localization queue</p>
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Smoke Localization</h1>
          <p className="mt-1 text-sm text-gray-500">
            Alerts whose objects are classified and auto-annotated — draw a tight box around the
            smoke in every image
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <p className="text-gray-900 font-medium">No alerts ready for localization</p>
            <p className="mt-1 text-sm text-gray-500">
              Alerts appear here once every object is classified and the auto reference layer is
              computed
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Camera
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Organisation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recorded
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Objects
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Progress
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map(item => (
                <tr
                  key={`${item.source_api}-${item.platform_alert_id}`}
                  onClick={() => handleAlertClick(item)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.camera_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.organisation_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatRelativeTime(item.recorded_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {unfinishedSmokeLanes(item)} of {item.lanes.length} objects to localize
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {annotatedBoxes(item)}/{totalBoxes(item)} boxes
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {data.page} of {data.pages} · {data.total} alerts
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= (data.pages ?? 1)}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
