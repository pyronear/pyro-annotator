import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Plug, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';

import {
  useConnectors,
  useCreateConnector,
  useDeleteConnector,
  useTestConnector,
} from '@/hooks/useConnectors';
import { useAuthStore } from '@/store/useAuthStore';
import { formatDateTime } from '@/utils/datetime';
import type { Connector, ConnectorCreatePayload } from '@/types/api';

const SOURCE_API_OPTIONS: { value: string; label: string }[] = [
  { value: 'pyronear_french', label: 'Pyronear (French)' },
  { value: 'alert_wildfire', label: 'AlertWildfire' },
  { value: 'api_cenia', label: 'CENIA' },
];

const IMAGE_TRANSFER_OPTIONS: { value: '' | 'url' | 'bucket-copy'; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'url', label: 'URL' },
  { value: 'bucket-copy', label: 'Bucket copy' },
];

export default function ConnectorsPage() {
  const { isSuperuser } = useAuthStore();

  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  const { data: connectors, isLoading } = useConnectors();
  const createConnectorMutation = useCreateConnector();
  const deleteConnectorMutation = useDeleteConnector();
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Check if current user is superuser - AFTER all hooks
  if (!isSuperuser()) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Plug className="mx-auto h-12 w-12 text-haze" />
          <h3 className="mt-2 font-body text-sm font-medium text-char">Access denied</h3>
          <p className="mt-1 font-body text-sm text-haze">
            You need superuser privileges to access this page.
          </p>
        </div>
      </div>
    );
  }

  const handleDelete = (connector: Connector) => {
    if (confirm(`Are you sure you want to delete connector "${connector.name}"?`)) {
      deleteConnectorMutation.mutate(connector.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-title font-semibold tracking-tight text-char">
            Connectors
          </h1>
          <p className="mt-1 font-body text-body text-haze">
            Alert APIs the backend imports from daily
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add connector
        </button>
      </div>

      {/* Connectors */}
      {!connectors || connectors.length === 0 ? (
        <div className="rounded-card border border-line bg-paper p-12 text-center">
          <Plug className="mx-auto h-12 w-12 text-haze" />
          <h3 className="mt-2 font-body text-sm font-medium text-char">
            No connectors configured yet.
          </h3>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-paper overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-ash">
                <tr>
                  <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Base URL
                  </th>
                  <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Organizations
                  </th>
                  <th className="px-6 py-3 text-left font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Verification
                  </th>
                  <th className="px-6 py-3 text-right font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-paper divide-y divide-line">
                {connectors.map(connector => (
                  <tr key={connector.id} className="hover:bg-ash">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link
                        to={`/connectors/${connector.id}`}
                        className="font-body text-sm font-medium text-char hover:text-ember"
                      >
                        {connector.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap font-data text-detail text-haze">
                      {connector.base_url}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex rounded-full bg-ash px-2 py-1 font-body text-xs font-semibold text-haze">
                        {connector.source_api}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={clsx(
                          'inline-flex rounded-full px-2 py-1 font-body text-xs font-semibold',
                          connector.is_enabled ? 'bg-pine-soft text-pine' : 'bg-ash text-haze'
                        )}
                      >
                        {connector.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap font-data text-detail text-haze">
                      {connector.organizations_enabled} of {connector.organizations_total}{' '}
                      organizations
                    </td>
                    <td className="px-6 py-4">
                      {connector.last_verify_error ? (
                        <span className="font-body text-xs text-signal">
                          {connector.last_verify_error}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap font-data text-detail text-haze">
                          {connector.last_verified_at
                            ? formatDateTime(connector.last_verified_at)
                            : 'Never'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <button
                        onClick={() => handleDelete(connector)}
                        className="rounded p-1 text-haze hover:text-signal"
                        title="Delete connector"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreateModal && (
        <CreateConnectorModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={data => {
            createConnectorMutation.mutate(data, {
              onSuccess: () => setShowCreateModal(false),
            });
          }}
          isLoading={createConnectorMutation.isPending}
          error={createConnectorMutation.error as { detail?: string } | null}
        />
      )}
    </div>
  );
}

function CreateConnectorModal({
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: ConnectorCreatePayload) => void;
  isLoading: boolean;
  error: { detail?: string } | null;
}) {
  const [formData, setFormData] = useState<ConnectorCreatePayload>({
    name: '',
    base_url: '',
    source_api: SOURCE_API_OPTIONS[0].value,
    login: '',
    password: '',
    is_enabled: true,
    trailing_days: 3,
    image_transfer: null,
  });

  const testMutation = useTestConnector();
  const canTest =
    formData.base_url.trim() !== '' &&
    formData.login.trim() !== '' &&
    formData.password !== '' &&
    !testMutation.isPending;

  const setCredentialField = (field: 'base_url' | 'login' | 'password', value: string) => {
    testMutation.reset(); // a stale result must not vouch for edited credentials
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const inputClass =
    'w-full rounded-lg border border-line px-3 py-2 font-body text-sm text-char focus:outline-none focus:ring-2 focus:ring-ember focus:border-ember transition-colors';
  const labelClass = 'mb-1 block font-body text-xs font-medium text-haze';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-char/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-paper p-6">
        <div className="flex items-start justify-between">
          <h3 className="font-display text-heading font-semibold text-char">Add connector</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1.5 rounded-md p-1.5 hover:bg-ash"
          >
            <X className="h-4 w-4 text-haze" />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-signal-soft p-4 font-body text-sm text-signal">
            {error.detail || 'Failed to create connector'}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="connector-base-url" className={labelClass}>
              Base URL
            </label>
            <input
              id="connector-base-url"
              type="url"
              required
              value={formData.base_url}
              onChange={e => setCredentialField('base_url', e.target.value)}
              className={inputClass}
              placeholder="https://alertapi.example.org"
            />
          </div>

          <div>
            <label className={labelClass}>Source API</label>
            <select
              value={formData.source_api}
              onChange={e => setFormData(prev => ({ ...prev, source_api: e.target.value }))}
              className={inputClass}
            >
              {SOURCE_API_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="connector-login" className={labelClass}>
              Login
            </label>
            <input
              id="connector-login"
              type="text"
              required
              value={formData.login}
              onChange={e => setCredentialField('login', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="connector-password" className={labelClass}>
              Password
            </label>
            <input
              id="connector-password"
              type="password"
              required
              value={formData.password}
              onChange={e => setCredentialField('password', e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() =>
                testMutation.mutate({
                  base_url: formData.base_url,
                  login: formData.login,
                  password: formData.password,
                })
              }
              disabled={!canTest}
              className="rounded-lg border border-line px-3 py-2 font-body text-sm text-char transition-colors hover:bg-ash disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testMutation.isPending ? 'Testing…' : 'Test connection'}
            </button>
            {testMutation.data?.ok && (
              <p className="mt-2 font-body text-sm text-pine">
                Connection OK — {testMutation.data.organizations_total} organizations visible
              </p>
            )}
            {testMutation.data && !testMutation.data.ok && (
              <p className="mt-2 font-body text-sm text-signal">{testMutation.data.error}</p>
            )}
            {testMutation.error && (
              <p className="mt-2 font-body text-sm text-signal">{testMutation.error.message}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>Trailing days</label>
            <input
              type="number"
              min={1}
              max={30}
              required
              value={formData.trailing_days}
              onChange={e =>
                setFormData(prev => ({ ...prev, trailing_days: Number(e.target.value) }))
              }
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>Image transfer</label>
            <select
              value={formData.image_transfer ?? ''}
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  image_transfer: (e.target.value ||
                    null) as ConnectorCreatePayload['image_transfer'],
                }))
              }
              className={inputClass}
            >
              {IMAGE_TRANSFER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.is_enabled}
              onChange={e => setFormData(prev => ({ ...prev, is_enabled: e.target.checked }))}
              className="rounded border-line text-ember focus:ring-ember"
            />
            <span className="font-body text-sm text-char">Enabled</span>
          </label>

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-paper px-4 py-2 font-body text-sm font-medium text-char hover:bg-ash"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50"
            >
              {isLoading ? 'Creating...' : 'Add connector'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
