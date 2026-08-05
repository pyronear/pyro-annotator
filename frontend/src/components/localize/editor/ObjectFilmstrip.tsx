/**
 * The object editor's filmstrip: one cell per frame of the ALERT, grouped
 * into before / object / after runs. Out-of-range cells are desaturated and
 * view-only. On 92.6% of lanes the outer runs are empty and the strip is just
 * the object's own frames, so the run labels only appear when they mean
 * something.
 */

import type { FilmstripEntry, FilmstripRun } from '@/utils/annotation/objectFilmstrip';
import { SOURCE_LETTER, SOURCE_TEXT } from './sourceIdentity';
import { FilmstripThumbnail } from './FilmstripThumbnail';

const RUN_LABEL: Record<FilmstripRun, string> = {
  before: 'before object',
  object: 'object',
  after: 'after',
};

export interface ObjectFilmstripProps {
  entries: FilmstripEntry[];
  currentDetectionId: number;
  onSelect: (entry: FilmstripEntry) => void;
}

function Badge({ entry }: { entry: FilmstripEntry }) {
  const testId = `filmstrip-badge-${entry.detectionId}`;

  const base = 'mt-1 block text-center font-data text-[10px]';

  if (!entry.inObject)
    return (
      <span data-testid={testId} className={`${base} text-line`}>
        ·
      </span>
    );

  if (entry.committedSource)
    return (
      <span
        data-testid={testId}
        className={`${base} font-semibold ${SOURCE_TEXT[entry.committedSource]}`}
      >
        {SOURCE_LETTER[entry.committedSource]}
      </span>
    );

  if (entry.availableSource)
    return (
      <span
        data-testid={testId}
        className={`${base} opacity-45 ${SOURCE_TEXT[entry.availableSource]}`}
      >
        {SOURCE_LETTER[entry.availableSource].toLowerCase()}
      </span>
    );

  return (
    <span data-testid={testId} className={`${base} font-semibold text-signal`}>
      —
    </span>
  );
}

/** Consecutive entries sharing a run, so each run renders under one label. */
function groupRuns(entries: FilmstripEntry[]): { run: FilmstripRun; items: FilmstripEntry[] }[] {
  const groups: { run: FilmstripRun; items: FilmstripEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.run === entry.run) last.items.push(entry);
    else groups.push({ run: entry.run, items: [entry] });
  }
  return groups;
}

export function ObjectFilmstrip({ entries, currentDetectionId, onSelect }: ObjectFilmstripProps) {
  const groups = groupRuns(entries);
  const inObjectCount = entries.filter(e => e.inObject).length;
  // With one run there is nothing to distinguish, and a lone "object" label
  // is noise — 92.6% of lanes land here.
  const showRunLabels = groups.length > 1;

  return (
    <div className="border-t border-line bg-paper px-4 pb-3 pt-2.5">
      <p
        data-testid="filmstrip-summary"
        className="mb-2 font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze"
      >
        Frames · object present on {inObjectCount} of {entries.length}
      </p>
      <div className="flex items-end gap-3 overflow-x-auto">
        {groups.map((group, groupIndex) => (
          <div key={`${group.run}-${groupIndex}`}>
            {showRunLabels && (
              <p
                className={`mb-1 font-data text-[9px] uppercase tracking-eyebrow ${
                  group.run === 'object' ? 'text-pine' : 'text-haze/60'
                }`}
              >
                {RUN_LABEL[group.run]}
              </p>
            )}
            <div className="flex gap-1">
              {group.items.map(entry => (
                <button
                  key={entry.detectionId}
                  type="button"
                  data-testid={`filmstrip-cell-${entry.detectionId}`}
                  aria-current={entry.detectionId === currentDetectionId}
                  onClick={() => onSelect(entry)}
                  className="w-11 flex-none rounded focus:outline-none focus:ring-2 focus:ring-char"
                >
                  <span
                    className={`block h-9 overflow-hidden rounded border-2 ${
                      entry.detectionId === currentDetectionId ? 'border-char' : 'border-line'
                    } ${entry.inObject ? '' : 'opacity-60 grayscale'}`}
                  >
                    <FilmstripThumbnail detectionId={entry.detectionId} xyxyn={entry.xyxyn} />
                  </span>
                  <Badge entry={entry} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
