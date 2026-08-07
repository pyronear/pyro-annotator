import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ConnectorsPage from '@/pages/ConnectorsPage';
import { useConnectors } from '@/hooks/useConnectors';

vi.mock('@/hooks/useConnectors', () => ({
  useConnectors: vi.fn(),
  useCreateConnector: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteConnector: () => ({ mutate: vi.fn(), isPending: false }),
}));

let isSuperuserValue = true;
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { id: 1, username: 'admin' },
    isSuperuser: () => isSuperuserValue,
  }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConnectorsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ConnectorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSuperuserValue = true;
    vi.mocked(useConnectors).mockReturnValue({ data: [], isLoading: false } as never);
  });

  it('refuses non-superusers', () => {
    isSuperuserValue = false;
    renderPage();
    expect(screen.getByText(/superuser privileges/i)).toBeInTheDocument();
  });

  it('lists connectors with their enabled organization counts', () => {
    vi.mocked(useConnectors).mockReturnValue({
      data: [
        {
          id: 1,
          name: 'Pyronear France',
          base_url: 'https://alertapi.pyronear.org',
          source_api: 'pyronear_french',
          organizations_enabled: 3,
          organizations_total: 7,
          is_enabled: true,
          last_verified_at: '2026-08-06T03:00:00Z',
          last_verify_error: null,
        },
      ],
      isLoading: false,
    } as never);

    renderPage();

    expect(screen.getByText('Pyronear France')).toBeInTheDocument();
    expect(screen.getByText(/3 of 7/)).toBeInTheDocument();
  });

  it('surfaces a verification error on the row', () => {
    vi.mocked(useConnectors).mockReturnValue({
      data: [
        {
          id: 1,
          name: 'Broken',
          base_url: 'https://x.example',
          source_api: 'api_cenia',
          organizations_enabled: 0,
          organizations_total: 0,
          is_enabled: true,
          last_verified_at: null,
          last_verify_error: 'RuntimeError: 401 Unauthorized',
        },
      ],
      isLoading: false,
    } as never);

    renderPage();
    expect(screen.getByText(/401 Unauthorized/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no connectors', () => {
    renderPage();
    expect(screen.getByText(/no connectors/i)).toBeInTheDocument();
  });
});
