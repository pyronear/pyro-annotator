import { useState, useEffect, useId } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Check,
  Edit,
  Filter,
  Globe,
  Key,
  Minus,
  Plus,
  Tag as TagIcon,
  Trash2,
  UserCheck,
  UserX,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  RightStatus,
  User,
  UserCreate,
  UserRole,
  UserUpdate,
  UserPasswordUpdate,
  UserFilters,
} from '@/types/api';

// Error type for mutation errors
type MutationError = {
  detail?: string;
  message?: string;
} | null;
import { apiClient } from '@/services/api';
import { QUERY_KEYS, PAGINATION_DEFAULTS } from '@/utils/constants';
import { useAuthStore } from '@/store/useAuthStore';
import PasswordField from '@/components/ui/PasswordField';
import { formatDate } from '@/utils/datetime';
import { RIGHT_STATUSES, RIGHT_STATUS_LABELS, ROLE_LABELS, USER_ROLES } from '@/utils/userRights';
import { canTakeTags } from '@/utils/userAccess';
import { useUserTagMutations } from '@/hooks/useUserTagMutations';
import { useToastNotifications } from '@/utils/notification/toastUtils';
import { NotificationSystem } from '@/components/ui/NotificationSystem';
import UserAccessCell from '@/components/users/UserAccessCell';
import BulkTagBar from '@/components/users/BulkTagBar';

