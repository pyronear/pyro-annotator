import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  AlertCircle,
  Info,
  ShieldCheck,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { apiClient } from '@/services/api';
import { formatRelativeTime } from '@/utils/relativeTime';
import { SequenceGroupStats } from '@/types/api';

type Filter = 'all' | 'labeled' | 'unlabeled';
type OrderBy = 'member_count' | 'camera_name' | 'azimuth' | 'created_at';
type OrderDirection = 'asc' | 'desc';

// First click on a column uses its natural direction: text asc, numbers/dates desc.
const DEFAULT_DIRECTION: Record<OrderBy, OrderDirection> = {
  member_count: 'desc',
  camera_name: 'asc',
  azimuth: 'asc',
  created_at: 'desc',
};

const FILTERS: { value: Filter; label: string; countOf: keyof SequenceGroupStats }[] = [
  { value: 'unlabeled', label: 'To label', countOf: 'unlabeled' },
  { value: 'labeled', label: 'Labeled', countOf: 'labeled' },
  { value: 'all', label: 'All', countOf: 'total' },
];

function SortableHeader({
  column,
  label,
  orderBy,
  orderDirection,
  onSort,
}: {
  column: OrderBy;
  label: string;
  orderBy: OrderBy;
  orderDirection: OrderDirection;
  onSort: (column: OrderBy) => void;
}) {
  const active = orderBy === column;
  const Arrow = orderDirection === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className="px-3 py-2.5 text-left whitespace-nowrap"
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
    </th>
  );
}

export default function SequenceGroupsListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('unlabeled');
  const [page, setPage] = useState(1);
  const [orderBy, setOrderBy] = useState<OrderBy>('member_count');
  const [orderDirection, setOrderDirection] = useState<OrderDirection>('desc');
  const size = 50;

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
  const total = data?.total ?? 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Sequence groups</h1>
        <p className="text-sm text-gray-600 mt-1">Label many related sequences at once.</p>
      </header>

      <div className="mb-4 flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <Info className="w-4 h-4 flex-none mt-0.5 text-blue-600" />
        <p>
          <span className="font-semibold">What is a sequence group?</span> After each import,
          sequences from the same camera looking in the same direction at the same spot are grouped
          automatically — usually one recurring smoke plume or false-positive source (an antenna, a
          cloud bank…). Open a group, label one of its sequences, and once the group is validated
          the label propagates to every member. Only groups with 3+ sequences are shown.
        </p>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-gray-200 p-0.5 gap-0.5 text-sm">
          {FILTERS.map(f => {
            const active = filter === f.value;
            const count = stats?.[f.countOf];
            return (
              <button
                key={f.value}
                onClick={() => {
                  setFilter(f.value);
                  setPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-md font-medium ${
                  active
                    ? 'bg-white text-gray-900 shadow-sm font-semibold'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {f.label}
                {count !== undefined && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                      active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="text-sm text-gray-500">
          {total} group{total === 1 ? '' : 's'}
        </span>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <tr>
              <SortableHeader
                column="camera_name"
                label="Camera"
                orderBy={orderBy}
                orderDirection={orderDirection}
                onSort={handleSort}
              />
              <SortableHeader
                column="azimuth"
                label="Azimuth"
                orderBy={orderBy}
                orderDirection={orderDirection}
                onSort={handleSort}
              />
              <SortableHeader
                column="member_count"
                label="Sequences"
                orderBy={orderBy}
                orderDirection={orderDirection}
                onSort={handleSort}
              />
              <th className="px-3 py-2.5 text-left">Label</th>
              <th className="px-3 py-2.5 text-left">Reviewed</th>
              <SortableHeader
                column="created_at"
                label="Created"
                orderBy={orderBy}
                orderDirection={orderDirection}
                onSort={handleSort}
              />
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  {filter === 'unlabeled'
                    ? 'Nothing to label right now. Groups are assigned ' +
                      'automatically a few minutes after an import; groups with ' +
                      'fewer than 3 sequences are intentionally hidden here.'
                    : 'No groups match this filter.'}
                </td>
              </tr>
            ) : (
              items.map(g => (
                <tr
                  key={g.id}
                  onClick={e => {
                    // Leave modified clicks and text selection to the browser;
                    // the camera-name <Link> handles open-in-new-tab.
                    if (e.ctrlKey || e.metaKey || window.getSelection()?.toString()) return;
                    navigate(`/sequence-groups/${g.id}/annotate`);
                  }}
                  className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer"
                >
                  <td className="px-3 py-2.5">
                    <Link
                      to={`/sequence-groups/${g.id}/annotate`}
                      onClick={e => e.stopPropagation()}
                      className="font-semibold text-gray-900 hover:text-blue-700"
                    >
                      {g.camera_name}
                    </Link>
                    <span className="ml-1.5 text-xs text-gray-400">#{g.id}</span>
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
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
    </div>
  );
}
