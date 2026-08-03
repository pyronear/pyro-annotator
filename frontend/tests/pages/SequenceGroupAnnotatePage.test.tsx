import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequenceGroup: vi.fn(),
    getSequenceGroups: vi.fn(),
    getDetectionImageUrl: vi.fn(),
    removeSequenceFromGroup: vi.fn(),
    patchSequenceGroup: vi.fn(),
  },
}));

import { apiClient } from '@/services/api';
import SequenceGroupAnnotatePage from '@/pages/SequenceGroupAnnotatePage';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/classify/groups/:id" element={<SequenceGroupAnnotatePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// first_detection_id: null keeps useDetectionImage disabled — no image fetch.
const member = {
  sequence_id: 101,
  alert_api_id: 1,
  camera_name: 'CAM_07',
  recorded_at: '2026-08-01T10:00:00Z',
  last_seen_at: '2026-08-01T10:05:00Z',
  annotation_processing_stage: null,
  first_detection_id: null,
  first_detection_algo_predictions: null,
};

const baseGroup = {
  id: 7,
  camera_id: 3,
  azimuth: 120,
  representative_bbox: {
    xyxyn: [0.4, 0.4, 0.6, 0.6] as [number, number, number, number],
    confidence: 0.9,
  },
  smoke_type: null,
  false_positive_type: null,
  is_unsure: false,
  is_validated: false,
  labeled_at: null,
  labeled_by_user_id: null,
  created_at: '2026-08-01T10:00:00Z',
  updated_at: null,
  members: [member],
};

const emptyNeighbors = { items: [], page: 1, pages: 0, size: 100, total: 0 };

async function renderGroup(overrides = {}) {
  vi.mocked(apiClient.getSequenceGroup).mockResolvedValue({ ...baseGroup, ...overrides });
  renderAt('/classify/groups/7');
  await waitFor(() => expect(screen.getByText('CAM_07 · 120°')).toBeTruthy());
}

describe('SequenceGroupAnnotatePage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSequenceGroups).mockResolvedValue(emptyNeighbors);
  });

  it('replaces the help callout with a header info tooltip', async () => {
    await renderGroup();
    expect(screen.queryByText('How to label this group')).toBeNull();
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText(/propagates/)).toBeTruthy();
    expect(within(tip).getByText(/Eject/)).toBeTruthy();
  });

  it('renders the "to label" badge with ember tones', async () => {
    await renderGroup();
    expect(screen.getByText('to label')).toHaveClass('bg-ember-soft', 'text-ember');
  });

  it('Validate group is the ember primary button', async () => {
    await renderGroup();
    const btn = screen.getByRole('button', { name: /Validate group/ });
    expect(btn.className).toContain('bg-ember');
    expect(btn.className).not.toContain('bg-green-600');
  });

  it('validated groups show a pine pill and a secondary Unvalidate button', async () => {
    await renderGroup({ is_validated: true });
    const pill = screen.getByText(/Validated/).closest('span');
    expect(pill?.className).toContain('bg-pine-soft');
    expect(pill?.className).toContain('text-pine');
    expect(screen.getByRole('button', { name: /Unvalidate/ }).className).toContain('border-line');
  });

  it('member cards use the hairline card recipe with a mono footer', async () => {
    await renderGroup();
    const card = screen.getByText('seq #101').closest('a')?.parentElement;
    // Square corners on member cards — deliberate deviation from the card
    // recipe so dense image grids read as a contact sheet.
    expect(card?.className).not.toContain('rounded');
    expect(card?.className).toContain('border-line');
    expect(card?.className).not.toContain('border-2');
    const footer = screen.getByText('seq #101').closest('div');
    expect(footer?.className).toContain('font-data');
  });

  it('card-size segmented control uses ash track with paper active pill', async () => {
    await renderGroup();
    const active = screen.getByRole('button', { name: 'M' });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.className).toContain('bg-paper');
    expect(screen.getByRole('button', { name: 'S' }).className).toContain('text-haze');
  });

  it('empty groups get the dashed hairline empty state', async () => {
    // With no members the title falls back to `camera #3 · 120°`, so this
    // test can't go through renderGroup (which waits for CAM_07).
    vi.mocked(apiClient.getSequenceGroup).mockResolvedValue({ ...baseGroup, members: [] });
    renderAt('/classify/groups/7');
    await waitFor(() => expect(screen.getByText('This group has no members.')).toBeTruthy());
    const empty = screen.getByText('This group has no members.');
    expect(empty.className).toContain('border-line');
    expect(empty.className).toContain('text-haze');
  });
});
