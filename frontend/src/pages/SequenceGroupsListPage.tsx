import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Tag, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/services/api';

type Filter = 'all' | 'labeled' | 'unlabeled';

export default function SequenceGroupsListPage() {
  const [filter, setFilter] = useState<Filter>('unlabeled');
  const [page, setPage] = useState(1);
  const size = 50;

  const { data, isLoading, error } = useQuery({
    queryKey: ['sequenceGroupsList', filter, page, size],
    queryFn: () =>
      apiClient.getSequenceGroups({
        labeled: filter === 'all' ? undefined : filter === 'labeled',
        page,
        size,
      }),
    placeholderData: prev => prev,
  });

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
        <h1 className="text-2xl font-semibold">Sequence groups</h1>
        <p className="text-sm text-gray-600 mt-1">
          {total} group{total === 1 ? '' : 's'} with 2 or more members. Click a row to review
          membership; annotate one member from the per-sequence page and the labels propagate to the
          rest if the group has been validated.
        </p>
      </header>

      <div className="mb-3 flex gap-2 text-sm">
        {(['all', 'unlabeled', 'labeled'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`px-3 py-1 rounded ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Group #</th>
              <th className="px-3 py-2 text-left">Camera</th>
              <th className="px-3 py-2 text-left">Azimuth</th>
              <th className="px-3 py-2 text-left">Members</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Validated</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                  {filter === 'unlabeled'
                    ? 'No unlabeled multi-sequence groups yet. Run ' +
                      'make assign-groups after an import; single-sequence ' +
                      'groups are intentionally hidden here.'
                    : 'No groups match this filter.'}
                </td>
              </tr>
            ) : (
              items.map(g => (
                <tr key={g.id} className="border-t border-gray-100 hover:bg-blue-50">
                  <td className="px-3 py-2">
                    <Link
                      to={`/sequence-groups/${g.id}/annotate`}
                      className="text-blue-600 hover:underline"
                    >
                      #{g.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{g.camera_id}</td>
                  <td className="px-3 py-2">{g.azimuth}°</td>
                  <td className="px-3 py-2 font-medium">{g.member_count}</td>
                  <td className="px-3 py-2">
                    {g.smoke_type ? (
                      <span className="inline-flex items-center gap-1 text-orange-700">
                        <Tag className="w-3 h-3" /> smoke / {g.smoke_type}
                      </span>
                    ) : g.false_positive_type ? (
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <Tag className="w-3 h-3" /> FP / {g.false_positive_type}
                      </span>
                    ) : (
                      <span className="text-gray-400">unlabeled</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {g.is_validated ? (
                      <span className="inline-flex items-center gap-1 text-green-700">
                        <ShieldCheck className="w-3 h-3" /> validated
                      </span>
                    ) : (
                      <span className="text-gray-400">no</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {new Date(g.created_at).toLocaleString()}
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
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 border rounded disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
