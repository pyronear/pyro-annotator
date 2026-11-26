import { ReactNode, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Tag as TagIcon } from 'lucide-react';
import { Tag, User, UserTagsChange } from '@/types/api';
import AnchoredPopover from '@/components/ui/AnchoredPopover';
import TagPicker from '@/components/users/TagPicker';
import { bulkTagChange, tagCoverage } from '@/utils/userAccess';

interface BulkTagBarProps {
  selectedUsers: User[];
  tags: Tag[];
  tagsLoading: boolean;
  isPending: boolean;
  onClearSelection: () => void;
  onChangeTagUsers: (tagId: number, change: UserTagsChange) => void;
}

/**
 * Shown while rows are selected: give a tag to every selected user at once,
 * or remove it from all of them when they all hold it already.
 */
export default function BulkTagBar({
  selectedUsers,
  tags,
  tagsLoading,
  isPending,
  onClearSelection,
  onChangeTagUsers,
}: BulkTagBarProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const count = selectedUsers.length;
  const people = count === 1 ? 'user' : 'users';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-ember/30 bg-ember-soft px-4 py-2.5">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 font-body text-sm font-semibold text-char">
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ember px-1.5 font-data text-xs font-semibold text-white">
            {count}
          </span>
          {people} selected
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
        className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-3.5 py-1.5 font-body text-sm font-semibold text-white hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-char focus:ring-offset-2"
      >
        <TagIcon className="h-3.5 w-3.5" />
        Tag {count} {people}
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          label={`Tags of the ${count} selected ${people}`}
          align="end"
          className="w-80"
        >
          <div className="flex items-center justify-between border-b border-line bg-ash px-3.5 py-2.5">
            <div>
              <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
                Bulk tagging
              </div>
              <div className="font-body text-xs text-char">
                Applies to <span className="font-data font-semibold">{count}</span> selected{' '}
                {people}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-line bg-paper px-2 py-1 font-body text-xs font-medium text-char hover:bg-ash"
            >
              Done
            </button>
          </div>
          <TagPicker
            tags={tags}
            isLoading={tagsLoading}
            disabled={isPending}
            stateOf={tag => {
              const holders = tagCoverage(selectedUsers, tag.id);
              if (holders === count) {
                return {
                  state: 'on',
                  hint: <Hint className="font-semibold text-pine">all {count}</Hint>,
                };
              }
              if (holders > 0) {
                return {
                  state: 'partial',
                  hint: (
                    <Hint className="font-semibold text-ember">
                      {holders}/{count}
                    </Hint>
                  ),
                };
              }
              return { state: 'off', hint: <Hint className="text-haze">+ add</Hint> };
            }}
            actionTitle={tag =>
              tagCoverage(selectedUsers, tag.id) === count
                ? `Remove "${tag.name}" from the ${count} selected ${people}`
                : `Give "${tag.name}" to the ${count} selected ${people}`
            }
            onPick={tag => onChangeTagUsers(tag.id, bulkTagChange(selectedUsers, tag.id))}
          />
        </AnchoredPopover>
      )}
    </div>
  );
}

function Hint({ className, children }: { className: string; children: ReactNode }) {
  return <span className={clsx('flex-shrink-0 font-data text-[11px]', className)}>{children}</span>;
}
