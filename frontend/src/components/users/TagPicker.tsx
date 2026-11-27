import { ReactNode, useState } from 'react';
import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { Tag } from '@/types/api';
import { TagCatalog } from '@/hooks/useTags';
import CheckMark, { CheckState } from '@/components/ui/CheckMark';
import { searchTags } from '@/utils/userAccess';

interface TagPickerProps {
  catalog: TagCatalog;
  /** Check state of a tag, and an optional trailing hint (e.g. `3/5`). */
  stateOf: (tag: Tag) => { checked: CheckState; hint?: ReactNode };
  onPick: (tag: Tag) => void;
  disabled?: boolean;
  /** Dims the list without disabling it (tags kept while full access is on). */
  muted?: boolean;
  /** Title of each row, describing what a click does. */
  actionTitle?: (tag: Tag) => string;
}

/**
 * Searchable checklist of existing tags. Tags are created on the Tags page
 * (#403), so the picker only picks.
 */
export default function TagPicker({
  catalog,
  stateOf,
  onPick,
  disabled = false,
  muted = false,
  actionTitle,
}: TagPickerProps) {
  const [query, setQuery] = useState('');
  const matches = searchTags(catalog.tags, query);

  return (
    <>
      <div className="border-b border-line px-3 py-2">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-5 w-5 text-haze" />
          </div>
          {/* autoFocus: the user just opened the popover to pick, so typing filters at once. */}
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tags…"
            aria-label="Search tags"
            className="block w-full rounded-lg border border-line py-3 pl-10 pr-3 font-body transition-colors focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember"
          />
        </div>
      </div>
      <ul className={clsx('max-h-60 overflow-y-auto py-1', muted && 'opacity-60')}>
        {catalog.isLoading && <Message>Loading tags…</Message>}
        {catalog.isError && <Message tone="signal">Could not load the tags.</Message>}
        {!catalog.isLoading && !catalog.isError && matches.length === 0 && (
          <Message>{catalog.tags.length === 0 ? 'No tags yet.' : 'No tag matches.'}</Message>
        )}
        {matches.map(tag => {
          const { checked, hint } = stateOf(tag);
          return (
            <li key={tag.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onPick(tag)}
                title={actionTitle?.(tag)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-ash disabled:cursor-wait disabled:opacity-60"
              >
                <span className="mt-0.5">
                  <CheckMark checked={checked} tone="pine" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-body text-sm font-medium text-char">
                      {tag.name}
                    </span>
                    {hint}
                  </span>
                  {tag.description && (
                    <span className="block truncate font-body text-detail text-haze">
                      {tag.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Message({ tone, children }: { tone?: 'signal'; children: ReactNode }) {
  return (
    <li
      className={clsx(
        'px-3.5 py-4 text-center font-body text-detail',
        tone === 'signal' ? 'text-signal' : 'text-haze'
      )}
    >
      {children}
    </li>
  );
}
