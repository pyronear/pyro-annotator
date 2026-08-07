import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { apiClient } from '@/services/api';
import { LocalizationQueueItem } from '@/types/api';
import { LocalizeQueueTable, TablePagination } from '@/components/sequences';
import { Tooltip } from '@/components/ui/Tooltip';
import { TABLE_CARD_CLASSES } from '@/components/sequences/tableStyles';
import { pickNextLocalizeLane } from '@/utils/annotation/localizeUtils';
import { localizeDetail, ROUTES } from '@/utils/routes';
import { QUEUE_COUNTS_KEY } from '@/hooks/useQueueTotals';

export default function DetectionAnnotatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // Skipped-backlog view (spec: alert-skip-escape-hatch). Plain state, not
  // persisted — the backlog is a place to visit, not a mode to stay in.
  const [showSkipped, setShowSkipped] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['localization-queue', page, showSkipped],
    queryFn: () => apiClient.getLocalizationQueue({ page, size: 50, skipped: showSkipped }),
  });

  // Count for the "Skipped (n)" toggle label, independent of the view shown.
  const { data: skippedCount } = useQuery({
    queryKey: ['localization-queue-skipped-count'],
    queryFn: () => apiClient.getLocalizationQueue({ skipped: true, size: 1 }),
    select: queue => queue.total,
  });

  const unskipMutation = useMutation({
    mutationFn: (item: LocalizationQueueItem) =>
      apiClient.unskipAlert(item.source_api, item.platform_alert_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localization-queue'] });
      queryClient.invalidateQueries({ queryKey: ['localization-queue-skipped-count'] });
      // Carries the shared localize-queue total behind both the sidebar badge
      // and the dashboard card, so both follow an unskip.
      queryClient.invalidateQueries({ queryKey: [QUEUE_COUNTS_KEY] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
    },
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
          <h1 className="text-2xl font-bold text-gray-900">Alerts to localize</h1>
          <p className="mt-1 text-sm text-gray-500">
            Smoke alerts with model-proposed boxes — accept or fix them so every frame has a tight
            box around the smoke
          </p>
        </div>
        <Tooltip tip="Alerts parked as skipped — too hard to annotate with the current tools. Toggle to review and unskip them.">
          <button
            type="button"
            aria-pressed={showSkipped}
            onClick={() => {
              setShowSkipped(v => !v);
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 font-body text-sm font-medium ${
              showSkipped
                ? 'border-char bg-ash text-char'
                : 'border-line bg-paper text-haze hover:bg-ash'
            }`}
          >
            Skipped
            <span className="font-data text-xs">{skippedCount ?? 0}</span>
          </button>
        </Tooltip>
      </div>

      {items.length === 0 && showSkipped ? (
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center max-w-md">
            <h2 className="font-display text-base font-semibold text-char">No skipped alerts</h2>
            <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
              Nothing is parked here — alerts skipped from this queue would show up in this view.
            </p>
          </div>
        </div>
      ) : items.length === 0 ? (
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
          <LocalizeQueueTable
            items={items}
            onItemClick={handleAlertClick}
            skippedView={showSkipped}
            onUnskip={item => unskipMutation.mutate(item)}
          />
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
