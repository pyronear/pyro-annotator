import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, Globe, Tag as TagIcon, UserCheck, UserX } from 'lucide-react';
import { Tag, UserFilters } from '@/types/api';

type Tone = 'pine' | 'ember' | 'signal';

const SELECTED: Record<Tone, string> = {
  pine: 'bg-pine-soft text-pine',
  ember: 'bg-ember-soft text-ember',
  signal: 'bg-signal-soft text-signal',
};

interface UserFilterPanelProps {
  filters: UserFilters;
  /** Tags to filter on; empty when the viewer cannot list them. */
  tags: Tag[];
  /** Sets the filter to the value, or clears it when it already holds it. */
  onToggle: (key: keyof UserFilters, value: UserFilters[keyof UserFilters]) => void;
}

/** Filter chips of the user list: account, alert access and tags. */
export default function UserFilterPanel({ filters, tags, onToggle }: UserFilterPanelProps) {
  return (
    <div className="rounded-card border border-line bg-paper p-4">
      <div className="flex flex-wrap gap-2">
        <Chip
          selected={filters.is_active === true}
          tone="pine"
          onClick={() => onToggle('is_active', true)}
        >
          <UserCheck className="w-3 h-3 mr-1" />
          Active Only
        </Chip>
        <Chip
          selected={filters.is_active === false}
          tone="signal"
          onClick={() => onToggle('is_active', false)}
        >
          <UserX className="w-3 h-3 mr-1" />
          Inactive Only
        </Chip>
        <Chip
          selected={filters.role === 'admin'}
          tone="ember"
          onClick={() => onToggle('role', 'admin')}
        >
          Admins Only
        </Chip>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <Chip
          selected={filters.access === 'full'}
          tone="pine"
          onClick={() => onToggle('access', 'full')}
          title="Admins and users with full access"
        >
          <Globe className="w-3 h-3 mr-1" />
          Full access
        </Chip>
        <Chip
          selected={filters.access === 'none'}
          tone="signal"
          onClick={() => onToggle('access', 'none')}
          title="No full access and no tag: these users see no alert"
        >
          <AlertCircle className="w-3 h-3 mr-1" />
          No alerts
        </Chip>
      </div>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="mr-1 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze">
            Tag
          </span>
          {tags.map(tag => (
            <Chip
              key={tag.id}
              selected={filters.tag_id === tag.id}
              tone="ember"
              onClick={() => onToggle('tag_id', tag.id)}
              title={tag.description ?? tag.name}
            >
              <TagIcon className="w-3 h-3 mr-1" />
              {tag.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  selected,
  tone,
  onClick,
  title,
  children,
}: {
  selected: boolean;
  tone: Tone;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={selected}
      className={clsx(
        'inline-flex items-center px-3 py-1 font-body text-xs font-medium rounded-full transition-colors',
        selected ? SELECTED[tone] : 'bg-ash text-haze hover:text-char'
      )}
    >
      {children}
    </button>
  );
}
