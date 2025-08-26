import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit, Trash2, Key, Search, Filter, UserCheck, UserX } from 'lucide-react';
import { clsx } from 'clsx';
import { User, UserCreate, UserUpdate, UserPasswordUpdate, UserFilters } from '@/types/api';
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
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Check if current user is superuser
  if (!isSuperuser()) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <UserX className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access denied</h3>
          <p className="mt-1 text-sm text-gray-500">You need superuser privileges to access this page.</p>
        </div>
      </div>
    );
  }

  // Apply search filter with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters(prev => ({
        ...prev,
        search: searchTerm || undefined,
        page: 1, // Reset to first page when searching
      }));
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch users
  const { data: usersData, isLoading, error } = useQuery({
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
    mutationFn: ({ id, data }: { id: number; data: UserPasswordUpdate }) => apiClient.updateUserPassword(id, data),
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

  const toggleFilter = (key: keyof UserFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key] === value ? undefined : value,
      page: 1,
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700">Error loading users: {(error as any)?.detail || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage user accounts and permissions
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create User
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
              showFilters
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            )}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </button>
        </div>

        {/* Filter Options */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleFilter('is_active', true)}
                className={clsx(
                  'inline-flex items-center px-3 py-1 text-xs font-medium rounded-full transition-colors',
                  filters.is_active === true
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                <UserCheck className="w-3 h-3 mr-1" />
                Active Only
              </button>
              <button
                onClick={() => toggleFilter('is_active', false)}
                className={clsx(
                  'inline-flex items-center px-3 py-1 text-xs font-medium rounded-full transition-colors',
                  filters.is_active === false
                    ? 'bg-red-100 text-red-800'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                <UserX className="w-3 h-3 mr-1" />
                Inactive Only
              </button>
              <button
                onClick={() => toggleFilter('is_superuser', true)}
                className={clsx(
                  'inline-flex items-center px-3 py-1 text-xs font-medium rounded-full transition-colors',
                  filters.is_superuser === true
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                Superusers Only
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Users List */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {usersData?.items?.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{user.username}</div>
                      <div className="text-sm text-gray-500">{user.email}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                        user.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      )}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                        user.is_superuser
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                      )}
                    >
                      {user.is_superuser ? 'Superuser' : 'User'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <button
                      onClick={() => handleEditUser(user)}
                      className="text-blue-600 hover:text-blue-900 p-1 rounded"
                      title="Edit user"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleChangePassword(user)}
                      className="text-yellow-600 hover:text-yellow-900 p-1 rounded"
                      title="Change password"
                    >
                      <Key className="w-4 h-4" />
                    </button>
                    {user.id !== currentUser?.id && (
                      <button
                        onClick={() => handleDeleteUser(user)}
                        className="text-red-600 hover:text-red-900 p-1 rounded"
                        title="Delete user"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {usersData && usersData.pages > 1 && (
          <div className="bg-white px-4 py-3 border-t border-gray-200 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {((usersData.page - 1) * usersData.size) + 1} to{' '}
                {Math.min(usersData.page * usersData.size, usersData.total)} of{' '}
                {usersData.total} results
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handlePageChange(usersData.page - 1)}
                  disabled={usersData.page === 1}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => handlePageChange(usersData.page + 1)}
                  disabled={usersData.page >= usersData.pages}
                  className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
          onSubmit={(data) => createUserMutation.mutate(data)}
          isLoading={createUserMutation.isPending}
          error={createUserMutation.error as any}
        />
      )}

      {showEditModal && selectedUser && (
        <EditUserModal
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onSubmit={(data) => updateUserMutation.mutate({ id: selectedUser.id, data })}
          isLoading={updateUserMutation.isPending}
          error={updateUserMutation.error as any}
        />
      )}

      {showPasswordModal && selectedUser && (
        <PasswordChangeModal
          user={selectedUser}
          onClose={() => {
            setShowPasswordModal(false);
            setSelectedUser(null);
          }}
          onSubmit={(data) => updatePasswordMutation.mutate({ id: selectedUser.id, data })}
          isLoading={updatePasswordMutation.isPending}
          error={updatePasswordMutation.error as any}
        />
      )}
    </div>
  );
}

// Modal Components
function CreateUserModal({
  onClose,
  onSubmit,
  isLoading,
  error
}: {
  onClose: () => void;
  onSubmit: (data: UserCreate) => void;
  isLoading: boolean;
  error: any;
}) {
  const [formData, setFormData] = useState<UserCreate>({
    username: '',
    email: '',
    password: '',
    is_active: true,
    is_superuser: false,
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
                onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <PasswordField
              label="Password"
              value={formData.password}
              onChange={(value) => setFormData(prev => ({ ...prev, password: value }))}
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
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Active user</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_superuser}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_superuser: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Superuser privileges</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
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
  error
}: {
  user: User;
  onClose: () => void;
  onSubmit: (data: UserUpdate) => void;
  isLoading: boolean;
  error: any;
}) {
  const [formData, setFormData] = useState<UserUpdate>({
    username: user.username,
    email: user.email,
    is_active: user.is_active,
    is_superuser: user.is_superuser,
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
                onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Active user</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_superuser}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_superuser: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-700">Superuser privileges</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
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
  error
}: {
  user: User;
  onClose: () => void;
  onSubmit: (data: UserPasswordUpdate) => void;
  isLoading: boolean;
  error: any;
}) {
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
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Change Password: {user.username}</h3>
          
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || password !== confirmPassword}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
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