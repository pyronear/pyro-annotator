/**
 * One object's row in the classify cockpit's decision rail. Collapsed rows
 * are a one-line summary (color dot + name + status chip); the active,
 * unlocked row expands to the classification chips. Locked rows stay
 * activatable (click shows their media in the panel) but never render
 * chips — the page's mutation handlers guard `card.locked` independently.
 * Keeps the legacy `object-card-${cardKey}` testid so the page test suite
 * tracks rows the same way it tracked cards.
 */

import React from 'react';
import { SequenceBbox } from '@/types/api';
import { formatSmokeType } from '@/utils/modelAccuracy';
import { CardClassification } from '@/components/sequence-annotation';
import { ClassificationChips, formatFalsePositiveLabel } from './ClassificationChips';

export interface ObjectRowStatus {
  label: string;
  tone: 'pending' | 'positive' | 'neutral' | 'unsure';
}

export function getObjectRowStatus(args: {
  bbox: SequenceBbox;
  classification: CardClassification;
  unsure: boolean;
  locked: boolean;
  stageBadge?: string;
}): ObjectRowStatus {
  const { bbox, classification, unsure, locked, stageBadge } = args;
  if (locked) return { label: stageBadge ?? 'Locked', tone: 'neutral' };
  if (unsure) return { label: 'Unsure', tone: 'unsure' };
  if (classification === 'smoke' && bbox.smoke_type !== undefined) {
    return { label: `Smoke · ${formatSmokeType(bbox.smoke_type)}`, tone: 'positive' };
  }
  if (classification === 'smoke') return { label: 'Type needed', tone: 'pending' };
  if (bbox.false_positive_types.length > 0) {
    const extra = bbox.false_positive_types.length - 1;
    const first = formatFalsePositiveLabel(bbox.false_positive_types[0]);
    return { label: `FP · ${first}${extra > 0 ? ` +${extra}` : ''}`, tone: 'neutral' };
  }
  return { label: 'Pending', tone: 'pending' };
}

const TONE_CLASSES: Record<ObjectRowStatus['tone'], string> = {
  pending: 'bg-ember-soft text-ember',
  positive: 'bg-pine-soft text-pine',
  neutral: 'bg-ash text-haze',
  unsure: 'bg-signal-soft text-signal',
};

export interface ObjectRowProps {
  objectNumber: number;
  cardKey: string;
  color?: string;
  bbox: SequenceBbox;
  classification: CardClassification;
  unsure: boolean;
  isActive: boolean;
  locked: boolean;
  stageBadge?: string;
  changed?: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
  onRowClick?: (cardKey: string) => void;
  onBboxChange: (cardKey: string, updatedBbox: SequenceBbox) => void;
  onClassificationChange: (cardKey: string, classification: 'smoke' | 'false_positive') => void;
  onUnsureChange?: (cardKey: string, unsure: boolean) => void;
}

export const ObjectRow: React.FC<ObjectRowProps> = ({
  objectNumber,
  cardKey,
  color,
  bbox,
  classification,
  unsure,
  isActive,
  locked,
  stageBadge,
  changed = false,
  rowRef,
  onRowClick,
  onBboxChange,
  onClassificationChange,
  onUnsureChange,
}) => {
  const status = getObjectRowStatus({ bbox, classification, unsure, locked, stageBadge });
  const expanded = isActive && !locked;

  const frame = locked
    ? 'border border-line bg-paper opacity-60 cursor-pointer'
    : isActive
      ? 'border border-line border-l-[3px] border-l-ember bg-paper cursor-pointer'
      : 'border border-line bg-paper hover:bg-ash cursor-pointer';

  return (
    <div
      ref={rowRef}
      data-testid={`object-card-${cardKey}`}
      className={`rounded-lg px-3.5 py-2.5 transition-colors ${frame}`}
      onClick={() => onRowClick?.(cardKey)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          {color && (
            <span
              data-testid={`object-color-swatch-${cardKey}`}
              className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-char/10 shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
          )}
          <span className="font-body text-sm font-semibold text-char truncate">
            Object {objectNumber}
          </span>
          {changed && (
            <span
              data-testid={`object-row-changed-${cardKey}`}
              title="Changed since load"
              className="inline-block w-1.5 h-1.5 rounded-full bg-ember shrink-0"
            />
          )}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {!locked && stageBadge && (
            <span className="rounded-full px-2 py-0.5 font-body text-xs font-semibold bg-ash text-haze whitespace-nowrap">
              {stageBadge}
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 font-body text-xs font-semibold whitespace-nowrap ${TONE_CLASSES[status.tone]}`}
          >
            {status.label}
          </span>
        </span>
      </div>

      {expanded && (
        <div className="mt-2.5">
          <ClassificationChips
            cardKey={cardKey}
            bbox={bbox}
            classification={classification}
            unsure={unsure}
            showKbdHints
            onBboxChange={onBboxChange}
            onClassificationChange={onClassificationChange}
            onUnsureChange={onUnsureChange}
          />
        </div>
      )}
    </div>
  );
};
