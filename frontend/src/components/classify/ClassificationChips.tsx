/**
 * Chip-based classification controls for one object row in the classify
 * cockpit (ClassifyAlertPage's decision rail). Same SequenceBbox mutation
 * semantics as the legacy ObjectCard radios; emoji-free by design. Chips
 * are <button>s with radio/checkbox roles so they read (and test) as the
 * exclusive/multi groups they are while staying comfortable mouse targets.
 */

import React from 'react';
import { SequenceBbox, FalsePositiveType, SmokeType } from '@/types/api';
import { FALSE_POSITIVE_TYPES, SMOKE_TYPES } from '@/utils/constants';
import { formatSmokeType } from '@/utils/modelAccuracy';
import { CardClassification } from '@/components/sequence-annotation';
import { formatFalsePositiveLabel } from './status';

export interface ClassificationChipsProps {
  cardKey: string;
  bbox: SequenceBbox;
  classification: CardClassification;
  unsure: boolean;
  showKbdHints?: boolean;
  onBboxChange: (cardKey: string, updatedBbox: SequenceBbox) => void;
  /** 'unselected' is sent when the Unsure chip clears the classification — Smoke / False positive / Unsure are mutually exclusive. */
  onClassificationChange: (
    cardKey: string,
    classification: 'smoke' | 'false_positive' | 'unselected'
  ) => void;
  /** Omit to hide the Unsure chip. */
  onUnsureChange?: (cardKey: string, unsure: boolean) => void;
  /** Whether this unsure lane is currently settled as undecidable. */
  deferred?: boolean;
  /** Omit to hide the "Undecidable for now" chip (queue mode hides it). */
  onDeferredChange?: (cardKey: string, deferred: boolean) => void;
}

// Keyboard letter per FP type — mirrors keyboardUtils' bindings (same map
// as the legacy ObjectCard, which stays untouched for AnnotationInterface).
const FP_TYPE_KEYS: Record<string, string> = {
  antenna: 'A',
  building: 'B',
  cliff: 'C',
  dark: 'D',
  dust: 'J',
  high_cloud: 'H',
  low_cloud: 'L',
  lens_flare: 'G',
  lens_droplet: 'P',
  light: 'I',
  rain: 'R',
  trail: 'T',
  road: 'O',
  sky: 'K',
  tree: 'E',
  water_body: 'W',
  other: 'X',
  unlabeled: 'M',
};

const SMOKE_TYPE_KEYS: Record<string, string> = { wildfire: '1', industrial: '2', other: '3' };

const Kbd: React.FC<{ label: string; onDark?: boolean }> = ({ label, onDark }) => (
  <kbd
    aria-hidden="true"
    className={`px-1 py-0.5 rounded font-data text-[10px] font-medium ${
      onDark ? 'bg-white/20 text-white' : 'bg-ash text-haze'
    }`}
  >
    {label}
  </kbd>
);

