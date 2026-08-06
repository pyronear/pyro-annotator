import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import ConnectorDetailPage from '@/pages/ConnectorDetailPage';
import {
  useConnectors,
  useConnectorOrganizations,
  useConnectorCoverage,
  useVerifyConnector,
  useToggleConnectorOrganization,
} from '@/hooks/useConnectors';

const toggleMutate = vi.fn();
const verifyMutate = vi.fn();

vi.mock('@/hooks/useConnectors', () => ({
  useConnectors: vi.fn(),
  useConnectorOrganizations: vi.fn(),
  useConnectorCoverage: vi.fn(),
  useVerifyConnector: vi.fn(),
  useToggleConnectorOrganization: vi.fn(),
  useUpdateConnector: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { id: 1, username: 'admin' },
    isSuperuser: () => true,
  }),
}));

const CONNECTOR = {
  id: 1,
  name: 'Pyronear France',
  base_url: 'https://alertapi.pyronear.org',
  source_api: 'pyronear_french',
  login: 'admin',
  has_password: true,
  is_enabled: true,
  trailing_days: 3,
  image_transfer: null,
  last_verified_at: '2026-08-06T03:00:00Z',
  last_verify_error: null,
  organizations_total: 2,
  organizations_enabled: 1,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/connectors/1']}>
        <Routes>
          <Route path="/connectors/:connectorId" element={<ConnectorDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConnectorDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useConnectors).mockReturnValue({
      data: [CONNECTOR],
      isLoading: false,
    } as never);
    vi.mocked(useConnectorOrganizations).mockReturnValue({
      data: [
        {
          id: 1,
          organization_id: 10,
          name: 'Ardeche',
          is_enabled: true,
          enabled_at: '2026-08-01T00:00:00Z',
        },
        {
          id: 2,
          organization_id: 20,
          name: 'Aveyron',
          is_enabled: false,
          enabled_at: null,
        },
      ],
      isLoading: false,
    } as never);
    vi.mocked(useConnectorCoverage).mockReturnValue({
      data: [],
      isLoading: false,
    } as never);
    vi.mocked(useVerifyConnector).mockReturnValue({
      mutate: verifyMutate,
      isPending: false,
      data: undefined,
    } as never);
    vi.mocked(useToggleConnectorOrganization).mockReturnValue({
      mutate: toggleMutate,
      isPending: false,
    } as never);
  });

  it('never renders the password, only that one is set', () => {
    renderPage();
    expect(screen.getByText(/password is set/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/hunter/i)).not.toBeInTheDocument();
  });

  it('lists discovered organizations with their enabled state', () => {
    renderPage();
    expect(screen.getByLabelText('Ardeche')).toBeChecked();
    expect(screen.getByLabelText('Aveyron')).not.toBeChecked();
  });

  it('toggling an organization calls the mutation', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Aveyron'));
    expect(toggleMutate).toHaveBeenCalledWith({ organizationId: 20, isEnabled: true });
  });

  it('triggers verification', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(verifyMutate).toHaveBeenCalled();
  });

  it('reports the cross-organization probe result after verifying', () => {
    vi.mocked(useVerifyConnector).mockReturnValue({
      mutate: verifyMutate,
      isPending: false,
      data: {
        ok: true,
        error: null,
        organizations: [],
        organizations_seen_in_sample: 4,
        organizations_total: 7,
        sample_date: '2026-08-05',
      },
    } as never);

    renderPage();
    expect(screen.getByText(/4 of 7/)).toBeInTheDocument();
  });

  it('renders the coverage heatmap for enabled organizations only', () => {
    renderPage();
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
    // Aveyron is disabled, so it gets no heatmap row — but it still appears in
    // the organization checkbox list above.
    expect(screen.getAllByText('Ardeche').length).toBeGreaterThan(0);
    // CoverageHeatmap tags each cell data-testid="coverage-cell-{organization_id}-{date}"
    // (organization_id 20 is Aveyron). Scoped to that prefix, not to the name
    // "Aveyron" itself, since Aveyron legitimately still appears in the
    // checkbox list above.
    expect(screen.queryAllByTestId(/^coverage-cell-20-/)).toHaveLength(0);
  });
});
