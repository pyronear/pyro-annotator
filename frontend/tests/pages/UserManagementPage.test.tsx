import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserManagementPage from '@/pages/UserManagementPage';
import { User } from '@/types/api';

let isAdminValue = true;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { id: 1, username: 'admin' },
    isAdmin: () => isAdminValue,
    isManager: () => true,
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

const trainee: User = {
  id: 2,
  username: 'scout',
  is_active: true,
  role: 'annotator',
  classify_status: 'granted',
  localize_status: 'training',
  can_classify: true,
  can_localize: false,
  is_system: false,
  created_at: '2026-01-02T00:00:00Z',
};

const manager: User = {
  ...trainee,
  id: 3,
  username: 'boss',
  role: 'annotation_manager',
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

const openEditDialog = async (title: RegExp) => {
  fireEvent.click((await screen.findAllByTitle(title))[0]);
  return screen.getByText(/edit user: scout/i).closest('div.fixed') as HTMLElement;
};

beforeEach(() => {
  isAdminValue = true;
  vi.mocked(apiClient.getUsers).mockResolvedValue({
    items: [trainee, manager],
    page: 1,
    pages: 1,
    size: 50,
    total: 2,
  });
  vi.mocked(apiClient.createUser).mockResolvedValue(trainee);
  vi.mocked(apiClient.updateUser).mockResolvedValue(trainee);
});

describe('UserManagementPage as admin', () => {
  it('shows the role and the status of each right', async () => {
    renderPage();

    expect(await screen.findByText('Annotation manager')).toBeInTheDocument();
    expect(screen.getAllByText('Classify: Granted')).toHaveLength(2);
    expect(screen.getAllByText('Localize: In training')).toHaveLength(2);
  });

  it('creates an annotator in classify training by default', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /create user/i }));
    const modal = screen.getByText('Create New User').closest('div.fixed') as HTMLElement;

    fireEvent.change(within(modal).getByRole('textbox'), {
      target: { value: 'newbie' },
    });
    fireEvent.change(modal.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'supersecret1' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: /create user/i }));

    await waitFor(() =>
      expect(apiClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newbie',
          role: 'annotator',
          classify_status: 'training',
          localize_status: 'locked',
        })
      )
    );
  });

  it('initializes and sends the statuses in the edit payload', async () => {
    renderPage();

    const modal = await openEditDialog(/^edit user$/i);
    const localize = within(modal).getByLabelText(/localize right/i) as HTMLSelectElement;
    expect(localize.value).toBe('training');

    fireEvent.change(localize, { target: { value: 'granted' } });
    fireEvent.click(within(modal).getByRole('button', { name: /update user/i }));

    await waitFor(() =>
      expect(apiClient.updateUser).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ localize_status: 'granted', role: 'annotator' })
      )
    );
  });
});

describe('UserManagementPage as annotation manager', () => {
  beforeEach(() => {
    isAdminValue = false;
  });

  it('hides the admin-only actions', async () => {
    renderPage();

    await screen.findByText('Annotation manager');
    expect(screen.queryByRole('button', { name: /create user/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Change password')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Delete user')).not.toBeInTheDocument();
    // Only the annotator row can be edited.
    expect(screen.getAllByTitle('Edit rights')).toHaveLength(1);
  });

  it('sends only the right statuses', async () => {
    renderPage();

    const modal = await openEditDialog(/edit rights/i);
    expect(within(modal).queryByLabelText(/role/i)).not.toBeInTheDocument();
    expect(within(modal).queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.change(within(modal).getByLabelText(/localize right/i), {
      target: { value: 'granted' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: /update user/i }));

    await waitFor(() =>
      expect(apiClient.updateUser).toHaveBeenCalledWith(2, {
        classify_status: 'granted',
        localize_status: 'granted',
      })
    );
  });
});
