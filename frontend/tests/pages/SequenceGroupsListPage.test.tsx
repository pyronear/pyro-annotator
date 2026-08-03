import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    await waitFor(() => expect(screen.getByText('All groups labeled')).toBeTruthy());
    expect(screen.getByText(/every group is labeled/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start classifying' }).getAttribute('href')).toBe(
      '/classify'
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Labeled empty shows no-labeled-groups state with CTA to the To label tab', async () => {
    renderAt('/classify/groups/labeled');
    await waitFor(() => expect(screen.getByText('No labeled groups yet')).toBeTruthy());
    expect(screen.getByText(/Groups you label land here/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Label groups' }).getAttribute('href')).toBe(
      '/classify/groups'
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('All empty shows no-groups state with no action', async () => {
    renderAt('/classify/groups/all');
    await waitFor(() => expect(screen.getByText('No groups yet')).toBeTruthy());
    expect(screen.getByText(/only groups of 3 or more sequences/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start classifying' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Label groups' })).toBeNull();
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
    expect(screen.queryByText('All groups labeled')).toBeNull();
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
    // One tooltip per labeled column (Camera, Azimuth, Sequences, Label, Reviewed, Created)
    expect(screen.getAllByRole('tooltip')).toHaveLength(6);
    expect(screen.getByText('Number of sequences in the group')).toBeTruthy();
    expect(screen.getByText(/propagates to every member/)).toBeTruthy();
    expect(screen.getByText('Camera viewing direction, in degrees')).toBeTruthy();
  });
});
