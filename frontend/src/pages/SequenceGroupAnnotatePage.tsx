import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { Bbox, BboxCrop } from '@/components/annotation/BboxCrop';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { useState } from 'react';
import { AlgoPrediction, SequenceGroup, SequenceGroupMember } from '@/types/api';
import { ROUTES, classifyDetail, classifyGroup } from '@/utils/routes';
import { UNSURE_GROUP_TIP } from '@/utils/groupLabels';
import { formatDateTime } from '@/utils/datetime';

// Minimum card width per size step; the auto-fill grid derives the column
// count from it, so bigger cards automatically flow into more rows.
type CardSize = 'sm' | 'md' | 'lg';
const CARD_MIN_WIDTH: Record<CardSize, number> = { sm: 340, md: 460, lg: 640 };
const CARD_SIZES: { value: CardSize; label: string; title: string }[] = [
  { value: 'sm', label: 'S', title: 'Small cards' },
  { value: 'md', label: 'M', title: 'Medium cards' },
  { value: 'lg', label: 'L', title: 'Large cards' },
];

// Stages past the auto-import placeholder. Mirrors the backend's
// _BULK_LOCKED_STAGES set in
// annotation_api/src/app/api/api_v1/endpoints/sequence_annotations.py
// so the UI matches what propagation considers truly annotated — keep
// both lists in sync when a new processing stage is added.
const ANNOTATED_STAGES = new Set(['seq_annotation_done', 'annotated']);

function memberIsAnnotated(m: SequenceGroupMember): boolean {
  return (
    m.annotation_processing_stage != null && ANNOTATED_STAGES.has(m.annotation_processing_stage)
  );
}

function isValidBox([x1, y1, x2, y2]: Bbox): boolean {
  return x2 > x1 && y2 > y1;
}

