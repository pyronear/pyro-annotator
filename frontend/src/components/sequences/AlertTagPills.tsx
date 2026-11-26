import { clsx } from 'clsx';
import { PrototypeTag } from '@/services/tagsPrototype';

/** Pill text: names longer than this are cut and end with "...". */
const TAG_PILL_MAX_CHARS = 5;

function shortTagName(name: string): string {
  return name.length > TAG_PILL_MAX_CHARS ? `${name.slice(0, TAG_PILL_MAX_CHARS)}...` : name;
}

interface AlertTagPillsProps {
  tags: PrototypeTag[];
  /** 'below' where the pills sit at the top of the screen (the alert page bar). */
  tooltip?: 'above' | 'below';
  /** Rendered when the alert has no tag; table cells show a dash. */
  empty?: React.ReactNode;
}

/**
 * The tags an alert carries, one neutral pill each (same colour whatever the
 * tag). Long names are cut; hovering a pill shows the full name.
 */
export function AlertTagPills({
  tags,
  tooltip = 'above',
  empty = <span className="font-body text-detail text-haze">—</span>,
}: AlertTagPillsProps) {
  if (!tags.length) return <>{empty}</>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(tag => (
        <span
          key={tag.id}
          aria-label={tag.name}
          className="group relative inline-flex cursor-help rounded-full bg-ash px-2 py-0.5 font-data text-[11px] font-medium text-char"
        >
          {shortTagName(tag.name)}
          <span
            role="tooltip"
            className={clsx(
              'pointer-events-none absolute left-0 z-10 hidden w-max max-w-[16rem] whitespace-normal rounded bg-char px-2 py-1 font-data text-xs font-normal text-white group-hover:block',
              tooltip === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
            )}
          >
            {tag.name}
          </span>
        </span>
      ))}
    </div>
  );
}
