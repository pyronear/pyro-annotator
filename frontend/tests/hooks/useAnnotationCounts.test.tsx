import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getLocalizationQueue: vi.fn(),
    getClassifyQueue: vi.fn(),
    getSequenceGroupStats: vi.fn(),
  },
}));

import { apiClient } from '@/services/api';
import { useAnnotationCounts } from '@/hooks/useAnnotationCounts';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function page(total: number) {
  return { items: [], page: 1, pages: 1, size: 1, total };
}

describe('useAnnotationCounts', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue(page(42));
    vi.mocked(apiClient.getLocalizationQueue).mockResolvedValue(page(9));
    vi.mocked(apiClient.getSequenceGroupStats).mockResolvedValue({
      total: 40,
      validated: 20,
      unvalidated: 15,
      labeled: 28,
      unlabeled: 12,
    });
  });

  it('counts alerts in the classify queue (via getClassifyQueue)', async () => {
    const { result } = renderHook(() => useAnnotationCounts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sequenceCount).toBe(42);
    expect(vi.mocked(apiClient.getClassifyQueue)).toHaveBeenCalledWith({ size: 1 });
  });

  it('counts alerts in the localization queue', async () => {
    const { result } = renderHook(() => useAnnotationCounts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.detectionCount).toBe(9);
  });

  it('counts unvalidated groups', async () => {
    const { result } = renderHook(() => useAnnotationCounts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groupCount).toBe(15);
  });

  it('surfaces an error string when a count query fails', async () => {
    vi.mocked(apiClient.getClassifyQueue).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAnnotationCounts(), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain('boom');
  });
});
