import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plug } from 'lucide-react';

import {
  useConnectors,
  useConnectorOrganizations,
  useConnectorCoverage,
  useVerifyConnector,
  useToggleConnectorOrganization,
  useUpdateConnector,
} from '@/hooks/useConnectors';
import { useAuthStore } from '@/store/useAuthStore';
import { CoverageHeatmap } from '@/components/connectors/CoverageHeatmap';
import { formatDate, formatDateTime } from '@/utils/datetime';
import type { ConnectorUpdatePayload } from '@/types/api';

const IMAGE_TRANSFER_OPTIONS: { value: '' | 'url' | 'bucket-copy'; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'url', label: 'URL' },
  { value: 'bucket-copy', label: 'Bucket copy' },
];

interface SettingsFormState {
  name: string;
  base_url: string;
  login: string;
  trailing_days: number;
  image_transfer: 'url' | 'bucket-copy' | null;
  is_enabled: boolean;
}

/**
 * Coverage dates are alert-API UTC dates, so "last 30 days" has to be
 * computed in UTC — a local-timezone window would shift which day a cell on
 * the edge of the range represents.
 */
function defaultCoverageWindow(): { dateFrom: string; dateEnd: string } {
  const end = new Date();
  const dateEnd = end.toISOString().slice(0, 10);
  const start = new Date(end);
  // 29, not 30: matches the server default (date_end - 29 days), which makes
  // a 30-day *inclusive* window (date_from..date_end spans 30 calendar days).
  start.setUTCDate(start.getUTCDate() - 29);
  const dateFrom = start.toISOString().slice(0, 10);
  return { dateFrom, dateEnd };
}

const inputClass =
  'w-full rounded-lg border border-line px-3 py-2 font-body text-sm text-char focus:outline-none focus:ring-2 focus:ring-ember focus:border-ember transition-colors';
const labelClass = 'mb-1 block font-body text-xs font-medium text-haze';

