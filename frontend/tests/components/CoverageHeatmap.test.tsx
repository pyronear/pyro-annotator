import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CoverageHeatmap } from '@/components/connectors/CoverageHeatmap';
import type { ConnectorOrganization, CoverageCell } from '@/types/api';

const ORGS: ConnectorOrganization[] = [
  {
    id: 1,
    organization_id: 10,
    name: 'Ardeche',
    is_enabled: true,
    enabled_at: '2026-08-01T00:00:00Z',
  },
];

function cell(overrides: Partial<CoverageCell>): CoverageCell {
  return {
    organization_id: 10,
    covered_date: '2026-08-03',
    status: 'ok',
    alerts_fetched: 0,
    alerts_imported: 0,
    alerts_skipped: 0,
    alerts_failed: 0,
    lanes_created: 0,
    error: null,
    ...overrides,
  };
}

function renderHeatmap(cells: CoverageCell[]) {
  return render(
    <CoverageHeatmap
      organizations={ORGS}
      cells={cells}
      dateFrom="2026-08-01"
      dateEnd="2026-08-04"
    />
  );
}

describe('CoverageHeatmap', () => {
  it('renders one row per organization and one cell per day', () => {
    renderHeatmap([]);
    expect(screen.getByText('Ardeche')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(4);
  });

  it('marks a day with imports as imported', () => {
    renderHeatmap([cell({ covered_date: '2026-08-03', alerts_imported: 5 })]);
    expect(screen.getByTestId('coverage-cell-10-2026-08-03')).toHaveAttribute(
      'data-state',
      'imported'
    );
  });

  it('distinguishes a covered day with zero alerts from a missing one', () => {
    renderHeatmap([cell({ covered_date: '2026-08-03', alerts_imported: 0 })]);
    expect(screen.getByTestId('coverage-cell-10-2026-08-03')).toHaveAttribute(
      'data-state',
      'empty'
    );
    // No row was written for Aug 4 at all.
    expect(screen.getByTestId('coverage-cell-10-2026-08-04')).toHaveAttribute(
      'data-state',
      'missing'
    );
  });

  it('marks failed days and surfaces the error in the tooltip', () => {
    renderHeatmap([
      cell({ covered_date: '2026-08-03', status: 'failed', error: 'alert API down' }),
    ]);
    const target = screen.getByTestId('coverage-cell-10-2026-08-03');
    expect(target).toHaveAttribute('data-state', 'failed');
    expect(target.getAttribute('title')).toContain('alert API down');
  });

  it('marks partial days', () => {
    renderHeatmap([
      cell({
        covered_date: '2026-08-03',
        status: 'partial',
        alerts_imported: 3,
        alerts_failed: 2,
      }),
    ]);
    expect(screen.getByTestId('coverage-cell-10-2026-08-03')).toHaveAttribute(
      'data-state',
      'partial'
    );
  });

  it('greys out days before the organization was enabled', () => {
    render(
      <CoverageHeatmap
        organizations={ORGS}
        cells={[]}
        dateFrom="2026-07-30"
        dateEnd="2026-08-01"
      />
    );
    expect(screen.getByTestId('coverage-cell-10-2026-07-30')).toHaveAttribute(
      'data-state',
      'not-enabled'
    );
    expect(screen.getByTestId('coverage-cell-10-2026-08-01')).toHaveAttribute(
      'data-state',
      'missing'
    );
  });

  it('shows counts in the tooltip', () => {
    renderHeatmap([
      cell({
        covered_date: '2026-08-03',
        alerts_fetched: 9,
        alerts_imported: 5,
        alerts_skipped: 4,
      }),
    ]);
    const title = screen
      .getByTestId('coverage-cell-10-2026-08-03')
      .getAttribute('title');
    expect(title).toContain('5 imported');
    expect(title).toContain('4 skipped');
  });
});
