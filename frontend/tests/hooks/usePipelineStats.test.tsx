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
import { usePipelineStats } from '@/hooks/usePipelineStats';

const stageTotals: Record<string, number> = {
  // Unreachable post-fix (STAGES no longer queries it); kept so a regression
  // reports the bug's own number — 57 lanes instead of 31 alerts.
  ready_to_annotate: 57,
  seq_annotation_done: 22,
  annotated: 427,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function page(total: number) {
  return { items: [], page: 1, pages: 1, size: 1, total };
}

describe('usePipelineStats', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSequences).mockImplementation(((params?: Record<string, unknown>) =>
      Promise.resolve(
        page(params?.detection_annotation_completion === 'complete' ? 418 : 522)
      )) as unknown as typeof apiClient.getSequences);
    vi.mocked(apiClient.getSequenceAnnotations).mockImplementation(((
      params?: Record<string, unknown>
    ) =>
      Promise.resolve(
        page(stageTotals[String(params?.processing_stage)] ?? 0)
      )) as unknown as typeof apiClient.getSequenceAnnotations);
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 40,
      validated: 20,
      unvalidated: 20,
      labeled: 28,
      unlabeled: 12,
    });
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue(page(9));
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue(page(31));
  });

  it('derives pipeline stats from the six count queries', async () => {
    const { result } = renderHook(() => usePipelineStats(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Classify · to do is the alert-grouped queue total (what /classify and
    // the sidebar badge show), not the per-lane ready_to_annotate count (57).
    expect(result.current.classifyTodo).toBe(31);
    expect(apiClient.getClassifyQueue).toHaveBeenCalledWith({ size: 1 });
    // Localize · to do is the gated queue total (alerts ready), not the
    // seq_annotation_done proxy.
    expect(result.current.localizeTodo).toBe(9);
    expect(result.current.complete).toBe(418);
    expect(result.current.completePct).toBe(80);
    expect(result.current.total).toBe(522);
    expect(result.current.groupsToLabel).toBe(12);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error string when a count query fails', async () => {
    vi.mocked(apiClient.getSequences).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePipelineStats(), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toContain('boom');
  });
});
