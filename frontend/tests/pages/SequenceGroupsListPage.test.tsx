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
          <Route
            path="/classify/groups/unsure"
            element={<SequenceGroupsListPage filter="unsure" />}
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
  organisation_name: 'SDIS 07',
  azimuth: 120,
  member_count: 5,
  smoke_type: null,
  false_positive_type: null,
  is_validated: false,
  is_unsure: false,
  created_at: '2026-08-01T10:00:00Z',
  annotators: ['alice', 'bob'],
  representative_bbox: { xyxyn: [0.1, 0.1, 0.4, 0.4], confidence: 0.9 },
  thumbnails: [],
};

describe('SequenceGroupsListPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue(emptyPage);
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 0,
      labeled: 0,
      unsure: 0,
      unlabeled: 0,
    });
  });

  it('selector tabs are links to the four filter routes with aria-current on the active one', async () => {
    renderAt('/classify/groups/unsure');
    await waitFor(() => expect(screen.getByRole('link', { name: /To label/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /To label/ }).getAttribute('href')).toBe(
      '/classify/groups'
    );
    const unsure = screen.getByRole('link', { name: /Unsure/ });
    expect(unsure.getAttribute('href')).toBe('/classify/groups/unsure');
    expect(unsure.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Labeled/ }).getAttribute('href')).toBe(
      '/classify/groups/labeled'
    );
    expect(screen.getByRole('link', { name: /All/ }).getAttribute('href')).toBe(
      '/classify/groups/all'
    );
    expect(screen.getByRole('link', { name: /To label/ }).getAttribute('aria-current')).toBeNull();
  });

  it('each tab requests its own label_state partition', async () => {
    renderAt('/classify/groups');
    await waitFor(() =>
      expect(apiClient.getSequenceGroups).toHaveBeenCalledWith(
        expect.objectContaining({ label_state: 'unlabeled' })
      )
    );

    vi.mocked(apiClient.getSequenceGroups).mockClear();
    renderAt('/classify/groups/unsure');
    await waitFor(() =>
      expect(apiClient.getSequenceGroups).toHaveBeenCalledWith(
        expect.objectContaining({ label_state: 'unsure' })
      )
    );

    vi.mocked(apiClient.getSequenceGroups).mockClear();
    renderAt('/classify/groups/labeled');
    await waitFor(() =>
      expect(apiClient.getSequenceGroups).toHaveBeenCalledWith(
        expect.objectContaining({ label_state: 'labeled' })
      )
    );

    // 'All' must send no filter at all. `undefined` is dropped by the
    // serializer; `null` would be dropped too but silently, so assert the
    // key is absent rather than that it is falsy.
    vi.mocked(apiClient.getSequenceGroups).mockClear();
    renderAt('/classify/groups/all');
    await waitFor(() => expect(apiClient.getSequenceGroups).toHaveBeenCalled());
    const allCall = vi.mocked(apiClient.getSequenceGroups).mock.calls[0][0]!;
    expect(allCall.label_state).toBeUndefined();
  });

  it('Unsure empty shows the no-unsure-objects state with no action', async () => {
    renderAt('/classify/groups/unsure');
    await waitFor(() => expect(screen.getByText('No unsure objects')).toBeTruthy());
    // Not just /marked undecidable/: the Unsure tab's own tooltip matches
    // that too, so anchor on the empty state's sentence.
    expect(screen.getByText(/whose sightings an annotator marked undecidable/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start classifying' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
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

  it('To label empty does not claim everything is labeled while unsure objects exist', async () => {
    // Unsure objects carry no label either, so the success copy would be a
    // lie — they just aren't work that lives on this tab.
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 4,
      validated: 4,
      unvalidated: 0,
      labeled: 0,
      unsure: 4,
      unlabeled: 0,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('Nothing left to label')).toBeTruthy());
    expect(screen.queryByText('All objects labeled')).toBeNull();
    expect(screen.getByText(/4 objects are marked unsure/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Review them/ }).getAttribute('href')).toBe(
      '/classify/groups/unsure'
    );
  });

  it('To label empty keeps the success copy when nothing is unsure', async () => {
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 4,
      validated: 4,
      unvalidated: 0,
      labeled: 4,
      unsure: 0,
      unlabeled: 0,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('All objects labeled')).toBeTruthy());
    expect(screen.getByText(/every object is labeled/)).toBeTruthy();
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
    expect(screen.getByText(/only objects seen 3 or more times/)).toBeTruthy();
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
      'Organisation',
      'Created',
      'Azimuth',
      'Sightings',
      'Label',
      'Annotators',
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

  it('an unsure group renders the neutral "unsure" chip, not "to label"', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [{ ...group, is_unsure: true }],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups/unsure');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    // Neutral tokens, deliberately not the ember to-do chip: an unsure
    // object is a recorded decision, not outstanding work.
    expect(screen.getByText('unsure')).toHaveClass('bg-ash', 'text-haze');
    expect(screen.queryByText('to label')).toBeNull();
    expect(screen.getByText(/Settle them under Classify/)).toBeTruthy();
  });

  it('a label outranks is_unsure in the label cell', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [{ ...group, is_unsure: true, smoke_type: 'wildfire' }],
      page: 1,
      pages: 1,
      size: 50,
      total: 1,
    });
    renderAt('/classify/groups/all');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    expect(screen.getByText('smoke · wildfire')).toBeTruthy();
    expect(screen.queryByText('unsure')).toBeNull();
  });

  it('filter tabs carry explanatory tooltips', async () => {
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByRole('link', { name: /To label/ })).toBeTruthy());
    expect(screen.getByText("Objects that don't have a label yet")).toBeTruthy();
    expect(screen.getByText('Objects an annotator marked undecidable')).toBeTruthy();
    expect(screen.getByText('Objects that already have a label')).toBeTruthy();
    expect(screen.getByText('Every object, labeled or not')).toBeTruthy();
    // Tooltip text must not leak into the tab links' accessible names
    // (exact names: label + mocked zero count).
    expect(screen.getByRole('link', { name: 'To label 0' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Unsure 0' })).toBeTruthy();
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
    // One tooltip per labeled column (Preview, Camera, Organisation, Created,
    // Azimuth, Sightings, Label, Annotators) plus one on the row's "to label"
    // badge.
    expect(within(screen.getByRole('table')).getAllByRole('tooltip')).toHaveLength(9);
    expect(screen.getByText('Times this object was seen')).toBeTruthy();
    expect(screen.getByText(/propagates to every sighting/)).toBeTruthy();
    expect(screen.getByText('Camera viewing direction, in degrees')).toBeTruthy();
    expect(screen.getByText('Organisation operating the camera')).toBeTruthy();
    expect(screen.getByText("Who annotated this object's sightings")).toBeTruthy();
  });

  it('renders the organisation and the annotators of each object', async () => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue({
      items: [group, { ...group, id: 8, camera_name: 'CAM_08', annotators: [] }],
      page: 1,
      pages: 1,
      size: 50,
      total: 2,
    });
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('CAM_07')).toBeTruthy());

    // Cell indices, not just presence: a header inserted without its matching
    // <td> (or vice versa) renders the whole row shifted under the wrong
    // headers while every getByText still passes.
    const row = screen.getByText('CAM_07').closest('tr')!;
    expect(row.cells[2].textContent).toBe('SDIS 07');
    expect(row.cells[5].textContent).toBe('5');
    expect(row.cells[7].textContent).toBe('alice, bob');
    // Nobody has annotated the second object yet.
    const untouched = screen.getByText('CAM_08').closest('tr')!;
    expect(within(untouched).getByText('—')).toBeTruthy();
  });

  it('the subtitle describes propagation in terms of sightings', async () => {
    renderAt('/classify/groups');
    await waitFor(() => expect(screen.getByText('Recurring objects')).toBeTruthy());
    expect(screen.getByText('Label an object once to label every sighting of it.')).toBeTruthy();
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
    expect(screen.getByText(/^Classify any of this object's sightings/)).toBeTruthy();
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
