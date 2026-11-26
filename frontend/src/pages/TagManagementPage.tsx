import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Tag as TagIcon, Trash2, UserX, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/store/useAuthStore';
import { useOrganizations } from '@/hooks/useOrganizations';
import { formatDate } from '@/utils/datetime';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import type { Tag, TagCreate, TagFilter } from '@/types/api';

const TAGS_QUERY_KEY = QUERY_KEYS.TAGS;

/**
 * The calendar day of an instant in Europe/Paris, as YYYY-MM-DD: the backend
 * reads tag periods as Paris days (23:30 UTC on 31/07 is 01/08).
 */
function parisDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const EYEBROW = 'font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze';
const TH = `px-4 py-3 text-left ${EYEBROW}`;
const INPUT =
  'block w-full px-3 py-2 font-body text-sm text-char border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-ember focus:border-ember transition-colors';
const PRIMARY_BTN =
  'inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
const SECONDARY_BTN =
  'inline-flex items-center rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash';
const DANGER_BTN =
  'inline-flex items-center rounded-lg bg-signal px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

type MutationError = { detail?: string; message?: string } | null;

export default function TagManagementPage() {
  const { isAdmin } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: organizations = [] } = useOrganizations();
  const [showCreate, setShowCreate] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);

  const { data: tags, isLoading } = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: () => apiClient.getTags(),
  });

  const createMutation = useMutation({
    mutationFn: (payload: TagCreate) => apiClient.createTag(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
      setShowCreate(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
      setTagToDelete(null);
    },
  });

  // Tags are managed by admins only, like the backend /tags endpoints.
  if (!isAdmin()) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <UserX className="mx-auto h-12 w-12 text-haze" />
          <h3 className="mt-2 font-body text-sm font-medium text-char">Access denied</h3>
          <p className="mt-1 font-body text-sm text-haze">Only admins can manage tags.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight text-char">
            Tag Management
          </h1>
          <p className="mt-1 font-body text-body text-haze">
            Tag alerts by organisation and period to scope what annotators see
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className={PRIMARY_BTN}>
          <Plus className="w-4 h-4 mr-2" />
          Create Tag
        </button>
      </div>

      <div className="rounded-card border border-line bg-paper overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember" />
          </div>
        ) : !tags?.length ? (
          <div className="py-14 text-center">
            <TagIcon className="mx-auto h-8 w-8 text-haze" />
            <p className="mt-2 font-body text-sm font-medium text-char">No tags yet</p>
            <p className="mt-1 font-body text-detail text-haze">
              Create one to group alerts by organisation and period.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-ash">
                <tr>
                  <th className={TH}>Tag</th>
                  <th className={clsx(TH, 'text-right')}>Alerts</th>
                  <th className={clsx(TH, 'text-right')}>Users</th>
                  <th className={TH}>Created</th>
                  <th className={clsx(TH, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody className="bg-paper divide-y divide-line">
                {tags.map(tag => (
                  <tr key={tag.id} className="hover:bg-ash">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div
                        className="max-w-[14rem] truncate font-data text-sm font-semibold text-char"
                        title={tag.name}
                      >
                        {tag.name}
                      </div>
                      {tag.description && (
                        <div className="mt-0.5 font-body text-detail text-haze">
                          {tag.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right font-data text-sm font-semibold text-char">
                      {tag.alert_count}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right font-data text-sm text-haze">
                      {tag.user_count}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap font-data text-detail text-haze">
                      {formatDate(tag.created_at)}
                      {tag.created_by_username && (
                        <div className="font-body">by {tag.created_by_username}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => setTagToDelete(tag)}
                        className="text-haze hover:text-signal p-1 rounded"
                        title="Delete tag"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTagModal
          organisationNames={organizations.map(o => o.name)}
          existingNames={(tags ?? []).map(t => t.name)}
          onClose={() => setShowCreate(false)}
          onSubmit={payload => createMutation.mutate(payload)}
          isLoading={createMutation.isPending}
          error={createMutation.error as MutationError}
        />
      )}

      {tagToDelete && (
        <DeleteTagModal
          tag={tagToDelete}
          onClose={() => setTagToDelete(null)}
          onConfirm={() => deleteMutation.mutate(tagToDelete.id)}
          isLoading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);
}

function ModalShell({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEscapeToClose(onClose);
  return (
    <div className="fixed inset-0 bg-char/50 flex items-center justify-center p-4 z-50">
      <div
        className={clsx(
          'rounded-card border border-line bg-paper w-full max-h-[90vh] overflow-y-auto',
          wide ? 'max-w-xl' : 'max-w-md'
        )}
      >
        <div className="flex items-start justify-between border-b border-line px-[22px] py-4">
          <div>
            <div className={EYEBROW}>{eyebrow}</div>
            <h3 className="mt-1 font-display text-heading font-semibold text-char">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-haze hover:text-char">
            <span className="sr-only">Close</span>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create

type PeriodPreset = 'all' | '7d' | '30d' | '90d' | 'custom';

const PERIOD_PRESETS: { key: PeriodPreset; label: string; days?: number }[] = [
  { key: 'all', label: 'All time' },
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'custom', label: 'Custom' },
];

/** Ranges end today, in Europe/Paris days; the end can never be in the future. */
function presetRange(days: number): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { dateFrom: parisDay(from), dateTo: parisDay(to) };
}

/**
 * Suggested name: `<org|all-orgs>_<from>_<to>`. Org names are slugged;
 * several orgs are joined with `+`.
 */
function suggestName(filter: TagFilter): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const orgPart = filter.organisation_names.length
    ? filter.organisation_names.map(slug).join('+')
    : 'all-orgs';
  const period =
    filter.recorded_from || filter.recorded_to
      ? `_${filter.recorded_from || 'start'}_${filter.recorded_to || 'now'}`
      : '';
  // Cut at the backend's 50-character limit.
  return `${orgPart}${period}`.slice(0, 50);
}

function CreateTagModal({
  organisationNames,
  existingNames,
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  organisationNames: string[];
  existingNames: string[];
  onClose: () => void;
  onSubmit: (payload: TagCreate) => void;
  isLoading: boolean;
  error: MutationError;
}) {
  const [organisations, setOrganisations] = useState<string[]>([]);
  const [preset, setPreset] = useState<PeriodPreset>('30d');
  const [range, setRange] = useState(presetRange(30));
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState('');

  const filter: TagFilter = useMemo(
    () => ({
      organisation_names: organisations,
      recorded_from: preset === 'all' ? null : range.dateFrom || null,
      recorded_to: preset === 'all' ? null : range.dateTo || null,
    }),
    [organisations, preset, range]
  );

  const suggested = suggestName(filter);
  const effectiveName = nameTouched ? name : suggested;
  const today = parisDay(new Date());
  // Names are unique whatever their case: "Org-A" collides with "org-a".
  const nameTaken = existingNames.some(n => n.toLowerCase() === effectiveName.trim().toLowerCase());
  const { recorded_from: from, recorded_to: to } = filter;
  const rangeError =
    from && to && from > to
      ? 'The start date is after the end date.'
      : (from && from > today) || (to && to > today)
        ? 'Dates cannot be in the future: a tag only covers alerts that already exist.'
        : null;

  // Live count from the backend dry run, once the filter settles.
  const settledFilter = useDebounced(filter, 300);
  const { data: matching, isFetching: counting } = useQuery({
    queryKey: [...TAGS_QUERY_KEY, 'dry-run', settledFilter],
    queryFn: () => apiClient.dryRunTag(settledFilter),
    enabled: !rangeError,
    placeholderData: previous => previous,
  });
  const countReady = !rangeError && !counting && settledFilter === filter;
  const canSubmit =
    !!effectiveName.trim() && !nameTaken && !rangeError && countReady && (matching ?? 0) > 0;

  const toggleOrg = (org: string) =>
    setOrganisations(prev => (prev.includes(org) ? prev.filter(o => o !== org) : [...prev, org]));

  const choosePreset = (p: (typeof PERIOD_PRESETS)[number]) => {
    setPreset(p.key);
    if (p.days) setRange(presetRange(p.days));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name: effectiveName.trim(),
      description: description.trim() || null,
      filter,
    });
  };

  return (
    <ModalShell eyebrow="New tag" title="Create a tag from a filter" onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        <div className="space-y-6 px-[22px] py-5">
          {error && (
            <div className="bg-signal-soft rounded-lg p-3 font-body text-sm text-signal">
              {error.detail || 'Failed to create tag'}
            </div>
          )}

          {/* Step 1 — filters */}
          <section className="border-l-2 border-ember pl-3.5 space-y-4">
            <div className={clsx(EYEBROW, 'text-ember')}>1 · Which alerts</div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-body text-sm font-medium text-char">Organisation</span>
                <button
                  type="button"
                  onClick={() => setOrganisations([])}
                  className="font-body text-detail text-haze hover:text-char"
                >
                  All organisations
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {organisationNames.length === 0 && (
                  <span className="font-body text-detail text-haze">No organisation found</span>
                )}
                {organisationNames.map(org => {
                  const selected = organisations.includes(org);
                  return (
                    <button
                      type="button"
                      key={org}
                      onClick={() => toggleOrg(org)}
                      aria-pressed={selected}
                      className={clsx(
                        'inline-flex items-center rounded-full px-3 py-1 font-body text-xs font-medium transition-colors',
                        selected ? 'bg-pine-soft text-pine' : 'bg-ash text-haze hover:text-char'
                      )}
                    >
                      {org}
                    </button>
                  );
                })}
              </div>
              {organisations.length === 0 && (
                <p className="mt-1.5 font-body text-detail text-haze">
                  None selected: every organisation.
                </p>
              )}
            </div>

            <div>
              <span className="mb-2 block font-body text-sm font-medium text-char">
                Period (alert recorded date, Paris time)
              </span>
              <div className="flex flex-wrap gap-2">
                {PERIOD_PRESETS.map(p => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => choosePreset(p)}
                    aria-pressed={preset === p.key}
                    className={clsx(
                      'inline-flex items-center rounded-full px-3 py-1 font-body text-xs font-medium transition-colors',
                      preset === p.key
                        ? 'bg-pine-soft text-pine'
                        : 'bg-ash text-haze hover:text-char'
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {preset !== 'all' && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={EYEBROW}>From</span>
                    <input
                      type="date"
                      value={range.dateFrom}
                      max={today}
                      onChange={e => {
                        setPreset('custom');
                        setRange(r => ({ ...r, dateFrom: e.target.value }));
                      }}
                      className={clsx(INPUT, 'mt-1 font-data')}
                    />
                  </label>
                  <label className="block">
                    <span className={EYEBROW}>To</span>
                    <input
                      type="date"
                      value={range.dateTo}
                      max={today}
                      onChange={e => {
                        setPreset('custom');
                        setRange(r => ({ ...r, dateTo: e.target.value }));
                      }}
                      className={clsx(INPUT, 'mt-1 font-data')}
                    />
                  </label>
                </div>
              )}
              {rangeError && (
                <p className="mt-1.5 font-body text-detail text-signal">{rangeError}</p>
              )}
            </div>

            {/* Live preview of the match */}
            <div className="flex items-center justify-between rounded-lg bg-ash px-4 py-3">
              <span className="font-body text-sm text-haze">Matching alerts right now</span>
              <span
                className={clsx(
                  'font-data text-[22px] font-semibold text-char transition-opacity',
                  !countReady && 'opacity-40'
                )}
              >
                {rangeError ? '—' : (matching ?? '…')}
              </span>
            </div>
            <p className="font-body text-detail text-haze">
              Snapshot: alerts imported later that match this filter are{' '}
              <span className="font-medium text-char">not</span> tagged automatically.
            </p>
          </section>

          {/* Step 2 — name */}
          <section className="border-l-2 border-char pl-3.5 space-y-4">
            <div className={clsx(EYEBROW, 'text-char')}>2 · Name it</div>
            <label className="block">
              <span className="mb-1 flex items-baseline justify-between">
                <span className="font-body text-sm font-medium text-char">Tag name</span>
                {nameTouched && name !== suggested && (
                  <button
                    type="button"
                    onClick={() => setNameTouched(false)}
                    className="font-body text-detail text-haze hover:text-char"
                  >
                    Use suggestion →
                  </button>
                )}
              </span>
              <input
                type="text"
                maxLength={50}
                value={effectiveName}
                onChange={e => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                className={clsx(INPUT, 'font-data', nameTaken && 'border-signal')}
              />
              <span className="mt-1 flex justify-between font-body text-detail text-haze">
                <span className={clsx(nameTaken && 'text-signal')}>
                  {nameTaken
                    ? 'A tag with this name already exists.'
                    : nameTouched
                      ? 'Custom name'
                      : 'Suggested from the filter'}
                </span>
                <span className="font-data">{effectiveName.length}/50</span>
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block font-body text-sm font-medium text-char">
                Description <span className="font-normal text-haze">(optional)</span>
              </span>
              <textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className={INPUT}
              />
            </label>
          </section>
        </div>

        <div className="flex justify-end gap-3 border-t border-line px-[22px] py-4">
          <button type="button" onClick={onClose} className={SECONDARY_BTN}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit || isLoading} className={PRIMARY_BTN}>
            {isLoading ? 'Creating…' : `Create & tag ${matching ?? 0} alerts`}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Delete

function DeleteTagModal({
  tag,
  onClose,
  onConfirm,
  isLoading,
}: {
  tag: Tag;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  // Fetched when the modal opens: what the delete would take away.
  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: [...TAGS_QUERY_KEY, tag.id, 'impact'],
    queryFn: () => apiClient.getTagImpact(tag.id),
    gcTime: 0,
  });
  const lockedOut = impact?.users_losing_all_access ?? [];

  return (
    <ModalShell eyebrow="Delete tag" title={tag.name} onClose={onClose}>
      <div className="space-y-4 px-[22px] py-5">
        <p className="font-body text-sm text-char">This removes the tag everywhere:</p>
        <ul className="space-y-2 font-body text-sm text-char">
          <li className="flex justify-between rounded-lg bg-ash px-3 py-2">
            <span>Alerts losing the tag</span>
            <ImpactCount value={impact?.alert_count} loading={impactLoading} />
          </li>
          <li className="flex justify-between rounded-lg bg-ash px-3 py-2">
            <span>Users losing access through it</span>
            <ImpactCount value={impact?.user_count} loading={impactLoading} />
          </li>
        </ul>
        <p className="font-body text-detail text-haze">
          Alerts and their annotations are kept; only the tag link goes.
        </p>

        {lockedOut.length > 0 && (
          <div className="bg-signal-soft rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 font-body text-sm font-semibold text-signal">
              <AlertTriangle className="h-4 w-4" />
              {lockedOut.length} user
              {lockedOut.length > 1 ? 's' : ''} will see no alert at all
            </div>
            <p className="font-body text-detail text-signal">
              This is the only tag of <span className="font-data">{lockedOut.join(', ')}</span>.
            </p>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-line px-[22px] py-4">
        <button type="button" onClick={onClose} className={SECONDARY_BTN}>
          Cancel
        </button>
        <button onClick={onConfirm} disabled={isLoading || impactLoading} className={DANGER_BTN}>
          <Trash2 className="w-4 h-4 mr-2" />
          {isLoading ? 'Deleting…' : 'Delete tag'}
        </button>
      </div>
    </ModalShell>
  );
}

function ImpactCount({ value, loading }: { value: number | undefined; loading: boolean }) {
  if (loading) return <span className="inline-block h-4 w-8 animate-pulse rounded bg-line" />;
  return <span className="font-data font-semibold">{value ?? '—'}</span>;
}
