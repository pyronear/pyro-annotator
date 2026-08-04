import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Key, Filter, UserCheck, UserX } from 'lucide-react';
import { clsx } from 'clsx';
import { User, UserCreate, UserUpdate, UserPasswordUpdate, UserFilters } from '@/types/api';

// Error type for mutation errors
type MutationError = {
  detail?: string;
  message?: string;
} | null;
import { apiClient } from '@/services/api';
import { QUERY_KEYS, PAGINATION_DEFAULTS } from '@/utils/constants';
import { useAuthStore } from '@/store/useAuthStore';
import PasswordField from '@/components/ui/PasswordField';

export default function UserManagementPage() {
  const { user: currentUser, isSuperuser } = useAuthStore();
  const queryClient = useQueryClient();

  // Filters and pagination
  const [filters, setFilters] = useState<UserFilters>({
    page: PAGINATION_DEFAULTS.PAGE,
    size: PAGINATION_DEFAULTS.SIZE,
  });
  const [showFilters, setShowFilters] = useState(false);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  // Fetch users
  const {
    data: usersData,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...QUERY_KEYS.USERS, filters],
    queryFn: () => apiClient.getUsers(filters),
  });

  // Mutations
  const createUserMutation = useMutation({
    mutationFn: (userData: UserCreate) => apiClient.createUser(userData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.USERS });
      setShowCreateModal(false);
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserUpdate }) => apiClient.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.USERS });
      setShowEditModal(false);
      setSelectedUser(null);
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserPasswordUpdate }) =>
      apiClient.updateUserPassword(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.USERS });
      setShowPasswordModal(false);
      setSelectedUser(null);
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.USERS });
    },
  });

  // Check if current user is superuser - AFTER all hooks
  if (!isSuperuser()) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <UserX className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access denied</h3>
          <p className="mt-1 text-sm text-gray-500">
            You need superuser privileges to access this page.
          </p>
        </div>
      </div>
    );
  }

  const handleDeleteUser = (user: User) => {
    if (user.id === currentUser?.id) {
      alert('You cannot delete your own account.');
      return;
    }

    if (confirm(`Are you sure you want to delete user "${user.username}"?`)) {
      deleteUserMutation.mutate(user.id);
    }
  };

  const handleEditUser = (user: User) => {
    setSelectedUser(user);
    setShowEditModal(true);
  };

  const handleChangePassword = (user: User) => {
    setSelectedUser(user);
    setShowPasswordModal(true);
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const toggleFilter = (key: keyof UserFilters, value: UserFilters[keyof UserFilters]) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key] === value ? undefined : value,
      page: 1,
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-signal-soft border border-signal/20 rounded-lg p-4">
        <p className="font-body text-signal">
          Error loading users: {error?.message || 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight text-char">
            User Management
          </h1>
          <p className="mt-1 font-body text-body text-haze">Manage user accounts and permissions</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'inline-flex items-center rounded-lg border px-3 py-2 font-body text-sm font-medium transition-colors',
              showFilters
                ? 'border-ember/30 bg-ember-soft text-ember'
                : 'border-line bg-paper text-char hover:bg-ash'
            )}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create User
          </button>
        </div>
      </div>

      {/* Filter Options */}
      {showFilters && (
        <div className="rounded-card border border-line bg-paper p-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleFilter('is_active', true)}
              className={clsx(
                'inline-flex items-center px-3 py-1 font-body text-xs font-medium rounded-full transition-colors',
                filters.is_active === true
                  ? 'bg-pine-soft text-pine'
                  : 'bg-ash text-haze hover:text-char'
              )}
            >
              <UserCheck className="w-3 h-3 mr-1" />
              Active Only
            </button>
            <button
              onClick={() => toggleFilter('is_active', false)}
              className={clsx(
                'inline-flex items-center px-3 py-1 font-body text-xs font-medium rounded-full transition-colors',
                filters.is_active === false
                  ? 'bg-signal-soft text-signal'
                  : 'bg-ash text-haze hover:text-char'
              )}
            >
              <UserX className="w-3 h-3 mr-1" />
              Inactive Only
            </button>
            <button
              onClick={() => toggleFilter('is_superuser', true)}
              className={clsx(
                'inline-flex items-center px-3 py-1 font-body text-xs font-medium rounded-full transition-colors',
                filters.is_superuser === true
                  ? 'bg-ember-soft text-ember'
                  : 'bg-ash text-haze hover:text-char'
              )}
            >
              Superusers Only
            </button>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="rounded-card border border-line bg-paper overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-ash">
              <tr>
                <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  User
                </th>
                <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Status
                </th>
                <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Role
                </th>
                <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Created
                </th>
                <th className="px-6 py-3 text-right font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-paper divide-y divide-line">
              {usersData?.items?.map(user => (
                <tr key={user.id} className="hover:bg-ash">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="font-body text-sm font-medium text-char">{user.username}</div>
                      {user.is_system && (
                        <span
                          className="ml-2 inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full bg-ash text-haze cursor-help"
                          title="Automated account used to attribute annotations inherited during group reassignment. It cannot log in, and cannot be edited or deleted."
                        >
                          System
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full',
                        user.is_active ? 'bg-pine-soft text-pine' : 'bg-signal-soft text-signal'
                      )}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full',
                        user.is_superuser ? 'bg-ember-soft text-ember' : 'bg-ash text-haze'
                      )}
                    >
                      {user.is_superuser ? 'Superuser' : 'User'}
                    </span>
                    {user.can_localize && (
                      <span className="ml-1 inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full bg-pine-soft text-pine">
                        Localize
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-data text-detail text-haze">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    {!user.is_system && (
                      <>
                        <button
                          onClick={() => handleEditUser(user)}
                          className="text-haze hover:text-char p-1 rounded"
                          title="Edit user"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleChangePassword(user)}
                          className="text-haze hover:text-char p-1 rounded"
                          title="Change password"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        {user.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="text-haze hover:text-signal p-1 rounded"
                            title="Delete user"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {usersData && usersData.pages > 1 && (
          <div className="bg-paper px-4 py-3 border-t border-line sm:px-6">
            <div className="flex items-center justify-between">
              <div className="font-body text-sm text-haze">
                Showing {(usersData.page - 1) * usersData.size + 1} to{' '}
                {Math.min(usersData.page * usersData.size, usersData.total)} of {usersData.total}{' '}
                results
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handlePageChange(usersData.page - 1)}
                  disabled={usersData.page === 1}
                  className="rounded-lg border border-line px-3 py-1 font-body text-sm text-char hover:bg-ash disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => handlePageChange(usersData.page + 1)}
                  disabled={usersData.page >= usersData.pages}
                  className="rounded-lg border border-line px-3 py-1 font-body text-sm text-char hover:bg-ash disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={data => createUserMutation.mutate(data)}
          isLoading={createUserMutation.isPending}
          error={createUserMutation.error}
        />
      )}

      {showEditModal && selectedUser && (
        <EditUserModal
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onSubmit={data => updateUserMutation.mutate({ id: selectedUser.id, data })}
          isLoading={updateUserMutation.isPending}
          error={updateUserMutation.error}
        />
      )}

      {showPasswordModal && selectedUser && (
        <PasswordChangeModal
          user={selectedUser}
          onClose={() => {
            setShowPasswordModal(false);
            setSelectedUser(null);
          }}
          onSubmit={data => updatePasswordMutation.mutate({ id: selectedUser.id, data })}
          isLoading={updatePasswordMutation.isPending}
          error={updatePasswordMutation.error}
        />
      )}
    </div>
  );
}

// Modal Components
function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);
}

