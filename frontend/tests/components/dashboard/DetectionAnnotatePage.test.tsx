import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequencesWithAnnotations: vi.fn(),
    getSequenceAnnotations: vi.fn(),
    getCameras: vi.fn(),
    getOrganizations: vi.fn(),
    getSourceApis: vi.fn(),
  },
}));

import { apiClient } from '@/services/api';
import DetectionAnnotatePage from '@/pages/DetectionAnnotatePage';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DetectionAnnotatePage', () => {
  beforeEach(() => {
    localStorage.clear();
    const emptyPage = { items: [], page: 1, pages: 0, size: 100, total: 0 };
    vi.mocked(apiClient.getSequencesWithAnnotations).mockResolvedValue(emptyPage);
    vi.mocked(apiClient.getSequenceAnnotations).mockResolvedValue(emptyPage);
    vi.mocked(apiClient.getCameras).mockResolvedValue([]);
    vi.mocked(apiClient.getOrganizations).mockResolvedValue([]);
    vi.mocked(apiClient.getSourceApis).mockResolvedValue([]);
  });

  it('queues sequences at seq_annotation_done by default (Localize · to do)', async () => {
    render(<DetectionAnnotatePage />, { wrapper });
    await waitFor(() => expect(apiClient.getSequencesWithAnnotations).toHaveBeenCalled());
    expect(apiClient.getSequencesWithAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ processing_stage: 'seq_annotation_done' })
    );
  });
});
