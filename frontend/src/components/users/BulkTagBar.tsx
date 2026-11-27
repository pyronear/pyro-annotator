import { ReactNode, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Tag as TagIcon } from 'lucide-react';
import { Tag, User } from '@/types/api';
import { TagCatalog } from '@/hooks/useTags';
import { UserAccessMutations } from '@/hooks/useUserAccessMutations';
import AnchoredPopover from '@/components/ui/AnchoredPopover';
import TagPicker from '@/components/users/TagPicker';
import { bulkTagChange, tagCoverage } from '@/utils/userAccess';

interface BulkTagBarProps {
  selectedUsers: User[];
  catalog: TagCatalog;
  mutations: UserAccessMutations;
  onClearSelection: () => void;
}

/**
 * Shown while rows are selected: give a tag to every selected user at once,
 * or remove it from all of them when they all hold it already.
 */
export default function BulkTagBar({
  selectedUsers,
  catalog,
  mutations,
  onClearSelection,
}: BulkTagBarProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const count = selectedUsers.length;
  const userNoun = count === 1 ? 'user' : 'users';
  const allHold = (tag: Tag) => tagCoverage(selectedUsers, tag.id) === count;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-paper px-[22px] py-5">
      <div className="flex items-center gap-3 border-l-2 border-ember pl-3.5">
        <span className="font-body text-sm font-semibold text-char">
          <span className="font-data">{count}</span> {userNoun} selected
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          className="font-body text-detail text-haze hover:text-char"
        >
          Clear selection
        </button>
      </div>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        className="inline-flex items-center rounded-lg bg-ember px-4 py-2 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
      >
        <TagIcon className="mr-2 h-4 w-4" />
        Tag <span className="mx-1 font-data">{count}</span> {userNoun}
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          label={`Tags of the ${count} selected ${userNoun}`}
          align="end"
          className="w-80"
        >
          <div className="flex items-center justify-between border-b border-line bg-ash px-3.5 py-2.5">
            <div>
              <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                Bulk tagging
              </div>
              <div className="font-body text-detail text-char">
                Applies to <span className="font-data font-semibold">{count}</span> selected{' '}
                {userNoun}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-line bg-paper px-3 py-2 font-body text-sm font-medium text-char hover:bg-ash"
            >
              Done
            </button>
          </div>
          <TagPicker
            catalog={catalog}
            disabled={mutations.isPending}
            stateOf={tag => {
              const holders = tagCoverage(selectedUsers, tag.id);
              if (holders === count) {
                return { checked: true, hint: <Hint className="text-pine">all {count}</Hint> };
              }
              if (holders > 0) {
                return {
                  checked: 'mixed',
                  hint: (
                    <Hint className="text-ember">
                      {holders}/{count}
                    </Hint>
                  ),
                };
              }
              return { checked: false, hint: <Hint className="text-haze">+ add</Hint> };
            }}
            actionTitle={tag =>
              allHold(tag)
                ? `Remove "${tag.name}" from the ${count} selected ${userNoun}`
                : `Give "${tag.name}" to the ${count} selected ${userNoun}`
            }
            onPick={tag => mutations.changeTagUsers(tag.id, bulkTagChange(selectedUsers, tag.id))}
          />
        </AnchoredPopover>
      )}
    </div>
  );
}

function Hint({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={clsx('flex-shrink-0 font-data text-eyebrow font-semibold', className)}>
      {children}
    </span>
  );
}
