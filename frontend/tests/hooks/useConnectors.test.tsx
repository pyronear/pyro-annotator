import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useConnectors, useToggleConnectorOrganization } from '@/hooks/useConnectors';
import { apiClient } from '@/services/api';

vi.mock('@/services/api', () => ({
  apiClient: {
    getConnectors: vi.fn(),
    getConnectorOrganizations: vi.fn(),
    toggleConnectorOrganization: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useConnectors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the connector list', async () => {
    vi.mocked(apiClient.getConnectors).mockResolvedValue([
      { id: 1, name: 'France', organizations_enabled: 2, organizations_total: 7 },
    ] as never);

    const { result } = renderHook(() => useConnectors(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].name).toBe('France');
  });
});

describe('useToggleConnectorOrganization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the connector id, organization id, and new state', async () => {
    vi.mocked(apiClient.toggleConnectorOrganization).mockResolvedValue({} as never);

    const { result } = renderHook(() => useToggleConnectorOrganization(3), { wrapper });
    result.current.mutate({ organizationId: 42, isEnabled: true });

    await waitFor(() =>
      expect(apiClient.toggleConnectorOrganization).toHaveBeenCalledWith(3, 42, true)
    );
  });
});
