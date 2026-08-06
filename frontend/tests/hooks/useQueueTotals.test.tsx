import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequences: vi.fn(),
    getSequenceAnnotations: vi.fn(),
    getSequenceGroupStats: vi.fn(),
    getLocalizationQueue: vi.fn(),
    getClassifyQueue: vi.fn(),
  },
}));

import { apiClient } from '@/services/api';
import { useAnnotationCounts } from '@/hooks/useAnnotationCounts';
import { usePipelineStats } from '@/hooks/usePipelineStats';

function page(total: number) {
  return { items: [], page: 1, pages: 1, size: 1, total };
}

describe('queue totals shared by the sidebar badges and the dashboard', () => {
  let client: QueryClient;

  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiClient.getClassifyQueue).mockReset();
    vi.mocked(apiClient.getLocalizationQueue).mockReset();
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue(page(481));
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue(page(9));
    vi.mocked(apiClient.getSequences).mockResolvedValue(page(522));
    vi.mocked(apiClient.getSequenceAnnotations).mockResolvedValue(page(0));
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 40,
      validated: 20,
      unvalidated: 15,
      labeled: 28,
      unlabeled: 12,
    });
  });

  // The reported bug: the sidebar "Alerts" pill and the dashboard's Classify
  // card showed different numbers. Reading one cache entry makes them equal by
  // construction — separate entries would refetch independently and drift.
  it('badge and dashboard read one cache entry, so their counts are equal', async () => {
    const badge = renderHook(() => useAnnotationCounts(), { wrapper });
    const dashboard = renderHook(() => usePipelineStats(), { wrapper });

    await waitFor(() => expect(badge.result.current.isLoading).toBe(false));
    await waitFor(() => expect(dashboard.result.current.isLoading).toBe(false));

    expect(badge.result.current.sequenceCount).toBe(481);
    expect(dashboard.result.current.classifyTodo).toBe(481);
    expect(badge.result.current.detectionCount).toBe(9);
    expect(dashboard.result.current.localizeTodo).toBe(9);

    // One request each, not one per consumer — proves a single shared entry
    // rather than two that merely happen to agree on first load.
    expect(apiClient.getClassifyQueue).toHaveBeenCalledTimes(1);
    expect(apiClient.getLocalizationQueue).toHaveBeenCalledTimes(1);
  });

  it('both surfaces refetch on window focus, so neither lags the other', async () => {
    const badge = renderHook(() => useAnnotationCounts(), { wrapper });
    const dashboard = renderHook(() => usePipelineStats(), { wrapper });
    await waitFor(() => expect(badge.result.current.isLoading).toBe(false));
    await waitFor(() => expect(dashboard.result.current.isLoading).toBe(false));

    const classifyQuery = client
      .getQueryCache()
      .find({ queryKey: ['annotation-counts', 'classify-queue-total'] });
    expect(classifyQuery).toBeDefined();
    // A `false` here (the global App default) is what let the badge refresh on
    // focus while the dashboard card kept a stale number.
    expect(classifyQuery?.options.refetchOnWindowFocus).toBe(true);
  });
});
