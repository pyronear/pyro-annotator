import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Globe, Plus, X } from 'lucide-react';
import { User } from '@/types/api';
import { TagCatalog } from '@/hooks/useTags';
import { UserAccessMutations } from '@/hooks/useUserAccessMutations';
import AnchoredPopover from '@/components/ui/AnchoredPopover';
import TagPicker from '@/components/users/TagPicker';
import { bulkTagChange, hasTag, userAccess } from '@/utils/userAccess';

interface UserAccessCellProps {
  user: User;
  catalog: TagCatalog;
  mutations: UserAccessMutations;
  /** Admins edit; annotation managers only read. */
  editable: boolean;
}

// The DESIGN.md badge recipe.
const badge =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 font-body text-xs font-semibold';

/** The "Alert access" cell of a user row: what the user sees, and the popover to change it. */
export default function UserAccessCell({
  user,
  catalog,
  mutations,
  editable,
}: UserAccessCellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const access = userAccess(user);

  if (access === 'system') return <span className="font-data text-detail text-haze">—</span>;
  if (access === 'admin') {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={clsx(badge, 'bg-pine-soft text-pine')} title="Admins see every alert.">
          <Globe className="h-3 w-3" />
          All alerts
        </span>
        <SavedTags user={user} />
      </div>
    );
  }

  const toggleOpen = () => setOpen(prev => !prev);

  return (
    <div ref={anchorRef} className="flex flex-wrap items-center gap-1.5">
      {access === 'full' && (
        <>
          {editable ? (
            <button
              type="button"
              onClick={toggleOpen}
              aria-expanded={open}
              className={clsx(badge, 'bg-pine-soft text-pine hover:brightness-95')}
              title="Sees every alert, whatever its tags. Click to change."
            >
              <Globe className="h-3 w-3" />
              Full access
            </button>
          ) : (
            <span className={clsx(badge, 'bg-pine-soft text-pine')} title="Sees every alert.">
              <Globe className="h-3 w-3" />
              Full access
            </span>
          )}
          <SavedTags user={user} />
        </>
      )}

      {access === 'none' && (
        <span
          className={clsx(badge, 'bg-signal-soft text-signal')}
          title="No full access and no tag: this user sees no alert."
        >
          <AlertCircle className="h-3 w-3" />
          No alerts
        </span>
      )}

      {access === 'tagged' &&
        user.tags.map(tag => (
          <span
            key={tag.id}
            className={clsx(badge, 'border border-line bg-ash text-char', editable && 'pr-1')}
            title={tag.description ?? tag.name}
          >
            {tag.name}
            {editable && (
              <button
                type="button"
                disabled={mutations.isPending}
                onClick={() => mutations.changeTagUsers(tag.id, { remove: [user.id] })}
                className="rounded-full p-0.5 text-haze hover:bg-line hover:text-char disabled:cursor-wait"
                aria-label={`Remove ${tag.name} from ${user.username}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}

      {editable && access !== 'full' && (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-label={`Change alert access of ${user.username}`}
          className={clsx(
            'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed px-2 py-1 font-body text-xs font-medium transition-colors',
            open
              ? 'border-ember bg-ember-soft text-ember'
              : 'border-line text-haze hover:border-ember hover:text-ember'
          )}
        >
          <Plus className="h-3 w-3" />
          Tag
        </button>
      )}

      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          label={`Alert access of ${user.username}`}
          className="w-80"
        >
          <FullAccessSwitch
            checked={user.full_access}
            disabled={mutations.isPending}
            onChange={value => mutations.setFullAccess(user.id, value)}
          />
          {user.full_access && (
            <p className="border-b border-line px-3.5 py-1.5 font-body text-detail text-haze">
              Tags below are kept for when full access is turned off.
            </p>
          )}
          <TagPicker
            catalog={catalog}
            disabled={mutations.isPending}
            muted={user.full_access}
            stateOf={tag => ({ checked: hasTag(user, tag.id) })}
            onPick={tag => mutations.changeTagUsers(tag.id, bulkTagChange([user], tag.id))}
          />
        </AnchoredPopover>
      )}
    </div>
  );
}

/** Tags a user holds but does not need while they see every alert. */
function SavedTags({ user }: { user: User }) {
  if (user.tags.length === 0) return null;
  const names = user.tags.map(tag => tag.name).join(', ');
  return (
    <span
      className="font-data text-eyebrow text-haze"
      title={`Kept for when this user no longer sees every alert: ${names}`}
    >
      +{user.tags.length} saved
    </span>
  );
}

function FullAccessSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-ash px-3.5 py-2.5">
      <div>
        <div className="font-body text-sm font-semibold text-char">Full access</div>
        <div className="font-body text-detail text-haze">Sees every alert, whatever its tags</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Full access"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-1 disabled:cursor-wait',
          checked ? 'bg-pine' : 'bg-line'
        )}
      >
        <span
          className={clsx(
            'inline-block h-3.5 w-3.5 transform rounded-full bg-paper transition-transform',
            checked ? 'translate-x-4' : 'translate-x-1'
          )}
        />
      </button>
    </div>
  );
}
