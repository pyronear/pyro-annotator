import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/services/api';
import { LocalizationQueueItem } from '@/types/api';
import DetectionImageThumbnail from '@/components/DetectionImageThumbnail';
import { pickNextLocalizeLane } from '@/utils/annotation/localizeUtils';
import { formatSmokeType, getSmokeTypeEmoji } from '@/utils/modelAccuracy';
import { localizeDetail } from '@/utils/routes';

// Images the annotator will draw boxes on: each smoke object replays the
// alert's frames, so two objects x 10 frames is 20 boxes of work.
function smokeFrames(item: LocalizationQueueItem): number {
  return item.lanes.filter(l => l.has_smoke).reduce((sum, l) => sum + l.total_detections, 0);
}

// Classify-phase smoke types across the alert's smoke objects, deduped.
// `?? []` guards payloads from a backend that predates the field.
function smokeTypes(item: LocalizationQueueItem): string[] {
  return [...new Set(item.lanes.filter(l => l.has_smoke).flatMap(l => l.smoke_types ?? []))];
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
        <div className="bg-white shadow rounded-lg overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Preview
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Camera
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Organisation
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Smoke type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Recorded
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Frames
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
                  <td className="px-4 py-4 whitespace-nowrap">
                    <DetectionImageThumbnail
                      sequenceId={item.lanes[0].sequence_id}
                      className="h-16 w-24"
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {item.camera_name}
                    {item.azimuth !== null && item.azimuth !== undefined && (
                      <span className="ml-2 text-xs font-normal text-gray-400">
                        Azimuth: {item.azimuth}°
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {item.organisation_name}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {item.source_api}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {smokeTypes(item).map(type => (
                        <span
                          key={type}
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800"
                        >
                          {getSmokeTypeEmoji(type)} {formatSmokeType(type)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(item.recorded_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {smokeFrames(item)} frames
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