export default function ConnectorDetailPage() {
  const { connectorId } = useParams();
  const id = Number(connectorId);
  const { isSuperuser } = useAuthStore();

  // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
  const { data: connectors, isLoading } = useConnectors();
  const connector = connectors?.find(c => c.id === id);

  const { data: organizations } = useConnectorOrganizations(id);
  const { dateFrom, dateEnd } = useMemo(() => defaultCoverageWindow(), []);
  const { data: coverageCells } = useConnectorCoverage(id, dateFrom, dateEnd);
  const verifyMutation = useVerifyConnector(id);
  const toggleMutation = useToggleConnectorOrganization(id);
  const updateMutation = useUpdateConnector(id);

  const [formData, setFormData] = useState<SettingsFormState | null>(null);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');

  // Populate the form once the connector loads. Guarded on `formData ===
  // null` so a background refetch (e.g. after verify invalidates the
  // connectors query) never clobbers an in-progress edit.
  useEffect(() => {
    if (connector && formData === null) {
      setFormData({
        name: connector.name,
        base_url: connector.base_url,
        login: connector.login,
        trailing_days: connector.trailing_days,
        image_transfer: connector.image_transfer,
        is_enabled: connector.is_enabled,
      });
    }
  }, [connector, formData]);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ember"></div>
      </div>
    );
  }

  if (!connector) {
    return (
      <div className="mx-auto max-w-5xl">
        <Link
          to="/connectors"
          className="font-body text-detail text-haze hover:text-char inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Connectors
        </Link>
        <p className="mt-4 font-body text-sm text-haze">Connector not found.</p>
      </div>
    );
  }

  const enabledOrganizations = (organizations ?? []).filter(org => org.is_enabled);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData) return;
    const payload: ConnectorUpdatePayload = { ...formData };
    // Only send a password when the operator actually typed one — the
    // backend never returns the existing password, so an unchanged field
    // here would silently overwrite it with garbage.
    if (showPasswordInput && passwordValue) {
      payload.password = passwordValue;
    }
    updateMutation.mutate(payload, {
      onSuccess: () => {
        setShowPasswordInput(false);
        setPasswordValue('');
      },
    });
  };

  const verifyResult = verifyMutation.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to="/connectors"
          className="font-body text-detail text-haze hover:text-char inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Connectors
        </Link>
        <h1 className="mt-2 font-display text-title font-semibold tracking-tight text-char">
          {connector.name}
        </h1>
        <p className="mt-1 font-data text-detail text-haze">{connector.base_url}</p>
      </div>

      {/* Settings */}
      <div className="rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">Settings</h2>
        {formData && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label className={labelClass}>Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={e =>
                  setFormData(prev => (prev ? { ...prev, name: e.target.value } : prev))
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Base URL</label>
              <input
                type="url"
                required
                value={formData.base_url}
                onChange={e =>
                  setFormData(prev => (prev ? { ...prev, base_url: e.target.value } : prev))
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Login</label>
              <input
                type="text"
                required
                value={formData.login}
                onChange={e =>
                  setFormData(prev => (prev ? { ...prev, login: e.target.value } : prev))
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Password</label>
              {!showPasswordInput ? (
                <div className="flex items-center gap-3">
                  <span className="font-body text-sm text-haze">A password is set</span>
                  <button
                    type="button"
                    onClick={() => setShowPasswordInput(true)}
                    className="font-body text-detail text-ember hover:brightness-95"
                  >
                    Replace password
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={passwordValue}
                    onChange={e => setPasswordValue(e.target.value)}
                    placeholder="New password"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowPasswordInput(false);
                      setPasswordValue('');
                    }}
                    className="font-body text-detail text-haze hover:text-char"
                  >
                    Cancel
                  </button>
                </div>
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
                  setFormData(prev =>
                    prev ? { ...prev, trailing_days: Number(e.target.value) } : prev
                  )
                }
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Image transfer</label>
              <select
                value={formData.image_transfer ?? ''}
                onChange={e =>
                  setFormData(prev =>
                    prev
                      ? {
                          ...prev,
                          image_transfer: (e.target.value ||
                            null) as SettingsFormState['image_transfer'],
                        }
                      : prev
                  )
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
                onChange={e =>
                  setFormData(prev => (prev ? { ...prev, is_enabled: e.target.checked } : prev))
                }
                className="rounded border-line text-ember focus:ring-ember"
              />
              <span className="font-body text-sm text-char">Enabled</span>
            </label>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Verify */}
      <div className="rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">
          Verify &amp; discover organizations
        </h2>
        <p className="mt-1 font-body text-detail text-haze">
          Lists sequences across every organization visible to this account, and records which ones
          it actually saw — one admin login is expected to cover them all.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            className="inline-flex items-center rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash disabled:opacity-50"
          >
            {verifyMutation.isPending ? 'Verifying...' : 'Verify & discover organizations'}
          </button>
          <span className="font-data text-detail text-haze">
            Last verified:{' '}
            {connector.last_verified_at ? formatDateTime(connector.last_verified_at) : 'Never'}
          </span>
        </div>

        {verifyResult && (
          <div className="mt-4">
            {verifyResult.ok ? (
              <p className="font-body text-sm text-pine">
                Saw sequences from{' '}
                <span className="font-data">
                  {verifyResult.organizations_seen_in_sample} of {verifyResult.organizations_total}
                </span>{' '}
                organizations on{' '}
                <span className="font-data">
                  {/* sample_date is a bare UTC date string ('2026-08-05'), not a
                      timestamp — formatDate would re-parse it as UTC midnight and
                      render it a day early for negative-offset viewers. Render it
                      raw, same treatment as dateFrom/dateEnd below. */}
                  {verifyResult.sample_date ?? '—'}
                </span>
                .
              </p>
            ) : (
              <div className="rounded-lg bg-signal-soft p-4 font-body text-sm text-signal">
                {verifyResult.error || 'Verification failed'}
              </div>
            )}
          </div>
        )}

        {verifyMutation.isError && (
          <div className="mt-4 rounded-lg bg-signal-soft p-4 font-body text-sm text-signal">
            {(verifyMutation.error as { detail?: string })?.detail || 'Verification request failed'}
          </div>
        )}
      </div>

      {/* Organizations */}
      <div className="rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">Organizations</h2>
        <p className="mt-1 font-body text-detail text-haze">
          Enable the organizations this connector should import from.
        </p>
        {!organizations || organizations.length === 0 ? (
          <p className="mt-4 font-body text-sm text-haze">
            No organizations discovered yet. Run verify to discover them.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {organizations.map(org => (
              <li key={org.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`org-${org.organization_id}`}
                    checked={org.is_enabled}
                    disabled={toggleMutation.isPending}
                    onChange={() =>
                      toggleMutation.mutate({
                        organizationId: org.organization_id,
                        isEnabled: !org.is_enabled,
                      })
                    }
                    className="rounded border-line text-ember focus:ring-ember"
                  />
                  <label
                    htmlFor={`org-${org.organization_id}`}
                    className="font-body text-sm text-char"
                  >
                    {org.name}
                  </label>
                </div>
                <span className="font-data text-detail text-haze">
                  {org.is_enabled && org.enabled_at
                    ? `enabled ${formatDate(org.enabled_at)}`
                    : 'not enabled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Coverage */}
      <div className="rounded-card border border-line bg-paper px-[22px] py-5">
        <h2 className="font-display text-heading font-semibold text-char">Coverage</h2>
        <p className="mt-1 font-data text-detail text-haze">
          {dateFrom} to {dateEnd}
        </p>

        {/* Legend — the six cell states are unreadable without it. Swatches
            mirror CoverageHeatmap's STATE_CLASS exactly (same pine /
            pine-soft / signal-hatch / dashed treatment), duplicated here
            rather than imported since the component doesn't export its class
            constants. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-body text-detail text-haze">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3 rounded-sm bg-pine" />
            Imported
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm bg-pine ring-2 ring-inset ring-signal"
            />
            Partially failed
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm bg-pine-soft ring-1 ring-inset ring-pine"
            />
            Covered, no alerts
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 rounded-sm bg-signal-soft [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(179,38,30,0.55)_3px,rgba(179,38,30,0.55)_6px)]"
            />
            Failed or never attempted
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3 rounded-sm border border-dashed border-line" />
            Not enabled yet
          </span>
        </div>

        {enabledOrganizations.length === 0 ? (
          <p className="mt-4 font-body text-sm text-haze">No organizations enabled yet.</p>
        ) : (
          <div className="mt-4">
            <CoverageHeatmap
              organizations={enabledOrganizations}
              cells={coverageCells ?? []}
              dateFrom={dateFrom}
              dateEnd={dateEnd}
            />
          </div>
        )}
      </div>
    </div>
  );
}
