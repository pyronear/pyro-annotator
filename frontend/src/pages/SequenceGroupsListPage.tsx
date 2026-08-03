import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Popover } from '@headlessui/react';
import {
  Loader2,
  AlertCircle,
  Check,
  Info,
  Layers,
  ShieldCheck,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatRelativeTime } from '@/utils/relativeTime';
import { SequenceGroupStats } from '@/types/api';
import { classifyGroup, classifyGroups, ROUTES, SequenceGroupsFilter } from '@/utils/routes';
type OrderBy = 'member_count' | 'camera_name' | 'azimuth' | 'created_at';
type OrderDirection = 'asc' | 'desc';

// First click on a column uses its natural direction: text asc, numbers/dates desc.
const DEFAULT_DIRECTION: Record<OrderBy, OrderDirection> = {
  member_count: 'desc',
  camera_name: 'asc',
  azimuth: 'asc',
  created_at: 'desc',
};

const FILTERS: { value: SequenceGroupsFilter; label: string; countOf: keyof SequenceGroupStats }[] =
  [
    { value: 'unlabeled', label: 'To label', countOf: 'unlabeled' },
    { value: 'labeled', label: 'Labeled', countOf: 'labeled' },
    { value: 'all', label: 'All', countOf: 'total' },
  ];

// Same hover-tooltip bubble as components/sequences/ColumnHeader.tsx, kept
// local because these headers are sortable and use this table's padding.
function headerTip(tip: string, align: 'left' | 'right' = 'left') {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-10 mt-1 hidden w-max max-w-[16rem] whitespace-normal rounded bg-gray-900 px-2 py-1 text-xs font-normal normal-case tracking-normal text-white shadow group-hover:block ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {tip}
    </span>
  );
}

function SortableHeader({
  column,
  label,
  tip,
  orderBy,
  orderDirection,
  onSort,
  align = 'left',
}: {
  column: OrderBy;
  label: string;
  tip: string;
  orderBy: OrderBy;
  orderDirection: OrderDirection;
  onSort: (column: OrderBy) => void;
  align?: 'left' | 'right';
}) {
  const active = orderBy === column;
  const Arrow = orderDirection === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className="group relative px-3 py-2.5 text-left whitespace-nowrap"
      aria-sort={active ? (orderDirection === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="uppercase tracking-wide select-none hover:text-gray-900"
      >
        {label}
        {active && <Arrow className="inline w-3 h-3 ml-1 text-blue-600" />}
      </button>
      {headerTip(tip, align)}
    </th>
  );
}

function PlainHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <th className="group relative px-3 py-2.5 text-left">
      <span className="cursor-help">{label}</span>
      {headerTip(tip)}
    </th>
  );
}

