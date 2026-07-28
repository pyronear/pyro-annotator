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
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { usePersistedTabState } from '@/hooks/usePersistedTabState';
import { formatRelativeTime } from '@/utils/relativeTime';
import { useState } from 'react';
import { AlgoPrediction, SequenceGroup, SequenceGroupMember } from '@/types/api';
import { ROUTES, classifyDetail, classifyGroup } from '@/utils/routes';

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

type Bbox = [number, number, number, number];

function isValidBox([x1, y1, x2, y2]: Bbox): boolean {
  return x2 > x1 && y2 > y1;
}

// Zoomed view of a single image centered on `box`. The same (already cached)
// detection image is reused and magnified with a CSS transform — no second
// fetch, no canvas — so small objects are legible next to the full frame.
function BboxCrop({ url, box }: { url: string; box: Bbox }) {
  const [x1, y1, x2, y2] = box;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  // Show the box plus a margin of one box-size on each side (region ≈ 3×),
  // then zoom so the whole region fits the cell; cap at 8× for tiny boxes.
  const regionW = Math.min(1, Math.max(x2 - x1, 0.001) * 3);
  const regionH = Math.min(1, Math.max(y2 - y1, 0.001) * 3);
  const zoom = Math.min(1 / regionW, 1 / regionH, 8);

  return (
    <img
      src={url}
      alt=""
      className="absolute inset-0 w-full h-full object-cover"
      style={{
        transformOrigin: `${cx * 100}% ${cy * 100}%`,
        transform: `translate(${(0.5 - cx) * 100}%, ${(0.5 - cy) * 100}%) scale(${zoom})`,
      }}
    />
  );
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
      className={`relative rounded-lg border-2 border-gray-300 bg-white overflow-hidden ${
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
        className="absolute top-2 right-2 z-20 p-1 rounded-full bg-white/90 border border-gray-300 hover:bg-red-50 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
      >
        <X className="w-4 h-4" />
      </button>

      <Link
        to={classifyDetail(member.sequence_id)}
        className="block hover:bg-blue-50"
        title="Open the per-sequence annotation page"
      >
        <div className="grid grid-cols-2">
          {/* Full frame with bbox overlays. */}
          <div className="relative aspect-video bg-gray-100 overflow-hidden flex items-center justify-center border-r border-gray-200">
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
              <Loader2 className="animate-spin w-5 h-5 text-gray-400" />
            )}
          </div>
          {/* Zoomed crop so small objects stay legible. Falls back to the
              plain frame when neither a prediction nor the group region
              yields a valid box to zoom into. */}
          <div className="relative aspect-video bg-gray-100 overflow-hidden flex items-center justify-center">
            {image?.url ? (
              isValidBox(cropBox) ? (
                <>
                  <BboxCrop url={image.url} box={cropBox} />
                  <span className="absolute bottom-1 right-1 z-10 px-1 rounded bg-black/50 text-white text-[10px] leading-tight pointer-events-none">
                    zoom
                  </span>
                </>
              ) : (
                <img src={image.url} alt="" className="w-full h-full object-cover" />
              )
            ) : (
              <Loader2 className="animate-spin w-5 h-5 text-gray-400" />
            )}
          </div>
        </div>
        <div className="px-2 py-1 text-xs text-gray-700 flex items-center justify-between">
          <span>
            <span className="font-medium">seq #{member.sequence_id}</span>
            <span className="text-gray-500" title={new Date(member.recorded_at).toLocaleString()}>
              {' · '}
              {formatRelativeTime(member.recorded_at)}
            </span>
          </span>
          {memberIsAnnotated(member) ? (
            <CheckCircle className="w-3 h-3 text-green-500" aria-label="annotated" />
          ) : (
            <Clock className="w-3 h-3 text-orange-400" />
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
      <div className="flex items-center justify-center h-96 text-gray-500">
        <Loader2 className="animate-spin w-6 h-6 mr-2" /> Loading group…
      </div>
    );
  }
  if (error || !group) {
    return (
      <div className="flex items-center justify-center h-96 text-red-600">
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
      <div className="fixed top-0 left-0 md:left-64 right-0 z-30 px-6 pt-3 pb-2.5 bg-white/85 border-b border-gray-200 backdrop-blur-sm shadow-sm">
        <Link to={ROUTES.CLASSIFY_GROUPS} className="text-sm text-gray-500 hover:text-gray-800">
          ← Sequence groups
        </Link>
        <div className="mt-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {cameraName} · {group.azimuth}°
            </h1>
            <span className="flex-none rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              {group.members.length} seq
            </span>
            {group.smoke_type ? (
              <span className="flex-none rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                smoke · {group.smoke_type}
              </span>
            ) : group.false_positive_type ? (
              <span className="flex-none rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                false positive · {group.false_positive_type.replace(/_/g, ' ')}
              </span>
            ) : (
              <span className="flex-none rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800">
                to label
              </span>
            )}
          </div>
          <div className="flex flex-none items-center gap-2">
            {prevId ? (
              <Link
                to={classifyGroup(prevId)}
                title="Previous group"
                className="p-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-300"
              >
                <ChevronLeft className="w-4 h-4" />
              </span>
            )}
            {nextId ? (
              <Link
                to={classifyGroup(nextId)}
                title="Next group"
                className="p-1.5 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-300"
              >
                <ChevronRight className="w-4 h-4" />
              </span>
            )}
            {group.is_validated ? (
              <>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm">
                  <ShieldCheck className="w-4 h-4" /> Validated
                </span>
                <button
                  onClick={() => validateMutation.mutate(false)}
                  disabled={validateMutation.isPending}
                  title="Re-open the group — labels stop propagating to members"
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  <ShieldOff className="w-3 h-3 inline mr-1" /> Unvalidate
                </button>
              </>
            ) : (
              <button
                onClick={() => validateMutation.mutate(true)}
                disabled={validateMutation.isPending}
                title="Confirms every sequence shows the same object and enables label propagation"
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300"
              >
                <ShieldCheck className="w-4 h-4 inline mr-1" /> Validate group
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Info className="w-4 h-4 flex-none mt-0.5 text-blue-600" />
        <div>
          <p className="font-semibold">How to label this group</p>
          <ul className="mt-1 space-y-0.5 list-disc list-inside">
            <li>
              <span className="font-medium">Label</span> — open any sequence below and label it.
            </li>
            <li>
              <span className="font-medium">Validate</span> — "Validate group" confirms every
              sequence shows the same object; once validated, one label propagates to all
              unannotated members.
            </li>
            <li>
              <span className="font-medium">Eject</span> — use ✕ on a card to remove a sequence that
              doesn't belong. Do this before validating.
            </li>
          </ul>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
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
            <div className="inline-flex rounded-md bg-gray-200 p-0.5 gap-0.5">
              {CARD_SIZES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  title={s.title}
                  aria-pressed={cardSize === s.value}
                  onClick={() => setCardSize(s.value)}
                  className={`px-2 py-0.5 rounded font-semibold ${
                    cardSize === s.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {group.members.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-500 border border-dashed border-gray-300 rounded">
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