export default function UserManagementPage() {
  const { user: currentUser, isAdmin, isManager } = useAuthStore();
  const queryClient = useQueryClient();

  // Filters and pagination
  const [filters, setFilters] = useState<UserFilters>({
    page: PAGINATION_DEFAULTS.PAGE,
    size: PAGINATION_DEFAULTS.SIZE,
  });
  const [showFilters, setShowFilters] = useState(false);

  // Rows selected for bulk tagging. Scoped to the page on screen: changing
  // page or filters clears it.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const clearSelection = () => setSelectedIds(new Set());

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
    placeholderData: keepPreviousData,
  });

  // Tags are admin-only for now (#401): managers see the column read-only.
  const canEditAccess = isAdmin();
  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: QUERY_KEYS.TAGS,
    queryFn: () => apiClient.getTags(),
    enabled: canEditAccess,
  });

  const { showToast, toastMessage, toastType, showToastNotification, dismissToast } =
    useToastNotifications();
  const userTags = useUserTagMutations(message => showToastNotification(message, 'error'));

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

  // Check if current user manages users - AFTER all hooks
  if (!isManager()) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <UserX className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access denied</h3>
          <p className="mt-1 text-sm text-gray-500">
            You need the annotation manager or admin role to access this page.
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
    clearSelection();
  };

  const toggleFilter = (key: keyof UserFilters, value: UserFilters[keyof UserFilters]) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key] === value ? undefined : value,
      page: 1,
    }));
    clearSelection();
  };

  const users = usersData?.items ?? [];
  const selectableUsers = canEditAccess ? users.filter(canTakeTags) : [];
  const selectedUsers = selectableUsers.filter(user => selectedIds.has(user.id));
  const allSelected = selectableUsers.length > 0 && selectedUsers.length === selectableUsers.length;
  const someSelected = selectedUsers.length > 0 && !allSelected;

  const toggleSelected = (userId: number) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const toggleAllSelected = () =>
    setSelectedIds(allSelected ? new Set() : new Set(selectableUsers.map(user => user.id)));

  const chipClass = (selected: boolean, tone: 'pine' | 'ember' | 'signal') =>
    clsx(
      'inline-flex items-center px-3 py-1 font-body text-xs font-medium rounded-full transition-colors',
      selected
        ? {
            pine: 'bg-pine-soft text-pine',
            ember: 'bg-ember-soft text-ember',
            signal: 'bg-signal-soft text-signal',
          }[tone]
        : 'bg-ash text-haze hover:text-char'
    );

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
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight text-char">
            User Management
          </h1>
          <p className="mt-1 font-body text-body text-haze">
            Manage user accounts, permissions and which alerts each user sees
          </p>
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
          {isAdmin() && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create User
            </button>
          )}
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
              onClick={() => toggleFilter('role', 'admin')}
              className={clsx(
                'inline-flex items-center px-3 py-1 font-body text-xs font-medium rounded-full transition-colors',
                filters.role === 'admin'
                  ? 'bg-ember-soft text-ember'
                  : 'bg-ash text-haze hover:text-char'
              )}
            >
              Admins Only
            </button>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
            <button
              onClick={() => toggleFilter('access', 'full')}
              className={chipClass(filters.access === 'full', 'pine')}
              title="Admins and users with full access"
            >
              <Globe className="w-3 h-3 mr-1" />
              Full access
            </button>
            <button
              onClick={() => toggleFilter('access', 'none')}
              className={chipClass(filters.access === 'none', 'signal')}
              title="No full access and no tag: these users see no alert"
            >
              <AlertCircle className="w-3 h-3 mr-1" />
              No alerts
            </button>
          </div>
          {canEditAccess && tags.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="mr-1 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                Tag
              </span>
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleFilter('tag_id', tag.id)}
                  className={chipClass(filters.tag_id === tag.id, 'ember')}
                  title={tag.description ?? tag.name}
                >
                  <TagIcon className="w-3 h-3 mr-1" />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedUsers.length > 0 && (
        <BulkTagBar
          selectedUsers={selectedUsers}
          tags={tags}
          tagsLoading={tagsLoading}
          isPending={userTags.isPending}
          onClearSelection={clearSelection}
          onChangeTagUsers={userTags.changeTagUsers}
        />
      )}

      {/* Users List */}
      <div className="rounded-card border border-line bg-paper overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-ash">
              <tr>
                {canEditAccess && (
                  <th className="w-10 py-3 pl-4 pr-2 text-left">
                    <SelectBox
                      checked={allSelected ? true : someSelected ? 'mixed' : false}
                      disabled={selectableUsers.length === 0}
                      label="Select every user on this page"
                      onToggle={toggleAllSelected}
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  User
                </th>
                <th className="px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Role
                </th>
                <th className="px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Rights
                </th>
                <th className="px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Alert access
                </th>
                <th className="px-4 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Created
                </th>
                <th className="px-4 py-3 text-right font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-paper divide-y divide-line">
              {users.length === 0 && (
                <tr>
                  <td
                    colSpan={canEditAccess ? 8 : 7}
                    className="px-4 py-10 text-center font-body text-detail text-haze"
                  >
                    No user matches these filters.
                  </td>
                </tr>
              )}
              {users.map(user => (
                <tr
                  key={user.id}
                  className={selectedIds.has(user.id) ? 'bg-ember-soft' : 'hover:bg-ash'}
                >
                  {canEditAccess && (
                    <td className="w-10 py-4 pl-4 pr-2">
                      {canTakeTags(user) && (
                        <SelectBox
                          checked={selectedIds.has(user.id)}
                          label={`Select ${user.username}`}
                          onToggle={() => toggleSelected(user.id)}
                        />
                      )}
                    </td>
                  )}
                  <td className="px-4 py-4 whitespace-nowrap">
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
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full',
                        user.is_active ? 'bg-pine-soft text-pine' : 'bg-signal-soft text-signal'
                      )}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span
                      className={clsx(
                        'inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full',
                        user.role === 'annotator' ? 'bg-ash text-haze' : 'bg-ember-soft text-ember'
                      )}
                    >
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col items-start gap-1 whitespace-nowrap">
                      <RightBadge label="Classify" status={user.classify_status} />
                      <RightBadge label="Localize" status={user.localize_status} />
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <UserAccessCell
                      user={user}
                      tags={tags}
                      tagsLoading={tagsLoading}
                      editable={canEditAccess}
                      isPending={userTags.isPending}
                      onChangeTagUsers={userTags.changeTagUsers}
                      onSetFullAccess={userTags.setFullAccess}
                    />
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap font-data text-detail text-haze">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium space-x-1">
                    {!user.is_system && (
                      <>
                        {(isAdmin() || user.role === 'annotator') && (
                          <button
                            onClick={() => handleEditUser(user)}
                            className="text-haze hover:text-char p-1 rounded"
                            title={isAdmin() ? 'Edit user' : 'Edit rights'}
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin() && (
                          <button
                            onClick={() => handleChangePassword(user)}
                            className="text-haze hover:text-char p-1 rounded"
                            title="Change password"
                          >
                            <Key className="w-4 h-4" />
                          </button>
                        )}
                        {isAdmin() && user.id !== currentUser?.id && (
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
          canEditAll={isAdmin()}
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

      <NotificationSystem
        showToast={showToast}
        toastMessage={toastMessage}
        toastType={toastType}
        onDismiss={dismissToast}
        autoDismissMs={3500}
      />
    </div>
  );
}

function SelectBox({
  checked,
  disabled = false,
  label,
  onToggle,
}: {
  checked: boolean | 'mixed';
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={clsx(
        'flex h-4 w-4 items-center justify-center rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-1 disabled:opacity-40',
        checked
          ? 'border-ember bg-ember text-white'
          : 'border-line bg-paper text-transparent hover:border-haze'
      )}
    >
      {checked === 'mixed' ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
    </button>
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
    role: 'annotator',
    classify_status: 'training',
    localize_status: 'locked',
    full_access: false,
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
              <label className="flex items-start">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2">
                  <span className="block text-sm text-gray-700">Active user</span>
                  <span className="block text-xs text-gray-500">
                    Can sign in. Deactivated users keep their history but cannot log in.
                  </span>
                </span>
              </label>

              <RightsFields
                role={formData.role}
                classifyStatus={formData.classify_status}
                localizeStatus={formData.localize_status}
                showRole
                onChange={changes => setFormData(prev => ({ ...prev, ...changes }))}
              />

              <FullAccessField
                checked={formData.full_access ?? false}
                onChange={value => setFormData(prev => ({ ...prev, full_access: value }))}
              />
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
  canEditAll,
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  user: User;
  /** Admin: every field. Annotation manager: the right statuses only. */
  canEditAll: boolean;
  onClose: () => void;
  onSubmit: (data: UserUpdate) => void;
  isLoading: boolean;
  error: MutationError;
}) {
  useEscapeToClose(onClose);

  const [formData, setFormData] = useState<UserUpdate>({
    username: user.username,
    is_active: user.is_active,
    role: user.role,
    classify_status: user.classify_status,
    localize_status: user.localize_status,
    full_access: user.full_access,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // A manager may only send the right statuses; the API rejects any other field.
    onSubmit(
      canEditAll
        ? formData
        : {
            classify_status: formData.classify_status,
            localize_status: formData.localize_status,
          }
    );
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
            {canEditAll && (
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
            )}

            <div className="space-y-3">
              {canEditAll && (
                <label className="flex items-start">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2">
                    <span className="block text-sm text-gray-700">Active user</span>
                    <span className="block text-xs text-gray-500">
                      Can sign in. Deactivated users keep their history but cannot log in.
                    </span>
                  </span>
                </label>
              )}

              <RightsFields
                role={formData.role}
                classifyStatus={formData.classify_status}
                localizeStatus={formData.localize_status}
                showRole={canEditAll}
                onChange={changes => setFormData(prev => ({ ...prev, ...changes }))}
              />

              {canEditAll && (
                <FullAccessField
                  checked={formData.full_access ?? false}
                  onChange={value => setFormData(prev => ({ ...prev, full_access: value }))}
                />
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

function FullAccessField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 rounded border-line text-pine focus:ring-ember"
      />
      <span className="ml-2">
        <span className="block font-body text-sm text-char">Full access</span>
        <span className="block font-body text-xs text-haze">
          Sees every alert, whatever its tags. Without it, the user only sees the alerts of their
          tags (given from the user list).
        </span>
      </span>
    </label>
  );
}

function RightBadge({ label, status }: { label: string; status: RightStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex px-2 py-1 font-body text-xs font-semibold rounded-full',
        status === 'granted' && 'bg-pine-soft text-pine',
        status === 'training' && 'bg-ember-soft text-ember',
        status === 'locked' && 'bg-ash text-haze'
      )}
    >
      {label}: {RIGHT_STATUS_LABELS[status]}
    </span>
  );
}

function RightsFields({
  role,
  classifyStatus,
  localizeStatus,
  showRole,
  onChange,
}: {
  role?: UserRole;
  classifyStatus?: RightStatus;
  localizeStatus?: RightStatus;
  showRole: boolean;
  onChange: (changes: Partial<UserUpdate>) => void;
}) {
  const selectClass =
    'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';
  const id = useId();
  return (
    <div className="space-y-3">
      {showRole && (
        <div>
          <label htmlFor={`${id}-role`} className="block text-sm font-medium text-gray-700 mb-1">
            Role
          </label>
          <select
            id={`${id}-role`}
            value={role}
            onChange={e => onChange({ role: e.target.value as UserRole })}
            className={selectClass}
          >
            {USER_ROLES.map(value => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="block mt-1 text-xs text-gray-500">
            An annotation manager opens and validates the trainings of annotators. An admin manages
            every user and has every right.
          </span>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-classify`} className="block text-sm font-medium text-gray-700 mb-1">
          Classify right
        </label>
        <select
          id={`${id}-classify`}
          value={classifyStatus}
          onChange={e => onChange({ classify_status: e.target.value as RightStatus })}
          className={selectClass}
        >
          {RIGHT_STATUSES.map(value => (
            <option key={value} value={value}>
              {RIGHT_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-localize`} className="block text-sm font-medium text-gray-700 mb-1">
          Localize right
        </label>
        <select
          id={`${id}-localize`}
          value={localizeStatus}
          onChange={e => onChange({ localize_status: e.target.value as RightStatus })}
          className={selectClass}
        >
          {RIGHT_STATUSES.map(value => (
            <option key={value} value={value}>
              {RIGHT_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="block mt-1 text-xs text-gray-500">
          Granted lets the user draw smoke boxes in the Localize section.
        </span>
      </div>
    </div>
  );
}
