import { ReactNode, useState } from 'react';
import { clsx } from 'clsx';
import { Check, Minus, Search } from 'lucide-react';
import { Tag } from '@/types/api';
import { searchTags } from '@/utils/userAccess';

export type TagCheckState = 'on' | 'partial' | 'off';

interface TagPickerProps {
  tags: Tag[];
  /** Check state of a tag, and an optional trailing hint (e.g. `3/5`). */
  stateOf: (tag: Tag) => { state: TagCheckState; hint?: ReactNode };
  onPick: (tag: Tag) => void;
  disabled?: boolean;
  /** Dims the list without disabling it (tags kept while full access is on). */
  muted?: boolean;
  isLoading?: boolean;
  /** Title of each row, describing what a click does. */
  actionTitle?: (tag: Tag) => string;
}

/**
 * Searchable checklist of existing tags. Tags are created on the Tags page
 * (#403), so the picker only picks.
 */
export default function TagPicker({
  tags,
  stateOf,
  onPick,
  disabled = false,
  muted = false,
  isLoading = false,
  actionTitle,
}: TagPickerProps) {
  const [query, setQuery] = useState('');
  const matches = searchTags(tags, query);

  return (
    <>
      <div className="border-b border-line px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-haze" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tags…"
            aria-label="Search tags"
            className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-2.5 font-body text-xs text-char placeholder:text-haze focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember"
          />
        </div>
      </div>
      <ul className={clsx('max-h-60 overflow-y-auto py-1', muted && 'opacity-60')}>
        {isLoading && (
          <li className="px-3.5 py-4 text-center font-body text-xs text-haze">Loading tags…</li>
        )}
        {!isLoading && matches.length === 0 && (
          <li className="px-3.5 py-4 text-center font-body text-xs text-haze">
            {tags.length === 0 ? 'No tags yet. Create them on the Tags page.' : 'No tag matches.'}
          </li>
        )}
        {matches.map(tag => {
          const { state, hint } = stateOf(tag);
          return (
            <li key={tag.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={state === 'on' ? true : state === 'partial' ? 'mixed' : false}
                disabled={disabled}
                onClick={() => onPick(tag)}
                title={actionTitle?.(tag)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-ash disabled:cursor-wait disabled:opacity-60"
              >
                <span
                  className={clsx(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors',
                    state === 'on' && 'border-pine bg-pine text-white',
                    state === 'partial' && 'border-ember bg-ember-soft text-ember',
                    state === 'off' && 'border-line bg-paper text-transparent'
                  )}
                >
                  {state === 'partial' ? (
                    <Minus className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-body text-xs font-medium text-char">
                      {tag.name}
                    </span>
                    {hint}
                  </span>
                  {tag.description && (
                    <span className="block truncate font-body text-[11px] text-haze">
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