function MemberCard({
  member,
  groupId,
  groupBbox,
}: {
  member: SequenceGroupMember;
  groupId: number;
  groupBbox: SequenceGroup['representative_bbox'];
}) {
  const queryClient = useQueryClient();
  const { data: image } = useDetectionImage(member.first_detection_id);
  const [imgLoaded, setImgLoaded] = useState(false);

  const removeMutation = useMutation({
    mutationFn: () => apiClient.removeSequenceFromGroup(groupId, member.sequence_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequenceGroup', groupId] });
      queryClient.invalidateQueries({ queryKey: ['sequenceGroupsList'] });
      queryClient.invalidateQueries({ queryKey: ['sequenceGroupStats'] });
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
    },
  });

  const predictions: AlgoPrediction[] = member.first_detection_algo_predictions?.predictions ?? [];

  // Crop target: the tracked prediction(s) for this frame (the actual object),
  // falling back to the group reference region when the frame has none.
  const validPreds = predictions.filter(p => isValidBox(p.xyxyn));
  const cropBox: Bbox = validPreds.length
    ? [
        Math.min(...validPreds.map(p => p.xyxyn[0])),
        Math.min(...validPreds.map(p => p.xyxyn[1])),
        Math.max(...validPreds.map(p => p.xyxyn[2])),
        Math.max(...validPreds.map(p => p.xyxyn[3])),
      ]
    : groupBbox.xyxyn;

  return (
    <div
      className={`relative border border-line bg-paper overflow-hidden ${
        memberIsAnnotated(member) ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        title="Remove from group"
        onClick={e => {
          e.preventDefault();
          if (
            window.confirm(
              `Remove sequence #${member.sequence_id} from this group?\n\n` +
                'This marks it as a manual outlier — future imports will not ' +
                'auto-rejoin it. Recovery requires an API call (or DB write).'
            )
          ) {
            removeMutation.mutate();
          }
        }}
        disabled={removeMutation.isPending}
        className="absolute top-2 right-2 z-20 p-1 rounded-full bg-paper/90 border border-line text-haze hover:bg-signal-soft hover:border-signal hover:text-signal disabled:opacity-50"
      >
        <X className="w-4 h-4" />
      </button>

      <Link
        to={classifyDetail(member.sequence_id)}
        className="block hover:bg-ash"
        title="Open the per-sequence annotation page"
      >
        <div className="grid grid-cols-2">
          {/* Full frame with bbox overlays. */}
          <div className="relative aspect-video bg-ash overflow-hidden flex items-center justify-center border-r border-line">
            {image?.url ? (
              <>
                <img
                  src={image.url}
                  alt={`seq ${member.sequence_id}`}
                  className="w-full h-full object-cover"
                  onLoad={() => setImgLoaded(true)}
                />
                {imgLoaded && (
                  <>
                    {predictions.map((p, i) => {
                      const [x1, y1, x2, y2] = p.xyxyn;
                      if (x2 <= x1 || y2 <= y1) return null;
                      return (
                        <div
                          key={`pred-${i}`}
                          className="absolute border-2 border-red-500 pointer-events-none"
                          style={{
                            left: `${x1 * 100}%`,
                            top: `${y1 * 100}%`,
                            width: `${(x2 - x1) * 100}%`,
                            height: `${(y2 - y1) * 100}%`,
                          }}
                        />
                      );
                    })}
                    {(() => {
                      const [gx1, gy1, gx2, gy2] = groupBbox.xyxyn;
                      if (gx2 <= gx1 || gy2 <= gy1) return null;
                      return (
                        <div
                          className="absolute border-2 border-dashed border-fuchsia-500 pointer-events-none"
                          style={{
                            left: `${gx1 * 100}%`,
                            top: `${gy1 * 100}%`,
                            width: `${(gx2 - gx1) * 100}%`,
                            height: `${(gy2 - gy1) * 100}%`,
                          }}
                        />
                      );
                    })()}
                  </>
                )}
              </>
            ) : (
              <Loader2 className="animate-spin w-5 h-5 text-haze" />
            )}
          </div>
          {/* Zoomed crop so small objects stay legible. Falls back to the
              plain frame when neither a prediction nor the group region
              yields a valid box to zoom into. */}
          <div className="relative aspect-video bg-ash overflow-hidden flex items-center justify-center">
            {image?.url ? (
              isValidBox(cropBox) ? (
                <>
                  <BboxCrop url={image.url} box={cropBox} />
                  <span className="absolute bottom-1 right-1 z-10 px-1 rounded bg-char/70 text-white text-[10px] leading-tight pointer-events-none">
                    zoom
                  </span>
                </>
              ) : (
                <img src={image.url} alt="" className="w-full h-full object-cover" />
              )
            ) : (
              <Loader2 className="animate-spin w-5 h-5 text-haze" />
            )}
          </div>
        </div>
        <div className="px-2 py-1 font-data text-detail text-haze flex items-center justify-between">
          {/* Full timestamp like the queue tables — the sequence id means
              nothing to annotators. */}
          <span>{formatDateTime(member.recorded_at)}</span>
          {memberIsAnnotated(member) ? (
            <CheckCircle className="w-3 h-3 text-pine" aria-label="annotated" />
          ) : (
            <Clock className="w-3 h-3 text-haze" />
          )}
        </div>
      </Link>
    </div>
  );
}

