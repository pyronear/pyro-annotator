/**
 * The object editor's filmstrip: one cell per frame of the ALERT, grouped
 * into before / object / after runs. Out-of-range cells are desaturated and
 * view-only. On 92.6% of lanes the outer runs are empty and the strip is just
 * the object's own frames, so the run labels only appear when they mean
 * something.
 *
 * Each cell's BORDER carries its state, so the strip reads as a run of
 * colour rather than a line of letters:
 *
 * The frame you are on shows its clock time underneath — the header has the
 * full timestamp, and cells can sit anywhere from two seconds to two minutes
 * apart, so the row alone never says where in the alert you are.
 *
 * The frame you are on grows rather than gaining an outline: colour is fully
 * spent on state here, and a ring would add a second one competing with the
 * hole marker. Size is the channel still free. Cells are square because the
 * thumbnails are square crops of the object.
 *
 *   solid, source colour    a box is committed, from that source
 *   dashed, source colour   that source offers a box, not yet accepted
 *   hatched, signal         no source found anything — a hole in the track
 *   faint, neutral          the object is not on this frame at all
 *
 * Solid-versus-dashed matches the stage, where the committed box is solid and
 * the candidates ghost in dashed. The rail beside it maps each colour to its
 * source by name, so the strip needs no legend of its own.
 */

import type { FilmstripEntry, FilmstripRun } from '@/utils/annotation/objectFilmstrip';
import { formatTime } from '@/utils/datetime';
import { SOURCE_COLOR } from './sourceIdentity';
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

/** What a cell's border says about the frame. */
type CellState = 'committed' | 'available' | 'none' | 'outside';

function cellState(entry: FilmstripEntry): CellState {
  if (!entry.inObject) return 'outside';
  if (entry.committedSource) return 'committed';
  if (entry.availableSource) return 'available';
  return 'none';
}

function borderStyle(entry: FilmstripEntry): React.CSSProperties {
  const state = cellState(entry);
  if (state === 'committed')
    return { borderColor: SOURCE_COLOR[entry.committedSource!], borderStyle: 'solid' };
  if (state === 'available')
    return { borderColor: SOURCE_COLOR[entry.availableSource!], borderStyle: 'dashed' };
  if (state === 'none') return { borderColor: '#B3261E', borderStyle: 'solid' };
  return { borderColor: '#E4E2DC', borderStyle: 'dashed' };
}

/** The strip has no legend, so each cell names its own state on hover. */
function cellLabel(entry: FilmstripEntry): string {
  const state = cellState(entry);
  if (state === 'committed') return `${entry.committedSource} box accepted`;
  if (state === 'available') return `${entry.availableSource} box, not accepted yet`;
  if (state === 'none') return 'No box — no model found smoke here';
  return 'This object was not detected on this frame';
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
            {/* Pinned to the tall cell's height. Without it the row tracks its
                tallest child, so mid-transition — one cell shrinking while
                another grows — the whole strip dips and springs back. */}
            <div className="flex h-[5.25rem] items-end gap-1">
              {group.items.map(entry => (
                <button
                  key={entry.detectionId}
                  type="button"
                  data-testid={`filmstrip-cell-${entry.detectionId}`}
                  data-state={cellState(entry)}
                  data-source={entry.committedSource ?? entry.availableSource ?? ''}
                  aria-current={entry.detectionId === currentDetectionId}
                  aria-label={cellLabel(entry)}
                  title={cellLabel(entry)}
                  onClick={() => onSelect(entry)}
                  className={`flex-none rounded transition-all focus:outline-none focus:ring-2 focus:ring-char ${
                    entry.detectionId === currentDetectionId ? 'w-16' : 'w-12'
                  }`}
                >
                  <span
                    className={`relative block overflow-hidden rounded border-2 transition-all ${
                      entry.detectionId === currentDetectionId ? 'h-16' : 'h-12'
                    } ${entry.inObject ? '' : 'opacity-60 grayscale'}`}
                    style={borderStyle(entry)}
                  >
                    <FilmstripThumbnail detectionId={entry.detectionId} xyxyn={entry.xyxyn} />
                    {cellState(entry) === 'none' && (
                      // A hole in the object's track. Hatching reads as
                      // "nothing here" without spending a glyph on it, and
                      // these are the frames that keep the alert off the
                      // submit gate.
                      <span
                        aria-hidden
                        className="absolute inset-0"
                        style={{
                          background:
                            'repeating-linear-gradient(45deg, rgba(179,38,30,0.55) 0 3px, rgba(179,38,30,0) 3px 7px)',
                        }}
                      />
                    )}
                  </span>
                  {/* Reserved on every cell, filled only on the current one,
                      so stepping never changes the row's height. The header
                      carries the date; two frames can be seconds apart, so
                      this needs the seconds. */}
                  <span className="mt-1 block h-4 text-center font-data text-[10px] text-haze">
                    {entry.detectionId === currentDetectionId ? formatTime(entry.recordedAt) : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