const primaryChip = (selected: boolean, selectedClasses: string) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-body text-xs font-medium transition-colors ${
    selected ? selectedClasses : 'border-line bg-paper text-char hover:bg-ash'
  }`;

const typeChip = (selected: boolean, selectedClasses: string) =>
  `inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-body text-xs font-medium transition-colors ${
    selected ? selectedClasses : 'bg-ash text-char hover:bg-ember-soft'
  }`;

export const ClassificationChips: React.FC<ClassificationChipsProps> = ({
  cardKey,
  bbox,
  classification,
  unsure,
  showKbdHints = false,
  onBboxChange,
  onClassificationChange,
  onUnsureChange,
  deferred,
  onDeferredChange,
}) => {
  // Smoke / False positive / Unsure are mutually exclusive: picking either
  // classification clears unsure, and turning unsure on clears the
  // classification (and its bbox labels).
  const markSmoke = () => {
    if (unsure) onUnsureChange?.(cardKey, false);
    onClassificationChange(cardKey, 'smoke');
    onBboxChange(cardKey, { ...bbox, is_smoke: true, false_positive_types: [] });
  };
  const markFalsePositive = () => {
    if (unsure) onUnsureChange?.(cardKey, false);
    onClassificationChange(cardKey, 'false_positive');
    onBboxChange(cardKey, { ...bbox, is_smoke: false, smoke_type: undefined });
  };
  const toggleUnsure = () => {
    const next = !unsure;
    if (next) {
      onClassificationChange(cardKey, 'unselected');
      onBboxChange(cardKey, {
        ...bbox,
        is_smoke: false,
        smoke_type: undefined,
        false_positive_types: [],
      });
    }
    onUnsureChange?.(cardKey, next);
  };

  // Display-level guard for the same rule: a lane seeded with both a saved
  // classification and is_unsure (possible in done mode) renders as Unsure
  // only — never two selected chips at once.
  const smokeSelected = !unsure && classification === 'smoke';
  const fpSelected = !unsure && classification === 'false_positive';
  const setSmokeType = (type: SmokeType) => onBboxChange(cardKey, { ...bbox, smoke_type: type });
  const toggleFpType = (type: FalsePositiveType) => {
    const selected = bbox.false_positive_types.includes(type);
    onBboxChange(cardKey, {
      ...bbox,
      false_positive_types: selected
        ? bbox.false_positive_types.filter(t => t !== type)
        : [...bbox.false_positive_types, type],
    });
  };

  return (
    <div className="space-y-2.5">
      <div role="radiogroup" aria-label="Classification" className="flex flex-wrap gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          role="radio"
          aria-checked={smokeSelected}
          aria-label="Smoke"
          onClick={markSmoke}
          className={primaryChip(smokeSelected, 'border-pine bg-pine text-white')}
        >
          Smoke
          {showKbdHints && <Kbd label="S" onDark={smokeSelected} />}
        </button>
        <button
          type="button"
          tabIndex={-1}
          role="radio"
          aria-checked={fpSelected}
          aria-label="False positive"
          onClick={markFalsePositive}
          className={primaryChip(fpSelected, 'border-char bg-char text-white')}
        >
          False positive
          {showKbdHints && <Kbd label="F" onDark={fpSelected} />}
        </button>
        {onUnsureChange && (
          <button
            type="button"
            tabIndex={-1}
            role="radio"
            aria-checked={unsure}
            aria-label="Unsure"
            onClick={toggleUnsure}
            className={primaryChip(unsure, 'border-signal bg-signal-soft text-signal')}
          >
            Unsure
            {showKbdHints && <Kbd label="U" />}
          </button>
        )}
      </div>

      {/* An unsure lane holds its whole alert out of the localize queue
          (spec: 2026-08-05 unsure lanes gate the localize queue). This
          settles it — still unsure, but no longer blocking — so a wildfire
          sibling can be boxed even when this object can't be decided. */}
      {unsure && onDeferredChange && (
        <div>
          <button
            type="button"
            tabIndex={-1}
            role="checkbox"
            aria-checked={!!deferred}
            aria-label="Undecidable for now"
            data-testid={`undecidable-chip-${cardKey}`}
            onClick={() => onDeferredChange(cardKey, !deferred)}
            className={typeChip(!!deferred, 'bg-signal-soft text-signal')}
          >
            Undecidable for now
          </button>
          <p className="mt-1 font-body text-detail text-haze">
            {deferred
              ? 'Settled — this object no longer holds the alert back from localization.'
              : 'This object is holding its alert out of the localize queue.'}
          </p>
        </div>
      )}

      {smokeSelected && (
        <div>
          <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-1.5">
            Smoke type
          </div>
          <div role="radiogroup" aria-label="Smoke type" className="flex flex-wrap gap-1.5">
            {SMOKE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                tabIndex={-1}
                role="radio"
                aria-checked={bbox.smoke_type === type}
                aria-label={formatSmokeType(type)}
                onClick={() => setSmokeType(type as SmokeType)}
                className={typeChip(bbox.smoke_type === type, 'bg-pine-soft text-pine')}
              >
                {formatSmokeType(type)}
                {showKbdHints && <Kbd label={SMOKE_TYPE_KEYS[type]} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {fpSelected && (
        <div>
          <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-1.5">
            FP types — select all that apply
          </div>
          <div role="group" aria-label="False positive types" className="flex flex-wrap gap-1.5">
            {FALSE_POSITIVE_TYPES.map(type => {
              const selected = bbox.false_positive_types.includes(type as FalsePositiveType);
              return (
                <button
                  key={type}
                  type="button"
                  tabIndex={-1}
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={formatFalsePositiveLabel(type)}
                  onClick={() => toggleFpType(type as FalsePositiveType)}
                  className={typeChip(selected, 'bg-char text-white')}
                >
                  {formatFalsePositiveLabel(type)}
                  {showKbdHints && FP_TYPE_KEYS[type] && (
                    <Kbd label={FP_TYPE_KEYS[type]} onDark={selected} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
