import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequenceGroups: vi.fn(),
    getSequenceGroupStats: vi.fn(),
  },
}));

import { apiClient } from '@/services/api';
import SequenceGroupsListPage from '@/pages/SequenceGroupsListPage';

// Mirrors the App.tsx route → filter mapping.
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {/* No filter prop: covers the component's 'unlabeled' default, as App.tsx renders it */}
          <Route path="/classify/groups" element={<SequenceGroupsListPage />} />
          <Route
            path="/classify/groups/labeled"
            element={<SequenceGroupsListPage filter="labeled" />}
          />
          <Route path="/classify/groups/all" element={<SequenceGroupsListPage filter="all" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const emptyPage = { items: [], page: 1, pages: 0, size: 50, total: 0 };

const group = {
  id: 7,
  camera_name: 'CAM_07',
  azimuth: 120,
  member_count: 5,
  smoke_type: null,
  false_positive_type: null,
  is_validated: false,
  created_at: '2026-08-01T10:00:00Z',
  representative_bbox: { xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.9 },
  thumbnails: [],
};

describe('SequenceGroupsListPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue(emptyPage);
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 0,
      labeled: 0,
      unlabeled: 0,
    });
  });

  it('selector tabs are links to the three filter routes with aria-current on the active one', async () => {
    renderAt('/classify/groups/labeled');
    await waitFor(() => expect(screen.getByRole('link', { name: /To label/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /To label/ }).getAttribute('href')).toBe(
      '/classify/groups'
    );
    const labeled = screen.getByRole('link', { name: /Labeled/ });
    expect(labeled.getAttribute('href')).toBe('/classify/groups/labeled');
    expect(labeled.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /All/ }).getAttribute('href')).toBe(
      '/classify/groups/all'
    );
    expect(screen.getByRole('link', { name: /To label/ }).getAttribute('aria-current')).toBeNull();
  });

  it('To label empty shows all-groups-labeled state, CTA to classify, and no table', async () => {
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('All objects labeled')).toBeTruthy());
    expect(screen.getByText(/every object is labeled/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start classifying' }).getAttribute('href')).toBe(
      '/classify'
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Labeled empty shows no-labeled-groups state with CTA to the To label tab', async () => {
    renderAt('/classify/groups/labeled');
    await waitFor(() => expect(screen.getByText('No labeled objects yet')).toBeTruthy());
    expect(screen.getByText(/Objects you label land here/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Label objects' }).getAttribute('href')).toBe(
      '/classify/groups'
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('All empty shows no-groups state with no action', async () => {
    renderAt('/classify/groups/all');
    await waitFor(() => expect(screen.getByText('No objects yet')).toBeTruthy());
    expect(screen.getByText(/only objects seen in 3 or more sequences/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start classifying' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Label objects' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the groups table when data is present', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('an empty page with a non-zero total keeps the table, not the empty state', async () => {
    // A stale page ≥ 2 can refetch empty while groups still exist elsewhere.
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [],
      page: 2,
      pages: 2,
      size: 50,
      total: 51,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    expect(screen.queryByText('All objects labeled')).toBeNull();
  });

  it('uses the fire-lookout row style and canonical column order', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    const row = screen.getByText('CAM_07').closest('tr');
    expect(row?.className).toContain('hover:bg-ash');
    expect(row?.className).not.toContain('hover:bg-blue-50');

    const headerLabels = [
      'Preview',
      'Camera',
      'Created',
      'Azimuth',
      'Sequences',
      'Label',
      'Reviewed',
    ];
    const positions = headerLabels.map(l => {
      const el = screen.getByText(l);
      return Array.from(document.querySelectorAll('th')).findIndex(th => th.contains(el));
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('clicking a sortable header refetches with that column and its natural direction', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /created/i }));
    await waitFor(() =>
      expect(apiClient.getSequenceGroups).toHaveBeenCalledWith(
        expect.objectContaining({ order_by: 'created_at', order_direction: 'desc' })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /camera/i }));
    await waitFor(() =>
      expect(apiClient.getSequenceGroups).toHaveBeenCalledWith(
        expect.objectContaining({ order_by: 'camera_name', order_direction: 'asc' })
      )
    );
  });

  it('renders a badge only for the "to label" state', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    expect(screen.getByText('to label')).toHaveClass('bg-ember-soft', 'text-ember');
  });

  it('filter tabs carry explanatory tooltips', async () => {
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByRole('link', { name: /To label/ })).toBeTruthy());
    expect(screen.getByText("Objects that don't have a label yet")).toBeTruthy();
    expect(screen.getByText('Objects that already have a label')).toBeTruthy();
    expect(screen.getByText('Every object, labeled or not')).toBeTruthy();
    // Tooltip text must not leak into the tab links' accessible names
    // (exact names: label + mocked zero count).
    expect(screen.getByRole('link', { name: 'To label 0' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Labeled 0' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All 0' })).toBeTruthy();
  });

  it('column headers carry explanatory tooltips', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());
    // One tooltip per labeled column (Preview, Camera, Azimuth, Sequences,
    // Label, Reviewed, Created) plus one on the row's "to label" badge.
    expect(within(screen.getByRole('table')).getAllByRole('tooltip')).toHaveLength(8);
    expect(screen.getByText('Number of sequences showing this object')).toBeTruthy();
    expect(screen.getByText(/propagates to every sequence/)).toBeTruthy();
    expect(screen.getByText('Camera viewing direction, in degrees')).toBeTruthy();
    // Reviewed means the grouping was confirmed, not the label — a group can
    // be validated while still unlabeled.
    expect(screen.getByText(/confirmed the sequences really show the same object/)).toBeTruthy();
  });

  it('the "to label" badge explains how to get the group labeled, per validation state', async () => {
    // Propagation only fires for validated groups, so the unvalidated badge
    // must lead with the missing step instead of promising propagation.
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group, { ...group, id: 8, camera_name: 'CAM_08', is_validated: true }],
      page: 1,
      pages: 1,
      size: 50,
      total: 2,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getAllByText('to label')).toHaveLength(2));
    expect(screen.getByText(/^Classify any of this object's sequences/)).toBeTruthy();
    expect(screen.getByText(/^Validate the group first, then classify/)).toBeTruthy();
  });

  it('renders one crop img per thumbnail, zoomed to its own bbox', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [
        {
          ...group,
          thumbnails: [
            { detection_id: 11, url: 'http://s3/a.jpg', bbox_xyxyn: [0.5, 0.5, 0.9, 0.9] },
            { detection_id: 12, url: 'http://s3/b.jpg', bbox_xyxyn: [0.2, 0.2, 0.4, 0.4] },
            { detection_id: 13, url: 'http://s3/c.jpg', bbox_xyxyn: [0.1, 0.1, 0.2, 0.2] },
          ],
        },
      ],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    const imgs = Array.from(document.querySelectorAll('tbody img'));
    expect(imgs.map(img => img.getAttribute('src'))).toEqual([
      'http://s3/a.jpg',
      'http://s3/b.jpg',
      'http://s3/c.jpg',
    ]);
    // Lazy so only visible rows download images.
    expect(imgs.every(img => img.getAttribute('loading') === 'lazy')).toBe(true);
    // Zoom centers on the thumbnail's own bbox center (70% for [0.5,...,0.9]).
    expect((imgs[0] as HTMLElement).style.transformOrigin).toBe('70% 70%');
  });

  it('falls back to the representative bbox when a thumbnail has no bbox', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [
        {
          ...group,
          thumbnails: [{ detection_id: 11, url: 'http://s3/a.jpg', bbox_xyxyn: null }],
        },
      ],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    // representative_bbox [0.1,0.1,0.4,0.4] centers at 25%.
    const img = document.querySelector('tbody img') as HTMLElement;
    expect(img.style.transformOrigin).toBe('25% 25%');
  });

  it('renders three empty placeholders when a group has no thumbnails', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    expect(document.querySelectorAll('tbody img')).toHaveLength(0);
    const row = screen.getByText('CAM_07').closest('tr')!;
    expect(row.querySelectorAll('td:first-child .bg-ash')).toHaveLength(3);
  });
});
