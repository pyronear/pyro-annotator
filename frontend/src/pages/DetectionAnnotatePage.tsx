import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { apiClient } from '@/services/api';
import { LocalizationQueueItem } from '@/types/api';
import { LocalizeQueueTable, TablePagination } from '@/components/sequences';
import { TABLE_CARD_CLASSES } from '@/components/sequences/tableStyles';
import { pickNextLocalizeLane } from '@/utils/annotation/localizeUtils';
import { localizeDetail, ROUTES } from '@/utils/routes';

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pine"></div>
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
          <div className="text-center max-w-md">
            <span
              aria-hidden="true"
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft"
            >
              <Check className="h-7 w-7 text-pine" />
            </span>
            <h2 className="mt-4 font-display text-base font-semibold text-char">
              Localization queue is clear
            </h2>
            <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
              Nice work — nothing to box right now. Classifying more alerts is what fills this
              queue.
            </p>
            <Link
              to={ROUTES.CLASSIFY}
              className="mt-5 inline-block rounded-lg bg-pine px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
            >
              Start classifying
            </Link>
          </div>
        </div>
      ) : (
        <div className={TABLE_CARD_CLASSES}>
          <LocalizeQueueTable items={items} onItemClick={handleAlertClick} />
          {data && (
            <TablePagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              itemsLabel="alerts"
              onPageChange={setPage}
            />
          )}
        </div>
      )}
    </div>
  );
}
