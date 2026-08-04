import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserManagementPage from '@/pages/UserManagementPage';
import { User } from '@/types/api';

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { id: 1, username: 'admin' },
    isSuperuser: () => true,
  }),
}));

vi.mock('@/services/api', () => ({
  apiClient: {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    updateUserPassword: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

import { apiClient } from '@/services/api';

const localizer: User = {
  id: 2,
  username: 'scout',
  is_active: true,
  is_superuser: false,
  can_localize: true,
  is_system: false,
  created_at: '2026-01-02T00:00:00Z',
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UserManagementPage />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.mocked(apiClient.getUsers).mockResolvedValue({
    items: [localizer],
    page: 1,
    pages: 1,
    size: 50,
    total: 1,
  });
  vi.mocked(apiClient.createUser).mockResolvedValue(localizer);
  vi.mocked(apiClient.updateUser).mockResolvedValue(localizer);
});

describe('UserManagementPage can_localize', () => {
  it('shows a Localize badge for users who can localize', async () => {
    renderPage();

    expect(await screen.findByText('Localize')).toBeInTheDocument();
  });

  it('sends can_localize in the create payload', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /create user/i }));
    const modal = screen.getByText('Create New User').closest('div.fixed') as HTMLElement;

    fireEvent.change(within(modal).getByRole('textbox'), {
      target: { value: 'newbie' },
    });
    fireEvent.change(modal.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'supersecret1' },
    });
    fireEvent.click(within(modal).getByRole('checkbox', { name: /can localize/i }));
    fireEvent.click(within(modal).getByRole('button', { name: /create user/i }));

    await waitFor(() =>
      expect(apiClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'newbie', can_localize: true })
      )
    );
  });

  it('explains each permission toggle in the create dialog', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /create user/i }));
    const modal = screen.getByText('Create New User').closest('div.fixed') as HTMLElement;

    expect(
      within(modal).getByText('Can sign in. Deactivated users keep their history but cannot log in.')
    ).toBeInTheDocument();
    expect(
      within(modal).getByText('Full admin: manage users and all permissions (includes localization).')
    ).toBeInTheDocument();
    expect(
      within(modal).getByText(
        'Can draw smoke boxes in the Localize section. Otherwise the user only classifies.'
      )
    ).toBeInTheDocument();
  });

  it('explains each permission toggle in the edit dialog', async () => {
    renderPage();

    fireEvent.click(await screen.findByTitle('Edit user'));
    const modal = screen
      .getByText(/edit user: scout/i)
      .closest('div.fixed') as HTMLElement;

    expect(
      within(modal).getByText('Can sign in. Deactivated users keep their history but cannot log in.')
    ).toBeInTheDocument();
    expect(
      within(modal).getByText('Full admin: manage users and all permissions (includes localization).')
    ).toBeInTheDocument();
    expect(
      within(modal).getByText(
        'Can draw smoke boxes in the Localize section. Otherwise the user only classifies.'
      )
    ).toBeInTheDocument();
  });

  it('initializes and sends can_localize in the edit payload', async () => {
    renderPage();

    fireEvent.click(await screen.findByTitle('Edit user'));
    const modal = screen
      .getByText(/edit user: scout/i)
      .closest('div.fixed') as HTMLElement;

    const checkbox = within(modal).getByRole('checkbox', { name: /can localize/i });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    fireEvent.click(within(modal).getByRole('button', { name: /update user/i }));

    await waitFor(() =>
      expect(apiClient.updateUser).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ can_localize: false })
      )
    );
  });
});
