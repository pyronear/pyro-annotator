import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import ConnectorsPage from '@/pages/ConnectorsPage';
import { useConnectors } from '@/hooks/useConnectors';

let testMutation: {
  mutate: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  isPending: boolean;
  data: { ok: boolean; error: string | null; organizations_total: number } | undefined;
  error: Error | null;
};

vi.mock('@/hooks/useConnectors', () => ({
  useConnectors: vi.fn(),
  useCreateConnector: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteConnector: () => ({ mutate: vi.fn(), isPending: false }),
  useTestConnector: () => testMutation,
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

describe('create form — Test connection', () => {
  beforeEach(() => {
    testMutation = {
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      data: undefined,
      error: null,
    };
    vi.mocked(useConnectors).mockReturnValue({ data: [], isLoading: false } as never);
  });

  function openForm() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add connector/i }));
  }

  function fillCredentials() {
    fireEvent.change(screen.getByLabelText(/base url/i), {
      target: { value: 'https://alertapi.pyronear.org' },
    });
    fireEvent.change(screen.getByLabelText(/^login$/i), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 's3cret' } });
  }

  it('disables the button until base URL, login, and password are filled', () => {
    openForm();
    const button = screen.getByRole('button', { name: /test connection/i });
    expect(button).toBeDisabled();
    fillCredentials();
    expect(button).toBeEnabled();
  });

  it('sends exactly the three credential fields', () => {
    openForm();
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    expect(testMutation.mutate).toHaveBeenCalledWith({
      base_url: 'https://alertapi.pyronear.org',
      login: 'admin',
      password: 's3cret',
    });
  });

  it('shows a pending state while the test runs', () => {
    testMutation.isPending = true;
    openForm();
    const button = screen.getByRole('button', { name: /testing/i });
    expect(button).toBeDisabled();
  });

  it('renders a success result with the organization count', () => {
    testMutation.data = { ok: true, error: null, organizations_total: 21 };
    openForm();
    expect(
      screen.getByText(/connection ok — 21 organizations visible/i)
    ).toBeInTheDocument();
  });

  it('renders the backend error verbatim on failure', () => {
    testMutation.data = {
      ok: false,
      error:
        'ValueError: alert API returned an unexpected organizations response: Incompatible token scope.',
      organizations_total: 0,
    };
    openForm();
    expect(screen.getByText(/incompatible token scope/i)).toBeInTheDocument();
  });

  it('clears a previous result when a credential field changes', () => {
    testMutation.data = { ok: true, error: null, organizations_total: 21 };
    openForm();
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'different' },
    });
    expect(testMutation.reset).toHaveBeenCalled();
  });
});
