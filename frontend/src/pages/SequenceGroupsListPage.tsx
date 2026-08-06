import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Popover } from '@headlessui/react';
import { Loader2, AlertCircle, Check, Info, Layers, ChevronRight } from 'lucide-react';
import { apiClient } from '@/services/api';
import { SequenceGroupStats } from '@/types/api';
import { classifyGroup, classifyGroups, ROUTES, SequenceGroupsFilter } from '@/utils/routes';
import { ColumnHeader } from '@/components/sequences/ColumnHeader';
import { TablePagination } from '@/components/sequences/TablePagination';
import {
  CELL_CLASSES,
  CELL_TEXT,
  DATA_CELL_TEXT,
  HEADER_CELL_CLASSES,
  PRIMARY_CELL_TEXT,
  ROW_CLASSES,
  TABLE_CARD_CLASSES,
  TABLE_CLASSES,
  TBODY_CLASSES,
  THEAD_CLASSES,
} from '@/components/sequences/tableStyles';
import { formatDateTime } from '@/utils/datetime';
type OrderBy = 'member_count' | 'camera_name' | 'azimuth' | 'created_at';
type OrderDirection = 'asc' | 'desc';

// First click on a column uses its natural direction: text asc, numbers/dates desc.
const DEFAULT_DIRECTION: Record<OrderBy, OrderDirection> = {
  member_count: 'desc',
  camera_name: 'asc',
  azimuth: 'asc',
  created_at: 'desc',
};

const FILTERS: {
  value: SequenceGroupsFilter;
  label: string;
  countOf: keyof SequenceGroupStats;
  tip: string;
}[] = [
  {
    value: 'unlabeled',
    label: 'To label',
    countOf: 'unlabeled',
    tip: "Objects that don't have a label yet",
  },
  {
    value: 'labeled',
    label: 'Labeled',
    countOf: 'labeled',
    tip: 'Objects that already have a label',
  },
  { value: 'all', label: 'All', countOf: 'total', tip: 'Every object, labeled or not' },
];

