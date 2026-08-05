/**
 * The object editor's filmstrip: one cell per frame of the ALERT, grouped
 * into before / object / after runs. Out-of-range cells are desaturated and
 * view-only. On 92.6% of lanes the outer runs are empty and the strip is just
 * the object's own frames, so the run labels only appear when they mean
 * something.
 */

import type { FilmstripEntry, FilmstripRun } from '@/utils/annotation/objectFilmstrip';
import { SOURCE_COLOR, SOURCE_LETTER } from './sourceIdentity';
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

  if (!entry.inObject)
    return (
      <span data-testid={testId} className="block text-center text-[9px] text-white/25">
        ·
      </span>
    );

  if (entry.committedSource)
    return (
      <span
        data-testid={testId}
        className="block text-center text-[9px] font-bold"
        style={{ color: SOURCE_COLOR[entry.committedSource] }}
      >
        {SOURCE_LETTER[entry.committedSource]}
      </span>
    );

  if (entry.availableSource)
    return (
      <span
        data-testid={testId}
        className="block text-center text-[9px] opacity-50"
        style={{ color: SOURCE_COLOR[entry.availableSource] }}
      >
        {SOURCE_LETTER[entry.availableSource].toLowerCase()}
      </span>
    );

  return (
    <span data-testid={testId} className="block text-center text-[9px] font-bold text-[#d98b7d]">
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
    <div className="border-t border-white/10 px-3 pb-3 pt-2 text-white">
      <p
        data-testid="filmstrip-summary"
        className="mb-1.5 text-[9px] uppercase tracking-[0.1em] text-white/50"
      >
        Frames · object present on {inObjectCount} of {entries.length}
      </p>
      <div className="flex items-end gap-3 overflow-x-auto">
        {groups.map((group, groupIndex) => (
          <div key={`${group.run}-${groupIndex}`}>
            {showRunLabels && (
              <p
                className={`mb-0.5 text-[8.5px] uppercase tracking-wider ${
                  group.run === 'object' ? 'text-[#5bbf8f]' : 'text-white/30'
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
                  className="w-10 flex-none focus:outline-none focus:ring-1 focus:ring-white/60"
                >
                  <span
                    className={`block h-8 overflow-hidden rounded border ${
                      entry.detectionId === currentDetectionId
                        ? 'border-white'
                        : 'border-transparent'
                    } ${entry.inObject ? '' : 'opacity-55 grayscale'}`}
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
