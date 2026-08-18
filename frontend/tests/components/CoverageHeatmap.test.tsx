import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
    renderHeatmap([
      cell({ covered_date: '2026-08-03', alerts_fetched: 5, alerts_imported: 5 }),
    ]);
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

  it('marks a re-run day as imported even when the fresh run only skipped', () => {
    // A re-run inside the trailing window re-fetches alerts already imported
    // on a previous run and files them as skipped, not imported (see
    // runner.py). The cell must still read as covered, not revert to empty.
    renderHeatmap([
      cell({
        covered_date: '2026-08-03',
        alerts_fetched: 5,
        alerts_skipped: 5,
        alerts_imported: 0,
      }),
    ]);
    expect(screen.getByTestId('coverage-cell-10-2026-08-03')).toHaveAttribute(
      'data-state',
      'imported'
    );
  });

  it('marks failed days and surfaces the error in the tooltip', () => {
    renderHeatmap([
      cell({ covered_date: '2026-08-03', status: 'failed', error: 'alert API down' }),
    ]);
    const target = screen.getByTestId('coverage-cell-10-2026-08-03');
    expect(target).toHaveAttribute('data-state', 'failed');
    expect(target.getAttribute('aria-label')).toContain('alert API down');
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

  it('renders a real coverage row before enabled_at instead of not-enabled', () => {
    // The initial sweep imports the trailing window, which precedes
    // enabled_at — those days have real coverage rows and must render their
    // actual state, not be masked by the "not enabled yet" dash.
    render(
      <CoverageHeatmap
        organizations={ORGS}
        cells={[cell({ covered_date: '2026-07-30', alerts_fetched: 5, alerts_imported: 5 })]}
        dateFrom="2026-07-30"
        dateEnd="2026-08-01"
      />
    );
    expect(screen.getByTestId('coverage-cell-10-2026-07-30')).toHaveAttribute(
      'data-state',
      'imported'
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
    const label = screen
      .getByTestId('coverage-cell-10-2026-08-03')
      .getAttribute('aria-label');
    expect(label).toContain('5 imported');
    expect(label).toContain('4 skipped');
  });

  it('shows a styled tooltip on hover and removes it on unhover', () => {
    renderHeatmap([
      cell({
        covered_date: '2026-08-03',
        alerts_fetched: 9,
        alerts_imported: 5,
        alerts_skipped: 4,
      }),
    ]);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('coverage-cell-10-2026-08-03'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('5 imported');
    fireEvent.mouseLeave(screen.getByTestId('coverage-cell-10-2026-08-03'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('surfaces the error in the hover tooltip for failed cells', () => {
    renderHeatmap([
      cell({ covered_date: '2026-08-03', status: 'failed', error: 'alert API down' }),
    ]);
    fireEvent.mouseEnter(screen.getByTestId('coverage-cell-10-2026-08-03'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('alert API down');
  });

  it('renders covered-but-quiet days as pale pine, distinct from not-enabled', () => {
    // User feedback 2026-08-07: the ash "covered, 0 alerts" square and the
    // dashed "not enabled yet" outline were indistinguishable at 16px. A
    // zero-alert covered day is a success state — it joins the green family.
    renderHeatmap([cell({ covered_date: '2026-08-03', alerts_fetched: 0 })]);
    const quiet = screen.getByTestId('coverage-cell-10-2026-08-03');
    expect(quiet).toHaveAttribute('data-state', 'empty');
    expect(quiet.className).toContain('bg-pine-soft');
    expect(quiet.className).not.toContain('bg-ash');
  });
});
