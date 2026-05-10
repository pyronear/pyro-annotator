import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  Tag,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { useState } from 'react';
import { AlgoPrediction, SequenceGroup, SequenceGroupMember } from '@/types/api';

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
    },
  });

  const predictions: AlgoPrediction[] = member.first_detection_algo_predictions?.predictions ?? [];

  return (
    <div
      className={`relative rounded-lg border-2 border-gray-300 bg-white overflow-hidden ${
        member.has_annotation ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        title="Remove from group"
        onClick={e => {
          e.preventDefault();
          if (window.confirm(`Remove sequence #${member.sequence_id} from this group?`)) {
            removeMutation.mutate();
          }
        }}
        disabled={removeMutation.isPending}
        className="absolute top-2 right-2 z-20 p-1 rounded-full bg-white/90 border border-gray-300 hover:bg-red-50 hover:border-red-400 hover:text-red-600 disabled:opacity-50"
      >
        <X className="w-4 h-4" />
      </button>

      <Link
        to={`/sequences/${member.sequence_id}/annotate`}
        className="block hover:bg-blue-50"
        title="Open the per-sequence annotation page"
      >
        <div className="relative aspect-video bg-gray-100 overflow-hidden flex items-center justify-center">
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
                        className="absolute border-2 border-dashed border-yellow-400 pointer-events-none"
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
        <div className="px-2 py-1 text-xs text-gray-700">
          <div className="font-medium">seq #{member.sequence_id}</div>
          <div className="flex items-center justify-between">
            <span>{new Date(member.recorded_at).toLocaleString()}</span>
            {member.has_annotation ? (
              <CheckCircle className="w-3 h-3 text-green-500" aria-label="annotated" />
            ) : (
              <Clock className="w-3 h-3 text-orange-400" />
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function SequenceGroupAnnotatePage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: group,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sequenceGroup', groupId],
    queryFn: () => apiClient.getSequenceGroup(groupId),
    enabled: !Number.isNaN(groupId),
  });

  const validateMutation = useMutation({
    mutationFn: (validated: boolean) =>
      apiClient.patchSequenceGroup(groupId, { is_validated: validated }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequenceGroup', groupId] });
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header className="mb-4">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-800">
          ← Back
        </button>
        <div className="mt-1 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Sequence group #{group.id}</h1>
            <div className="text-sm text-gray-600 mt-1">
              camera {group.camera_id} · azimuth {group.azimuth}° · {group.members.length} members
              {group.smoke_type && (
                <span className="ml-2 inline-flex items-center gap-1 text-orange-700">
                  <Tag className="w-3 h-3" /> smoke / {group.smoke_type}
                </span>
              )}
              {group.false_positive_type && (
                <span className="ml-2 inline-flex items-center gap-1 text-gray-700">
                  <Tag className="w-3 h-3" /> FP / {group.false_positive_type}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {group.is_validated ? (
              <>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm">
                  <ShieldCheck className="w-4 h-4" /> Validated
                </span>
                <button
                  onClick={() => validateMutation.mutate(false)}
                  disabled={validateMutation.isPending}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  <ShieldOff className="w-3 h-3 inline mr-1" /> Unvalidate
                </button>
              </>
            ) : (
              <button
                onClick={() => validateMutation.mutate(true)}
                disabled={validateMutation.isPending}
                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300"
              >
                <ShieldCheck className="w-4 h-4 inline mr-1" /> Validate group
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="mb-3 px-3 py-2 rounded bg-gray-50 border border-gray-200 text-xs text-gray-600">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-4 h-3 border-2 border-red-500" />
            tracked prediction (per-sequence)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-4 h-3 border-2 border-dashed border-yellow-400" />
            group reference region
          </span>
          <span>Click a thumbnail to annotate the sequence.</span>
          <span>The X removes a sequence from this group.</span>
          {group.is_validated && (
            <span className="text-green-700">
              Group is validated — annotating any sequence will propagate the labels to all other
              unannotated members.
            </span>
          )}
        </div>
      </div>

      {group.members.length === 0 ? (
        <div className="px-4 py-12 text-center text-gray-500 border border-dashed border-gray-300 rounded">
          This group has no members.
        </div>
      ) : (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
  );
}