function CreateUserModal({
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: UserCreate) => void;
  isLoading: boolean;
  error: MutationError;
}) {
  useEscapeToClose(onClose);

  const [formData, setFormData] = useState<UserCreate>({
    username: '',
    password: '',
    is_active: true,
    is_superuser: false,
    can_localize: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New User</h3>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error.detail || 'Failed to create user'}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                required
                value={formData.username}
                onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <PasswordField
              label="Password"
              value={formData.password}
              onChange={value => setFormData(prev => ({ ...prev, password: value }))}
              required
              showGenerator={true}
              showStrengthIndicator={true}
              showRequirements={false}
            />

            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Active user</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_superuser}
                  onChange={e => setFormData(prev => ({ ...prev, is_superuser: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Superuser privileges</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.can_localize}
                  onChange={e => setFormData(prev => ({ ...prev, can_localize: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Can localize</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-body text-sm font-medium text-char bg-paper border border-line rounded-lg hover:bg-ash"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 font-body text-sm font-semibold text-white bg-ember border border-transparent rounded-lg hover:brightness-95 disabled:opacity-50"
              >
                {isLoading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  user: User;
  onClose: () => void;
  onSubmit: (data: UserUpdate) => void;
  isLoading: boolean;
  error: MutationError;
}) {
  useEscapeToClose(onClose);

  const [formData, setFormData] = useState<UserUpdate>({
    username: user.username,
    is_active: user.is_active,
    is_superuser: user.is_superuser,
    can_localize: user.can_localize,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit User: {user.username}</h3>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error.detail || 'Failed to update user'}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                required
                value={formData.username}
                onChange={e => setFormData(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Active user</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_superuser}
                  onChange={e => setFormData(prev => ({ ...prev, is_superuser: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Superuser privileges</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.can_localize}
                  onChange={e => setFormData(prev => ({ ...prev, can_localize: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Can localize</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-body text-sm font-medium text-char bg-paper border border-line rounded-lg hover:bg-ash"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 font-body text-sm font-semibold text-white bg-ember border border-transparent rounded-lg hover:brightness-95 disabled:opacity-50"
              >
                {isLoading ? 'Updating...' : 'Update User'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function PasswordChangeModal({
  user,
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  user: User;
  onClose: () => void;
  onSubmit: (data: UserPasswordUpdate) => void;
  isLoading: boolean;
  error: MutationError;
}) {
  useEscapeToClose(onClose);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }
    onSubmit({ password });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Change Password: {user.username}
          </h3>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error.detail || 'Failed to update password'}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              label="New Password"
              value={password}
              onChange={setPassword}
              required
              showGenerator={true}
              showStrengthIndicator={true}
              showRequirements={false}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
                  confirmPassword && password && password !== confirmPassword
                    ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                    : confirmPassword && password && password === confirmPassword
                      ? 'border-green-300 focus:ring-green-500 focus:border-green-500'
                      : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                }`}
              />
              {confirmPassword && password && password !== confirmPassword && (
                <p className="text-xs text-red-600 mt-1">Passwords do not match</p>
              )}
              {confirmPassword && password && password === confirmPassword && (
                <p className="text-xs text-green-600 mt-1">Passwords match</p>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-body text-sm font-medium text-char bg-paper border border-line rounded-lg hover:bg-ash"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || password !== confirmPassword}
                className="px-4 py-2 font-body text-sm font-semibold text-white bg-ember border border-transparent rounded-lg hover:brightness-95 disabled:opacity-50"
              >
                {isLoading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