export default function SequenceGroupAnnotatePage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const queryClient = useQueryClient();
  const [cardSize, setCardSize] = usePersistedTabState<CardSize>('groupAnnotateCardSize', 'md');
  // localStorage may hold a stale value from a renamed size key; an
  // undefined width would invalidate the whole gridTemplateColumns rule.
  const cardMinWidth = CARD_MIN_WIDTH[cardSize] ?? CARD_MIN_WIDTH.md;

  const {
    data: group,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sequenceGroup', groupId],
    queryFn: () => apiClient.getSequenceGroup(groupId),
    enabled: !Number.isNaN(groupId),
    // Keep the previous group rendered while the next loads so chevron
    // navigation doesn't unmount the header mid-click.
    placeholderData: prev => prev,
  });

  // Neighbor ids for the prev/next chevrons, from the list endpoint's
  // default order (biggest group first) — the same queue the list page
  // shows unfiltered. Key shares the 'sequenceGroupsList' prefix so the
  // existing mutation invalidations refresh it too.
  const { data: neighborList } = useQuery({
    queryKey: ['sequenceGroupsList', 'neighbors'],
    queryFn: () => apiClient.getSequenceGroups({ page: 1, size: 100 }),
  });
  const neighborIds = neighborList?.items.map(g => g.id) ?? [];
  const neighborIdx = neighborIds.indexOf(groupId);
  const prevId = neighborIdx > 0 ? neighborIds[neighborIdx - 1] : null;
  const nextId =
    neighborIdx >= 0 && neighborIdx < neighborIds.length - 1 ? neighborIds[neighborIdx + 1] : null;

  const validateMutation = useMutation({
    mutationFn: (validated: boolean) =>
      apiClient.patchSequenceGroup(groupId, { is_validated: validated }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequenceGroup', groupId] });
      queryClient.invalidateQueries({ queryKey: ['sequenceGroupsList'] });
      queryClient.invalidateQueries({ queryKey: ['sequenceGroupStats'] });
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-stats'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96 font-body text-haze">
        <Loader2 className="animate-spin w-6 h-6 mr-2 text-ember" /> Loading group…
      </div>
    );
  }
  if (error || !group) {
    return (
      <div className="flex items-center justify-center h-96 font-body text-signal">
        <AlertCircle className="w-6 h-6 mr-2" />
        Failed to load group {groupId}
      </div>
    );
  }

  const cameraName = group.members[0]?.camera_name ?? `camera #${group.camera_id}`;

  return (
    <div className="space-y-6 pt-20">
      {/* Pinned header, same idiom as AnnotationHeader on the per-sequence
          page: fixed to the viewport past the sidebar (md:left-64) so the
          primary action (validate) stays reachable while scrolling the
          member grid. The root's pt-20 reserves its space. */}
      <div className="fixed top-0 left-0 md:left-64 right-0 z-30 px-6 pt-3 pb-2.5 bg-paper/85 border-b border-line backdrop-blur-sm">
        <Link
          to={ROUTES.CLASSIFY_GROUPS}
          className="font-body text-detail text-haze hover:text-char"
        >
          ← Recurring objects
        </Link>
        <div className="mt-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* text-heading, not text-title — this pinned bar is a working
                toolbar, so the camera name anchors it without page-h1 scale. */}
            <h1 className="font-display text-heading font-semibold text-char truncate">
              {cameraName} · {group.azimuth}°
            </h1>
            <span className="flex-none rounded-full bg-ash px-2.5 py-0.5 font-data text-xs font-semibold text-char">
              {group.members.length} seq
            </span>
            {group.smoke_type ? (
              <span className="flex-none rounded-full border border-line bg-paper px-2.5 py-0.5 font-body text-xs font-semibold text-char">
                smoke · {group.smoke_type}
              </span>
            ) : group.false_positive_type ? (
              <span className="flex-none rounded-full border border-line bg-paper px-2.5 py-0.5 font-body text-xs font-semibold text-char">
                false positive · {group.false_positive_type.replace(/_/g, ' ')}
              </span>
            ) : group.is_unsure ? (
              // The only header chip whose state isn't self-evident, and the
              // landing point from the Unsure tab — so unlike its siblings it
              // carries its own explanation, in the page's tooltip idiom.
              <span tabIndex={0} className="group relative flex-none">
                <span className="rounded-full bg-ash px-2.5 py-0.5 font-body text-xs font-semibold text-haze">
                  unsure
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-max max-w-[20rem] whitespace-normal rounded bg-char px-2.5 py-2 font-body text-xs font-normal text-white group-hover:block group-focus-within:block"
                >
                  {UNSURE_GROUP_TIP}
                </span>
              </span>
            ) : (
              <span className="flex-none rounded-full bg-ember-soft px-2.5 py-0.5 font-body text-xs font-semibold text-ember">
                to label
              </span>
            )}
            {/* Hover help replaces the old always-visible callout — same
                bubble idiom as SequenceGroupsListPage.headerTip. */}
            {/* tabIndex + focus-within keep the workflow help reachable by
                keyboard now that the always-visible callout is gone. */}
            <span tabIndex={0} className="group relative flex-none">
              <Info className="w-4 h-4 text-haze hover:text-char cursor-help" />
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-max max-w-[20rem] whitespace-normal rounded bg-char px-2.5 py-2 font-body text-xs font-normal text-white group-hover:block group-focus-within:block"
              >
                <span className="block">
                  <span className="font-semibold">Label</span> — open any sequence below and label
                  it.
                </span>
                <span className="mt-1 block">
                  <span className="font-semibold">Validate</span> — confirms every sequence shows
                  the same object; one label then propagates to all unannotated members.
                </span>
                <span className="mt-1 block">
                  <span className="font-semibold">Eject</span> — ✕ removes a sequence that doesn't
                  belong. Do it before validating.
                </span>
              </span>
            </span>
          </div>
          <div className="flex flex-none items-center gap-2">
            {prevId ? (
              <Link
                to={classifyGroup(prevId)}
                title="Previous object"
                className="p-1.5 rounded-lg border border-line bg-paper text-haze hover:bg-ash"
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="p-1.5 rounded-lg border border-line bg-paper text-line"
              >
                <ChevronLeft className="w-4 h-4" />
              </span>
            )}
            {nextId ? (
              <Link
                to={classifyGroup(nextId)}
                title="Next object"
                className="p-1.5 rounded-lg border border-line bg-paper text-haze hover:bg-ash"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="p-1.5 rounded-lg border border-line bg-paper text-line"
              >
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
            {group.is_validated ? (
              <>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-pine-soft font-body text-sm font-semibold text-pine">
                  <ShieldCheck className="w-4 h-4" /> Validated
                </span>
                <button
                  onClick={() => validateMutation.mutate(false)}
                  disabled={validateMutation.isPending}
                  title="Re-open the group — labels stop propagating to members"
                  className="rounded-lg border border-line bg-paper px-3 py-1.5 font-body text-sm font-medium text-char hover:bg-ash disabled:opacity-50"
                >
                  <ShieldOff className="w-3 h-3 inline mr-1" /> Unvalidate
                </button>
              </>
            ) : (
              <button
                onClick={() => validateMutation.mutate(true)}
                disabled={validateMutation.isPending}
                title="Confirms every sequence shows the same object and enables label propagation"
                className="rounded-lg bg-ember px-3.5 py-1.5 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4 inline mr-1" /> Validate group
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        {/* mb-4 matches the grid's gap-4 so the legend row and card rows
            share one vertical rhythm. */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 rounded-lg border border-line bg-paper px-3 py-1.5 font-body text-detail text-haze">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-3 border-2 border-red-500" />
              detected object
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-4 h-3 border-2 border-dashed border-fuchsia-500" />
              group reference region
            </span>
            <span>left: full frame · right: zoom</span>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <span>Card size</span>
            <div className="inline-flex rounded-md border border-line bg-ash p-0.5 gap-0.5">
              {CARD_SIZES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  title={s.title}
                  aria-pressed={cardSize === s.value}
                  onClick={() => setCardSize(s.value)}
                  className={`px-2 py-0.5 rounded font-data font-semibold ${
                    cardSize === s.value ? 'bg-paper text-char' : 'text-haze hover:text-char'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {group.members.length === 0 ? (
          <div className="px-4 py-12 text-center font-body text-haze border border-dashed border-line rounded-card">
            This group has no members.
          </div>
        ) : (
          <section
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardMinWidth}px, 100%), 1fr))`,
            }}
          >
            {group.members.map(m => (
              <MemberCard
                key={m.sequence_id}
                member={m}
                groupId={group.id}
                groupBbox={group.representative_bbox}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