export default function SequenceGroupsListPage({
  filter = 'unlabeled',
}: {
  filter?: SequenceGroupsFilter;
} = {}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [orderBy, setOrderBy] = useState<OrderBy>('member_count');
  const [orderDirection, setOrderDirection] = useState<OrderDirection>('desc');
  const size = 50;

  // Tab switches change the dataset; restart pagination.
  useEffect(() => {
    setPage(1);
  }, [filter]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequenceGroupsList', filter, page, size, orderBy, orderDirection],
    queryFn: () =>
      apiClient.getSequenceGroups({
        labeled: filter === 'all' ? undefined : filter === 'labeled',
        page,
        size,
        order_by: orderBy,
        order_direction: orderDirection,
      }),
    placeholderData: prev => prev,
  });

  const { data: stats } = useQuery({
    queryKey: ['sequenceGroupStats'],
    queryFn: () => apiClient.getSequenceGroupStats(),
  });

  const handleSort = (column: OrderBy) => {
    if (orderBy === column) {
      setOrderDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(column);
      setOrderDirection(DEFAULT_DIRECTION[column]);
    }
    setPage(1);
  };

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        <Loader2 className="animate-spin w-6 h-6 mr-2" /> Loading groups…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-96 text-red-600">
        <AlertCircle className="w-6 h-6 mr-2" />
        Failed to load groups
      </div>
    );
  }

  const items = data?.items ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Sequence groups</h1>
          <Popover className="relative flex">
            <Popover.Button
              className="text-gray-400 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
              aria-label="What is a sequence group?"
            >
              <Info className="w-4 h-4" />
            </Popover.Button>
            <Popover.Panel className="absolute left-0 top-full z-20 mt-2 w-96 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-lg">
              <span className="font-semibold">What is a sequence group?</span> After each import,
              sequences from the same camera looking in the same direction at the same spot are
              grouped automatically — usually one recurring smoke plume or false-positive source (an
              antenna, a cloud bank…). Open a group, label one of its sequences, and once the group
              is validated the label propagates to every member. Only groups with 3+ sequences are
              shown.
            </Popover.Panel>
          </Popover>
        </div>
        <p className="text-gray-600">Label many related sequences at once.</p>
      </div>

      <div>
        <div className="inline-flex rounded-lg border border-line bg-ash p-0.5 gap-0.5 text-sm">
          {FILTERS.map(f => {
            const active = filter === f.value;
            const count = stats?.[f.countOf];
            return (
              <Link
                key={f.value}
                to={classifyGroups(f.value)}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex items-center px-3.5 py-1.5 rounded-md ${
                  active
                    ? 'border border-line bg-paper font-semibold text-char'
                    : 'border border-transparent font-medium text-haze hover:text-char'
                }`}
              >
                {f.label}
                {count !== undefined && (
                  <span
                    className={`ml-1.5 font-data text-xs ${active ? 'text-ember' : 'text-haze'}`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Gate on total, not items: a stale page ≥ 2 can refetch empty while
          groups still exist — that must keep the table + pagination, not
          show a false "all labeled" success. */}
      {(data?.total ?? 0) === 0 ? (
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center max-w-md">
            {filter === 'unlabeled' ? (
              // Every group labeled - success
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-pine-soft"
                >
                  <Check className="h-7 w-7 text-pine" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  All groups labeled
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Nice work — every group is labeled. New groups form automatically a few minutes
                  after each import.
                </p>
                <Link
                  to={ROUTES.CLASSIFY}
                  className="mt-5 inline-block rounded-lg bg-ember px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Start classifying
                </Link>
              </>
            ) : filter === 'labeled' ? (
              // Nothing labeled yet - work to do
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-ember-soft"
                >
                  <Layers className="h-6 w-6 text-ember" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  No labeled groups yet
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Groups you label land here.
                </p>
                <Link
                  to={classifyGroups('unlabeled')}
                  className="mt-5 inline-block rounded-lg bg-ember px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Label groups
                </Link>
              </>
            ) : (
              // No groups at all - informational
              <>
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-line bg-paper"
                >
                  <Layers className="h-6 w-6 text-haze" />
                </span>
                <h2 className="mt-4 font-display text-base font-semibold text-char">
                  No groups yet
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Groups form automatically after imports — only groups of 3 or more sequences
                  appear here.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <SortableHeader
                    column="camera_name"
                    label="Camera"
                    tip="Camera that recorded the group's sequences"
                    orderBy={orderBy}
                    orderDirection={orderDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="azimuth"
                    label="Azimuth"
                    tip="Camera viewing direction, in degrees"
                    orderBy={orderBy}
                    orderDirection={orderDirection}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    column="member_count"
                    label="Sequences"
                    tip="Number of sequences in the group"
                    orderBy={orderBy}
                    orderDirection={orderDirection}
                    onSort={handleSort}
                  />
                  <PlainHeader
                    label="Label"
                    tip="Group label — propagates to every member once the group is validated"
                  />
                  <PlainHeader label="Reviewed" tip="Whether a human validated the group's label" />
                  <SortableHeader
                    column="created_at"
                    label="Created"
                    tip="When the group was created"
                    orderBy={orderBy}
                    orderDirection={orderDirection}
                    onSort={handleSort}
                    align="right"
                  />
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {items.map(g => (
                  <tr
                    key={g.id}
                    onClick={e => {
                      // Leave modified clicks and text selection to the browser;
                      // the camera-name <Link> handles open-in-new-tab.
                      if (e.ctrlKey || e.metaKey || window.getSelection()?.toString()) return;
                      navigate(classifyGroup(g.id));
                    }}
                    className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        to={classifyGroup(g.id)}
                        onClick={e => e.stopPropagation()}
                        className="font-semibold text-gray-900 hover:text-blue-700"
                      >
                        {g.camera_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{g.azimuth}°</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                        {g.member_count}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {g.smoke_type ? (
                        <span className="inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
                          smoke · {g.smoke_type}
                        </span>
                      ) : g.false_positive_type ? (
                        <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                          false positive · {g.false_positive_type.replace(/_/g, ' ')}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800">
                          to label
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {g.is_validated ? (
                        <span className="inline-flex items-center gap-1 text-green-700 text-xs font-semibold">
                          <ShieldCheck className="w-3.5 h-3.5" /> validated
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-gray-500"
                      title={new Date(g.created_at).toLocaleString()}
                    >
                      {formatRelativeTime(g.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <ChevronRight className="inline w-4 h-4 text-gray-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="text-gray-600">
                Page {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg bg-white disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
