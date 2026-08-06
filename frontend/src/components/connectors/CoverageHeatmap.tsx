import type { ConnectorOrganization, CoverageCell } from '@/types/api';

type CellState = 'imported' | 'empty' | 'partial' | 'failed' | 'missing' | 'not-enabled';

interface Props {
  organizations: ConnectorOrganization[];
  cells: CoverageCell[];
  dateFrom: string;
  dateEnd: string;
}

/**
 * Inclusive list of ISO dates, built in UTC so a viewer's timezone can never
 * shift which day a cell represents — coverage dates are alert-API UTC dates.
 */
function isoDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function cellState(
  cell: CoverageCell | undefined,
  enabledAt: string | null,
  day: string
): CellState {
  if (enabledAt && day < enabledAt.slice(0, 10)) return 'not-enabled';
  if (!cell) return 'missing';
  if (cell.status === 'failed') return 'failed';
  if (cell.status === 'partial') return 'partial';
  return cell.alerts_imported > 0 ? 'imported' : 'empty';
}

// failed and missing share an appearance: both mean "we do not have this day".
// The tooltip is what distinguishes them.
const HATCHED =
  'bg-red-100 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(220,38,38,0.55)_3px,rgba(220,38,38,0.55)_6px)]';

const STATE_CLASS: Record<CellState, string> = {
  imported: 'bg-emerald-500',
  partial: 'bg-emerald-500 ring-1 ring-amber-500',
  empty: 'bg-gray-200',
  failed: HATCHED,
  missing: HATCHED,
  'not-enabled': 'border border-dashed border-gray-300',
};

function tooltip(
  state: CellState,
  day: string,
  orgName: string,
  cell?: CoverageCell
): string {
  const head = `${orgName} — ${day}`;
  if (state === 'not-enabled') return `${head}: organization not enabled yet`;
  if (state === 'missing') return `${head}: never attempted`;
  if (state === 'failed') return `${head}: failed — ${cell?.error ?? 'unknown error'}`;
  const counts = `${cell?.alerts_imported ?? 0} imported, ${cell?.alerts_skipped ?? 0} skipped`;
  if (state === 'partial') return `${head}: ${counts}, ${cell?.alerts_failed ?? 0} failed`;
  return `${head}: ${counts}`;
}

export function CoverageHeatmap({ organizations, cells, dateFrom, dateEnd }: Props) {
  const days = isoDateRange(dateFrom, dateEnd);
  const byKey = new Map(cells.map(c => [`${c.organization_id}:${c.covered_date}`, c]));

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5">
        <tbody>
          {organizations.map(org => (
            <tr key={org.id}>
              <th
                scope="row"
                className="whitespace-nowrap pr-3 text-right text-sm font-medium"
              >
                {org.name}
              </th>
              {days.map(day => {
                const cell = byKey.get(`${org.organization_id}:${day}`);
                const state = cellState(cell, org.enabled_at, day);
                return (
                  <td key={day}>
                    <div
                      role="gridcell"
                      data-testid={`coverage-cell-${org.organization_id}-${day}`}
                      data-state={state}
                      title={tooltip(state, day, org.name, cell)}
                      className={`h-4 w-4 rounded-sm ${STATE_CLASS[state]}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