// Same hover-tooltip bubble as components/sequences/ColumnHeader.tsx, used by
// the filter tabs above the table and the rows' "to label" badge (table
// headers use ColumnHeader).
function headerTip(tip: string, align: 'left' | 'right' = 'left') {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-10 mt-1 hidden w-max max-w-[16rem] whitespace-normal rounded bg-char px-2 py-1 font-body text-xs font-normal normal-case tracking-normal text-white group-hover:block ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {tip}
    </span>
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
        <Loader2 className="animate-spin w-6 h-6 mr-2" /> Loading objects…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-96 text-red-600">
        <AlertCircle className="w-6 h-6 mr-2" />
        Failed to load objects
      </div>
    );
  }

  const items = data?.items ?? [];
  const totalPages = data?.pages ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Recurring objects</h1>
          <Popover className="relative flex">
            <Popover.Button
              className="text-gray-400 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
              aria-label="What is a recurring object?"
            >
              <Info className="w-4 h-4" />
            </Popover.Button>
            <Popover.Panel className="absolute left-0 top-full z-20 mt-2 w-96 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-lg">
              <span className="font-semibold">What is a recurring object?</span> After each import,
              sequences from the same camera looking in the same direction at the same spot are
              grouped automatically — usually one recurring smoke plume or false-positive source (an
              antenna, a cloud bank…). Open one, validate the grouping, then label any of its
              sequences — the label propagates to every sequence. Only objects seen in 3+ sequences
              are shown.
            </Popover.Panel>
          </Popover>
        </div>
        <p className="text-gray-600">Label an object once to label every sighting of it.</p>
      </div>

      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border border-line bg-ash p-0.5 gap-0.5 text-sm">
          {FILTERS.map(f => {
            const active = filter === f.value;
            const count = stats?.[f.countOf];
            return (
              // Tooltip lives on a wrapper, not inside the Link, so its text
              // stays out of the link's accessible name.
              <span key={f.value} className="group relative flex">
                <Link
                  to={classifyGroups(f.value)}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-baseline px-3.5 py-1.5 rounded-md ${
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
                {headerTip(f.tip)}
              </span>
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
                  All objects labeled
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Nice work — every object is labeled. New objects appear automatically a few
                  minutes after each import.
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
                  No labeled objects yet
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Objects you label land here.
                </p>
                <Link
                  to={classifyGroups('unlabeled')}
                  className="mt-5 inline-block rounded-lg bg-ember px-7 py-2.5 font-body text-[13.5px] font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
                >
                  Label objects
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
                  No objects yet
                </h2>
                <p className="mt-1.5 font-body text-sm leading-relaxed text-haze">
                  Objects appear automatically after imports — only objects seen in 3 or more
                  sequences are shown here.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={TABLE_CARD_CLASSES}>
          <div className="overflow-x-auto">
            <table className={TABLE_CLASSES}>
              <thead className={THEAD_CLASSES}>
                <tr>
                  <ColumnHeader
                    label="Camera"
                    tip="Camera that recorded the object's sequences"
                    sort={{
                      active: orderBy === 'camera_name',
                      direction: orderDirection,
                      onSort: () => handleSort('camera_name'),
                    }}
                  />
                  <ColumnHeader label="Organisation" tip="Organisation operating the camera" />
                  <ColumnHeader
                    label="Created"
                    tip="When this object's sequences were first grouped"
                    sort={{
                      active: orderBy === 'created_at',
                      direction: orderDirection,
                      onSort: () => handleSort('created_at'),
                    }}
                  />
                  <ColumnHeader
                    label="Azimuth"
                    tip="Camera viewing direction, in degrees"
                    sort={{
                      active: orderBy === 'azimuth',
                      direction: orderDirection,
                      onSort: () => handleSort('azimuth'),
                    }}
                  />
                  <ColumnHeader
                    label="Sightings"
                    tip="Times this object was seen"
                    sort={{
                      active: orderBy === 'member_count',
                      direction: orderDirection,
                      onSort: () => handleSort('member_count'),
                    }}
                  />
                  <ColumnHeader
                    label="Label"
                    tip="Object label — propagates to every sequence once the group is validated"
                  />
                  <ColumnHeader label="Annotators" tip="Who annotated this object's sightings" />
                  <th className={HEADER_CELL_CLASSES}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className={TBODY_CLASSES}>
                {items.map(g => (
                  <tr
                    key={g.id}
                    onClick={e => {
                      // Leave modified clicks and text selection to the browser;
                      // the camera-name <Link> handles open-in-new-tab.
                      if (e.ctrlKey || e.metaKey || window.getSelection()?.toString()) return;
                      navigate(classifyGroup(g.id));
                    }}
                    className={ROW_CLASSES}
                  >
                    <td className={CELL_CLASSES}>
                      <Link
                        to={classifyGroup(g.id)}
                        onClick={e => e.stopPropagation()}
                        className={`${PRIMARY_CELL_TEXT} hover:underline`}
                      >
                        {g.camera_name}
                      </Link>
                    </td>
                    <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>{g.organisation_name}</td>
                    <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>
                      {formatDateTime(g.created_at)}
                    </td>
                    <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>{g.azimuth}°</td>
                    <td className={`${CELL_CLASSES} ${DATA_CELL_TEXT}`}>{g.member_count}</td>
                    <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                      {g.smoke_type ? (
                        <span>smoke · {g.smoke_type}</span>
                      ) : g.false_positive_type ? (
                        <span>false positive · {g.false_positive_type.replace(/_/g, ' ')}</span>
                      ) : (
                        <span className="group relative inline-block">
                          <span className="inline-flex rounded-full bg-ember-soft px-2 py-1 font-body text-xs font-semibold text-ember">
                            to label
                          </span>
                          {/* Propagation only fires for validated groups, so
                              tell unvalidated ones to validate first. */}
                          {headerTip(
                            g.is_validated
                              ? "Classify any of this object's sequences — the label will propagate to all of them"
                              : "Validate the group first, then classify any of this object's sequences — the label will propagate to all of them"
                          )}
                        </span>
                      )}
                    </td>
                    <td className={`${CELL_CLASSES} ${CELL_TEXT}`}>
                      {g.annotators.length > 0 ? (
                        g.annotators.join(', ')
                      ) : (
                        <span className="text-haze">—</span>
                      )}
                    </td>
                    <td className={`${CELL_CLASSES} text-right`}>
                      <ChevronRight className="inline w-4 h-4 text-haze" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={page}
            pages={totalPages}
            total={data?.total}
            itemsLabel="objects"
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
