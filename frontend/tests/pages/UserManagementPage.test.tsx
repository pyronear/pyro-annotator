import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserManagementPage from '@/pages/UserManagementPage';
import { Tag, User } from '@/types/api';

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
    getTags: vi.fn(),
    updateTagUsers: vi.fn(),
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
  full_access: false,
  tags: [],
  is_system: false,
  created_at: '2026-01-02T00:00:00Z',
};

const campaign: Tag = {
  id: 10,
  name: 'campaign',
  description: 'Hackathon alerts',
  created_by: 1,
  created_at: '2026-11-26T00:00:00Z',
};
const cenia: Tag = { ...campaign, id: 11, name: 'cenia', description: null };

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
  vi.mocked(apiClient.getTags).mockResolvedValue([campaign, cenia]);
  vi.mocked(apiClient.updateTagUsers).mockResolvedValue({ tag_id: 10, added: 1, removed: 0 });
});

const mockUsers = (items: User[]) =>
  vi.mocked(apiClient.getUsers).mockResolvedValue({
    items,
    page: 1,
    pages: 1,
    size: 50,
    total: items.length,
  });

const tagged: User = { ...trainee, id: 4, username: 'tagged', tags: [campaign] };
const trusted: User = { ...trainee, id: 5, username: 'trusted', full_access: true };
const admin: User = { ...trainee, id: 6, username: 'chief', role: 'admin' };

describe('UserManagementPage alert access', () => {
  it('shows what each user sees', async () => {
    mockUsers([trainee, tagged, trusted, admin]);
    renderPage();

    expect(await screen.findByText('No alerts')).toBeInTheDocument();
    expect(screen.getByText('campaign')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /full access/i })).toBeInTheDocument();
    expect(screen.getByText('All alerts')).toBeInTheDocument();
  });

  it('removes a tag from its pill', async () => {
    mockUsers([tagged]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove campaign from tagged' }));

    await waitFor(() => expect(apiClient.updateTagUsers).toHaveBeenCalledWith(10, { remove: [4] }));
  });

  it('gives a tag and turns full access on from the row popover', async () => {
    mockUsers([trainee]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Change alert access of scout' }));
    const popover = await screen.findByRole('dialog', { name: 'Alert access of scout' });

    fireEvent.click(within(popover).getByRole('checkbox', { name: /cenia/ }));
    await waitFor(() => expect(apiClient.updateTagUsers).toHaveBeenCalledWith(11, { add: [2] }));

    fireEvent.click(within(popover).getByRole('switch', { name: 'Full access' }));
    await waitFor(() =>
      expect(apiClient.updateUser).toHaveBeenCalledWith(2, { full_access: true })
    );
  });

  it('filters the tag list from the popover search', async () => {
    mockUsers([trainee]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Change alert access of scout' }));
    const popover = await screen.findByRole('dialog');
    await within(popover).findByRole('checkbox', { name: /cenia/ });

    fireEvent.change(within(popover).getByLabelText('Search tags'), {
      target: { value: 'hackathon' },
    });

    expect(within(popover).getByRole('checkbox', { name: /campaign/ })).toBeInTheDocument();
    expect(within(popover).queryByRole('checkbox', { name: /cenia/ })).not.toBeInTheDocument();
  });

  it('tags the selected users in bulk, skipping those who have the tag', async () => {
    mockUsers([trainee, tagged, admin]);
    renderPage();

    // Admins see every alert by role, so they cannot be selected.
    await screen.findByText('All alerts');
    expect(screen.queryByRole('checkbox', { name: 'Select chief' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every user on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tag 2 users' }));
    const popover = await screen.findByRole('dialog');
    const row = await within(popover).findByRole('checkbox', { name: /campaign/ });
    expect(row).toHaveAttribute('aria-checked', 'mixed');

    fireEvent.click(row);

    await waitFor(() => expect(apiClient.updateTagUsers).toHaveBeenCalledWith(10, { add: [2] }));
  });

  it('clears the selection when a filter changes', async () => {
    mockUsers([trainee, tagged]);
    renderPage();

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select scout' }));
    expect(screen.getByText('user selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /no alerts/i }));

    await waitFor(() => expect(screen.queryByText('user selected')).not.toBeInTheDocument());
    expect(apiClient.getUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ access: 'none', page: 1 })
    );
  });

  it('creates a user with full access', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /create user/i }));
    const modal = screen.getByText('Create New User').closest('div.fixed') as HTMLElement;
    fireEvent.change(within(modal).getByRole('textbox'), { target: { value: 'trusted' } });
    fireEvent.change(modal.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'supersecret1' },
    });
    fireEvent.click(within(modal).getByLabelText(/full access/i));
    fireEvent.click(within(modal).getByRole('button', { name: /create user/i }));

    await waitFor(() =>
      expect(apiClient.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'trusted', full_access: true })
      )
    );
  });
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

  it('shows the alert access read-only, without loading the admin-only tags', async () => {
    mockUsers([{ ...trainee, tags: [campaign] }]);
    vi.mocked(apiClient.getTags).mockClear();
    renderPage();

    expect(await screen.findByText('campaign')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove campaign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change alert access/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /select/i })).not.toBeInTheDocument();
    expect(apiClient.getTags).not.toHaveBeenCalled();
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
