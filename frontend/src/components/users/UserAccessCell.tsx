import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Globe, Plus, X } from 'lucide-react';
import { Tag, User, UserTagsChange } from '@/types/api';
import AnchoredPopover from '@/components/ui/AnchoredPopover';
import TagPicker from '@/components/users/TagPicker';
import { hasTag, userAccess } from '@/utils/userAccess';

interface UserAccessCellProps {
  user: User;
  /** Every tag, to pick from. */
  tags: Tag[];
  tagsLoading: boolean;
  /** Admins edit; annotation managers only read. */
  editable: boolean;
  isPending: boolean;
  onChangeTagUsers: (tagId: number, change: UserTagsChange) => void;
  onSetFullAccess: (userId: number, fullAccess: boolean) => void;
}

const pill =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-body text-xs font-semibold';

/** The "Alert access" cell of a user row: what the user sees, and the popover to change it. */
export default function UserAccessCell({
  user,
  tags,
  tagsLoading,
  editable,
  isPending,
  onChangeTagUsers,
  onSetFullAccess,
}: UserAccessCellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const access = userAccess(user);

  if (access === 'system') return <span className="font-data text-detail text-haze">—</span>;
  if (access === 'admin') {
    return (
      <span className={clsx(pill, 'bg-pine-soft text-pine')} title="Admins see every alert.">
        <Globe className="h-3 w-3" />
        All alerts
      </span>
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
              className={clsx(pill, 'bg-pine-soft text-pine hover:brightness-95')}
              title="Sees every alert, whatever its tags. Click to change."
            >
              <Globe className="h-3 w-3" />
              Full access
            </button>
          ) : (
            <span className={clsx(pill, 'bg-pine-soft text-pine')} title="Sees every alert.">
              <Globe className="h-3 w-3" />
              Full access
            </span>
          )}
          {user.tags.length > 0 && (
            <span
              className="font-data text-[11px] text-haze"
              title={`Kept for when full access is turned off: ${user.tags.map(t => t.name).join(', ')}`}
            >
              +{user.tags.length} saved
            </span>
          )}
        </>
      )}

      {access === 'none' && (
        <span
          className={clsx(pill, 'bg-signal-soft text-signal')}
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
            className={clsx(
              'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-ash py-0.5 pl-2.5 font-body text-xs font-medium text-char',
              editable ? 'pr-1' : 'pr-2.5'
            )}
            title={tag.description ?? tag.name}
          >
            {tag.name}
            {editable && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onChangeTagUsers(tag.id, { remove: [user.id] })}
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
            'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed px-2 py-0.5 font-body text-xs font-medium transition-colors',
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
            disabled={isPending}
            onChange={value => onSetFullAccess(user.id, value)}
          />
          {user.full_access && (
            <p className="border-b border-line px-3.5 py-1.5 font-body text-[11px] text-haze">
              Tags below are kept for when full access is turned off.
            </p>
          )}
          <TagPicker
            tags={tags}
            isLoading={tagsLoading}
            disabled={isPending}
            muted={user.full_access}
            stateOf={tag => ({ state: hasTag(user, tag.id) ? 'on' : 'off' })}
            onPick={tag =>
              onChangeTagUsers(
                tag.id,
                hasTag(user, tag.id) ? { remove: [user.id] } : { add: [user.id] }
              )
            }
          />
        </AnchoredPopover>
      )}
    </div>
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
        <div className="font-body text-xs font-semibold text-char">Full access</div>
        <div className="font-body text-[11px] text-haze">Sees every alert, whatever its tags</div>
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
