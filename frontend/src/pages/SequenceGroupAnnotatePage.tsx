import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { apiClient } from '@/services/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import {
  BulkAnnotateRequest,
  FalsePositiveType,
  SmokeType,
  SequenceGroupMember,
} from '@/types/api';

const SMOKE_TYPES: SmokeType[] = ['wildfire', 'industrial', 'other'];
const FP_TYPES: FalsePositiveType[] = [
  'antenna',
  'building',
  'cliff',
  'dark',
  'dust',
  'high_cloud',
  'low_cloud',
  'lens_flare',
  'lens_droplet',
  'light',
  'rain',
  'trail',
  'road',
  'sky',
  'tree',
  'water_body',
  'other',
];

type LabelKind = 'smoke' | 'false_positive';

function MemberThumb({
  member,
  selected,
  onToggle,
}: {
  member: SequenceGroupMember;
  selected: boolean;
  onToggle: () => void;
}) {
  // Use the first detection of the sequence as a thumbnail proxy.
  const { data: detectionsPage } = useQuery({
    queryKey: ['sequenceFirstDetection', member.sequence_id],
    queryFn: () =>
      apiClient.getDetections({
        sequence_id: member.sequence_id,
        size: 1,
        order_by: 'recorded_at',
        order_direction: 'asc',
      }),
  });
  const firstDetectionId = detectionsPage?.items[0]?.id ?? null;
  const { data: image } = useDetectionImage(firstDetectionId);

  return (
    <label
      className={`relative cursor-pointer rounded-lg border-2 transition ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300 hover:border-gray-400'
      } ${member.has_annotation ? 'opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="absolute top-2 left-2 z-10 w-5 h-5 cursor-pointer"
      />
      <div className="aspect-video bg-gray-100 overflow-hidden rounded-t-md flex items-center justify-center">
        {image?.url ? (
          <img
            src={image.url}
            alt={`seq ${member.sequence_id}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <Loader2 className="animate-spin w-5 h-5 text-gray-400" />
        )}
      </div>
      <div className="px-2 py-1 text-xs text-gray-700">
        <div className="font-medium">seq #{member.sequence_id}</div>
        <div className="flex items-center justify-between">
          <span>{new Date(member.recorded_at).toLocaleString()}</span>
          {member.has_annotation ? (
            <CheckCircle className="w-3 h-3 text-green-500" aria-label="already annotated" />
          ) : (
            <Clock className="w-3 h-3 text-orange-400" />
          )}
        </div>
      </div>
    </label>
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

  const [labelKind, setLabelKind] = useState<LabelKind>('smoke');
  const [smokeType, setSmokeType] = useState<SmokeType>('wildfire');
  const [fpType, setFpType] = useState<FalsePositiveType>('antenna');
  const [isUnsure, setIsUnsure] = useState(false);
  const [force, setForce] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Default selection: every member that isn't already annotated.
  useEffect(() => {
    if (!group) return;
    setSelectedIds(new Set(group.members.filter(m => !m.has_annotation).map(m => m.sequence_id)));
  }, [group]);

  const bulkMutation = useMutation({
    mutationFn: (payload: BulkAnnotateRequest) => apiClient.bulkAnnotateSequences(payload),
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

  const toggleSelect = (sid: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sid)) {
        next.delete(sid);
      } else {
        next.add(sid);
      }
      return next;
    });
  };

  const allSelected = group.members.every(m => selectedIds.has(m.sequence_id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(group.members.map(m => m.sequence_id)));
    }
  };

  const submit = () => {
    const payload: BulkAnnotateRequest = {
      sequence_ids: Array.from(selectedIds),
      group_id: group.id,
      is_unsure: isUnsure,
      force,
    };
    if (labelKind === 'smoke') payload.smoke_type = smokeType;
    else payload.false_positive_type = fpType;
    bulkMutation.mutate(payload);
  };

  const result = bulkMutation.data;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header className="mb-4">
        <button onClick={() => navigate(-1)} className="text-sm text-gray-500 hover:text-gray-800">
          ← Back
        </button>
        <h1 className="text-2xl font-semibold mt-1">Sequence group #{group.id}</h1>
        <div className="text-sm text-gray-600 mt-1">
          camera {group.camera_id} · azimuth {group.azimuth}° · {group.members.length} members
          {group.smoke_type && ` · current label: smoke / ${group.smoke_type}`}
          {group.false_positive_type && ` · current label: FP / ${group.false_positive_type}`}
        </div>
      </header>

      <section className="mb-4 flex items-center justify-between">
        <label className="flex items-center text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="mr-2 w-4 h-4"
          />
          Select all ({group.members.length})
        </label>
        <span className="text-sm text-gray-600">{selectedIds.size} selected</span>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {group.members.map(m => (
          <MemberThumb
            key={m.sequence_id}
            member={m}
            selected={selectedIds.has(m.sequence_id)}
            onToggle={() => toggleSelect(m.sequence_id)}
          />
        ))}
      </section>

      <section className="bg-gray-50 border border-gray-200 rounded-lg p-4 sticky bottom-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Label kind</label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="kind"
                  checked={labelKind === 'smoke'}
                  onChange={() => setLabelKind('smoke')}
                  className="mr-2"
                />
                Smoke
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="kind"
                  checked={labelKind === 'false_positive'}
                  onChange={() => setLabelKind('false_positive')}
                  className="mr-2"
                />
                False positive
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
            {labelKind === 'smoke' ? (
              <select
                value={smokeType}
                onChange={e => setSmokeType(e.target.value as SmokeType)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                {SMOKE_TYPES.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={fpType}
                onChange={e => setFpType(e.target.value as FalsePositiveType)}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                {FP_TYPES.map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isUnsure}
                onChange={e => setIsUnsure(e.target.checked)}
                className="mr-2"
              />
              Mark as unsure
            </label>
            {(group.smoke_type || group.false_positive_type) && (
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={e => setForce(e.target.checked)}
                  className="mr-2"
                />
                Overwrite group's existing label
              </label>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            Applies to the {selectedIds.size} selected sequences and writes the label onto the
            group.
          </div>
          <button
            onClick={submit}
            disabled={selectedIds.size === 0 || bulkMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
          >
            {bulkMutation.isPending ? 'Applying…' : `Apply to ${selectedIds.size} selected`}
          </button>
        </div>

        {result && (
          <div className="mt-3 text-sm">
            <span className="text-green-700">{result.applied.length} applied</span>
            {' · '}
            <span className="text-amber-700">{result.skipped.length} skipped</span>
            {result.group_label_updated && (
              <span className="ml-2 text-blue-700">· group label saved</span>
            )}
            {result.skipped.length > 0 && (
              <ul className="text-xs text-gray-500 mt-1 list-disc pl-5">
                {result.skipped.map(s => (
                  <li key={s.sequence_id}>
                    seq {s.sequence_id}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {bulkMutation.isError && (
          <div className="mt-3 text-sm text-red-600">
            Bulk annotation failed: {(bulkMutation.error as Error).message}
          </div>
        )}
      </section>
    </div>
  );
}
