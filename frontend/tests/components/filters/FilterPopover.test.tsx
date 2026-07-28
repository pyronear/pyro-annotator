import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterPopover from '@/components/filters/FilterPopover';
import type { ExtendedSequenceFilters } from '@/types/api';

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    filters: {} as ExtendedSequenceFilters,
    onFiltersChange: vi.fn(),
    dateFrom: '',
    dateTo: '',
    onDateFromChange: vi.fn(),
    onDateToChange: vi.fn(),
    onDateRangeSet: vi.fn(),
    onDateRangeClear: vi.fn(),
    selectedFalsePositiveTypes: [] as string[],
    onFalsePositiveTypesChange: vi.fn(),
    selectedSmokeTypes: [] as string[],
    onSmokeTypesChange: vi.fn(),
    selectedModelAccuracy: 'all' as const,
    onModelAccuracyChange: vi.fn(),
    onResetFilters: vi.fn(),
    cameras: [{ id: 1, name: 'marguerite-29' }],
    organizations: [{ id: 1, name: 'Pyronear FR' }],
    sourceApis: [{ id: 'alert_api', name: 'Alert API' }],
    camerasLoading: false,
    organizationsLoading: false,
    sourceApisLoading: false,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('FilterPopover', () => {
  it('renders a closed popover: Filters button visible, no filter controls', () => {
    render(<FilterPopover {...makeProps()} />);
    expect(screen.getByRole('button', { name: /filters/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument();
  });

  it('opens on button click, showing core filters but not the More section', () => {
    render(<FilterPopover {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByLabelText('Camera')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Date Range (Recorded)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Source API')).not.toBeInTheDocument();
  });

  it('expands More filters, revealing only flag-gated widgets', () => {
    render(<FilterPopover {...makeProps({ showModelAccuracy: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    // 2 always-in-More widgets + model accuracy
    fireEvent.click(screen.getByRole('button', { name: /more filters \(3\)/i }));
    expect(screen.getByLabelText('Source API')).toBeInTheDocument();
    expect(screen.getByLabelText('Wildfire Classification')).toBeInTheDocument();
    expect(screen.getByText('Model Accuracy')).toBeInTheDocument();
    // Not enabled for this page:
    expect(screen.queryByLabelText('Certainty')).not.toBeInTheDocument();
  });

  it('changing the camera select calls onFiltersChange immediately', () => {
    const props = makeProps();
    render(<FilterPopover {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.change(screen.getByLabelText('Camera'), { target: { value: 'marguerite-29' } });
    expect(props.onFiltersChange).toHaveBeenCalledWith({ camera_name: 'marguerite-29' });
  });

  it('renders applied filters as pills and clears exactly one on ✕ click', () => {
    const props = makeProps({
      filters: { camera_name: 'marguerite-29', organisation_name: 'Pyronear FR' },
    });
    render(<FilterPopover {...props} />);
    expect(screen.getByText('Camera: marguerite-29')).toBeInTheDocument();
    expect(screen.getByText('Org: Pyronear FR')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear camera: marguerite-29/i }));
    expect(props.onFiltersChange).toHaveBeenCalledWith({ camera_name: undefined });
    expect(props.onFiltersChange).toHaveBeenCalledTimes(1);
  });

  it('clearing a date pill delegates to onDateRangeClear', () => {
    const props = makeProps({ dateFrom: '2026-01-01', dateTo: '' });
    render(<FilterPopover {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /clear from 2026-01-01/i }));
    expect(props.onDateRangeClear).toHaveBeenCalled();
  });

  it('shows Reset all only when filters are active, and wires it up', () => {
    const inactive = makeProps();
    const { unmount } = render(<FilterPopover {...inactive} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.queryByRole('button', { name: /reset all/i })).not.toBeInTheDocument();
    unmount();

    const active = makeProps({ filters: { camera_name: 'marguerite-29' } });
    render(<FilterPopover {...active} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }));
    expect(active.onResetFilters).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<FilterPopover {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    const camera = screen.getByLabelText('Camera');
    expect(camera).toBeInTheDocument();
    // Headless UI only handles Escape while focus is inside the popover;
    // jsdom's fireEvent.click does not move focus, so focus explicitly.
    camera.focus();
    fireEvent.keyDown(camera, { key: 'Escape' });
    expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument();
  });

  it('closes on outside click', async () => {
    render(
      <div>
        <FilterPopover {...makeProps()} />
        <button>outside</button>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Camera')).toBeInTheDocument();
    // Headless UI arms its outside-click listener one animation frame after
    // the popover opens — wait for that frame before clicking outside.
    await new Promise(resolve => requestAnimationFrame(resolve));
    const outside = screen.getByRole('button', { name: 'outside' });
    fireEvent.mouseDown(outside);
    fireEvent.click(outside);
    expect(screen.queryByLabelText('Camera')).not.toBeInTheDocument();
  });

  it('clears wildfire and unsure pills through their own handlers', () => {
    const props = makeProps({
      filters: { is_wildfire_alertapi: null },
      selectedUnsure: 'unsure',
      onUnsureChange: vi.fn(),
      showUnsureFilter: true,
    });
    render(<FilterPopover {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /clear wildfire: unclassified/i }));
    expect(props.onFiltersChange).toHaveBeenCalledWith({ is_wildfire_alertapi: undefined });
    fireEvent.click(screen.getByRole('button', { name: /clear only unsure/i }));
    expect(props.onUnsureChange).toHaveBeenCalledWith('all');
  });

  it('persists the More expander state under filter-popover-more-expanded', () => {
    render(<FilterPopover {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /more filters/i }));
    expect(localStorage.getItem('filter-popover-more-expanded')).toBe('expanded');
  });
});
