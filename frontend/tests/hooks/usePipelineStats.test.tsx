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
  },
}));

import { apiClient } from '@/services/api';
import { usePipelineStats } from '@/hooks/usePipelineStats';

const stageTotals: Record<string, number> = {
  ready_to_annotate: 57,
  seq_annotation_done: 22,
  in_review: 4,
  annotated: 427,
  needs_manual: 4,
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
  });

  it('derives pipeline stats from the eight count queries', async () => {
    const { result } = renderHook(() => usePipelineStats(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.classifyTodo).toBe(57);
    // Localize · to do is the gated queue total (alerts ready), not the
    // seq_annotation_done proxy.
    expect(result.current.localizeTodo).toBe(9);
    expect(result.current.complete).toBe(418);
    expect(result.current.completePct).toBe(80);
    expect(result.current.attention).toBe(4);
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
