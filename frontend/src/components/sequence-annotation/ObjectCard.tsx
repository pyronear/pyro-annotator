/**
 * Single object classification card.
 * Extracted out of SequenceAnnotationGrid so it can be reused, one card per
 * lane-track, by ClassifyAlertPage. Card identity is a caller-supplied
 * `cardKey` string (never a raw array index) — all change callbacks are
 * invoked with it so callers can route the update back to the right
 * lane/track regardless of where the card sits in a flattened list.
 */

import React from 'react';
import { Keyboard, CheckCircle, AlertCircle } from 'lucide-react';
import { SequenceBbox, FalsePositiveType, SmokeType } from '@/types/api';
import { FALSE_POSITIVE_TYPES, SMOKE_TYPES } from '@/utils/constants';
import { getSmokeTypeEmoji, formatSmokeType } from '@/utils/modelAccuracy';
import { ObjectOverlay } from '@/utils/annotation/objectColors';
import FullImageSequence from '@/components/annotation/FullImageSequence';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';

export type CardClassification = 'unselected' | 'smoke' | 'false_positive';

export interface ObjectCardProps {
  /** 1-based position in the card's list — rendered as "Object {n}". */
  objectNumber: number;
  /** Stable card identity, e.g. `${laneSequenceId}:${trackIndex}` — echoed back on every callback. */
  cardKey: string;
  bbox: SequenceBbox;
  sequenceId: number;
  classification: CardClassification;
  isActive: boolean;
  isAnnotated: boolean;
  /** False while the caller's annotation data hasn't caught up with sequenceId yet — shows a loading state instead of images. */
  imagesReady?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  onCardClick?: (cardKey: string) => void;
  onBboxChange: (cardKey: string, updatedBbox: SequenceBbox) => void;
  onClassificationChange: (cardKey: string, classification: 'smoke' | 'false_positive') => void;
  /** Per-object unsure checkbox. Omit `onUnsureChange` to hide it entirely (SequenceAnnotationGrid usage). */
  unsure?: boolean;
  onUnsureChange?: (cardKey: string, unsure: boolean) => void;
  /** Read-only mode for locked lanes: disables all inputs and swaps the status badge for `stageBadge`. */
  locked?: boolean;
  stageBadge?: string;
  /** This object's stable identity color (ClassifyAlertPage) — shown as a swatch and used for its own box in the full-frame view. Omit to render the card with no color identity (SequenceAnnotationGrid's single-object usage). */
  color?: string;
  /** Other objects' track boxes, dimmed, for the full-frame view — "which plume is mine" context. */
  siblingOverlays?: ObjectOverlay[];
  /** `bbox.bboxes[i]`'s detection `recorded_at`, aligning `siblingOverlays` to the full-frame view's current frame. */
  frameRecordedAt?: (string | undefined)[];
}

const formatLabel = (type: string) =>
  type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

// Keyboard shortcut for each false positive type.
const getKeyForType = (type: string) => {
  const keyMap: Record<string, string> = {
    antenna: 'A',
    building: 'B',
    cliff: 'C',
    dark: 'D',
    dust: 'J', // 'u' toggles Unsure in the shared keyboard handler
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
  return keyMap[type];
};

export const ObjectCard: React.FC<ObjectCardProps> = ({
  objectNumber,
  cardKey,
  bbox,
  sequenceId,
  classification,
  isActive,
  isAnnotated,
  imagesReady = true,
  cardRef,
  onCardClick,
  onBboxChange,
  onClassificationChange,
  unsure,
  onUnsureChange,
  locked = false,
  stageBadge,
  color,
  siblingOverlays,
  frameRecordedAt,
}) => {
  // Card state communicated two ways at once (never color alone): the
  // corner badge's text, and a hairline frame whose left edge picks up the
  // sanctioned accent for the state — ember for "you're editing this one"
  // (ember = Classify lane identity per DESIGN.md), pine for "done"
  // (pine = positive states), neutral line for "needs a look" (the badge
  // carries that signal instead).
  const frameClasses = locked
    ? 'border border-line bg-paper opacity-60 cursor-default'
    : isActive
      ? 'border border-line border-l-[3px] border-l-ember bg-paper cursor-pointer'
      : isAnnotated
        ? 'border border-line border-l-[3px] border-l-pine bg-paper hover:bg-ash cursor-pointer'
        : 'border border-line bg-paper hover:bg-ash cursor-pointer';

  return (
    <div
      ref={cardRef}
      data-testid={`object-card-${cardKey}`}
      className={`transition-colors px-[22px] py-5 ${frameClasses}`}
      onClick={() => !locked && onCardClick?.(cardKey)}
    >
      {/* Header row: title cluster (left, shrinkable) + status cluster
          (right, never shrinks). The status badge used to be absolutely
          positioned in the card's top-right corner — a leftover from when
          it overlaid a photo — which put it directly on top of this row's
          bbox count once the card became flow content instead of an image.
          Both now live in the same flex row so normal layout (gap +
          shrink-0), not manual offsets, keeps them apart at any badge text
          length or card width. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          {color && (
            <span
              data-testid={`object-color-swatch-${cardKey}`}
              className="inline-block w-3 h-3 rounded-full ring-1 ring-char/10 shrink-0"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
          )}
          <h4 className="font-display text-heading font-semibold text-char truncate">
            Object {objectNumber}
          </h4>
          {isActive && !locked && (
            <span className="inline-flex items-center rounded-full px-2 py-1 font-body text-xs font-medium bg-ember-soft text-ember shrink-0">
              <Keyboard className="w-3 h-3 mr-1" />
              Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-data text-detail text-haze whitespace-nowrap">
            {bbox.bboxes.length} bbox{bbox.bboxes.length !== 1 ? 'es' : ''}
          </span>
          <span
            className={`rounded-full px-2 py-1 font-body text-xs font-semibold whitespace-nowrap ${
              locked
                ? 'bg-ash text-haze'
                : isAnnotated
                  ? 'bg-pine-soft text-pine'
                  : 'bg-ember-soft text-ember'
            }`}
          >
            {locked ? stageBadge : isAnnotated ? 'Reviewed' : 'Pending'}
          </span>
        </div>
      </div>

      {/* Visual Content - Image Sequences */}
      <div className="space-y-6 mb-8">
        {bbox.bboxes && bbox.bboxes.length > 0 && imagesReady ? (
          <>
            {/* Full Image Sequence */}
            <div className="text-center">
              <h5 className="font-body text-sm font-medium text-char mb-3">Full Sequence</h5>
              <FullImageSequence
                bboxes={bbox.bboxes}
                sequenceId={sequenceId}
                color={color}
                siblingOverlays={siblingOverlays}
                frameRecordedAt={frameRecordedAt}
              />
            </div>

            {/* Cropped Image Sequence */}
            <div className="text-center mt-6">
              <h5 className="font-body text-sm font-medium text-char mb-3">Cropped View</h5>
              <CroppedImageSequence bboxes={bbox.bboxes} sequenceId={sequenceId} />
            </div>
          </>
        ) : (
          /* Loading state when annotation data is being fetched */
          <div className="text-center py-8">
            <div className="flex items-center justify-center space-x-2 text-haze">
              <div className="animate-spin w-5 h-5 border-2 border-line border-t-ember rounded-full"></div>
              <span className="font-body text-sm">Loading sequence images...</span>
            </div>
          </div>
        )}
      </div>

      {/* Annotation Controls */}
      <div className="space-y-4">
        {/* Step 1: Primary Classification */}
        <div>
          <label className="block font-body text-sm font-medium text-char mb-3">
            Sequence Classification
          </label>
          <div className="space-y-2">
            {/* Smoke Sequence Option */}
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name={`classification-${cardKey}`}
                checked={classification === 'smoke'}
                disabled={locked}
                onChange={() => {
                  onClassificationChange(cardKey, 'smoke');
                  const updatedBbox = { ...bbox };
                  updatedBbox.is_smoke = true;
                  // Keep existing smoke_type if available, otherwise leave undefined for user to select
                  updatedBbox.false_positive_types = []; // Clear false positive types
                  onBboxChange(cardKey, updatedBbox);
                }}
                className="w-4 h-4 text-pine focus:ring-pine border-line"
              />
              <span className="font-body text-sm text-char">🔥 This is smoke</span>
              {isActive && !locked && (
                <kbd className="px-1 py-0.5 bg-ash text-haze rounded font-data text-xs font-medium">
                  S
                </kbd>
              )}
            </label>

            {/* False Positive Option */}
            <label className="flex items-center space-x-3 cursor-pointer">
              <input
                type="radio"
                name={`classification-${cardKey}`}
                checked={classification === 'false_positive'}
                disabled={locked}
                onChange={() => {
                  onClassificationChange(cardKey, 'false_positive');
                  const updatedBbox = { ...bbox };
                  updatedBbox.is_smoke = false;
                  updatedBbox.smoke_type = undefined; // Clear smoke type
                  // Keep existing false_positive_types for user to modify
                  onBboxChange(cardKey, updatedBbox);
                }}
                className="w-4 h-4 text-char focus:ring-char border-line"
              />
              <span className="font-body text-sm text-char">❌ This is a false positive</span>
              {isActive && !locked && (
                <kbd className="px-1 py-0.5 bg-ash text-haze rounded font-data text-xs font-medium">
                  F
                </kbd>
              )}
            </label>

            {/* Per-object unsure checkbox — only rendered when the caller wired a handler */}
            {onUnsureChange && (
              <label className="flex items-center space-x-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  aria-label="Unsure"
                  checked={!!unsure}
                  disabled={locked}
                  onChange={e => onUnsureChange(cardKey, e.target.checked)}
                  className="w-4 h-4 rounded text-signal focus:ring-signal border-line"
                />
                <span className="font-body text-sm text-char">Unsure</span>
              </label>
            )}
          </div>
        </div>

        {/* Step 2: Smoke Type Selection (shown when smoke is selected) */}
        {classification === 'smoke' && (
          <div>
            <label className="block font-body text-sm font-medium text-char mb-3">Smoke Type</label>
            <div className="space-y-2">
              {SMOKE_TYPES.map(smokeType => (
                <label key={smokeType} className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="radio"
                    name={`smoke-type-${cardKey}`}
                    checked={bbox.smoke_type === smokeType}
                    disabled={locked}
                    onChange={() => {
                      const updatedBbox = { ...bbox };
                      updatedBbox.smoke_type = smokeType as SmokeType;
                      onBboxChange(cardKey, updatedBbox);
                    }}
                    className="w-4 h-4 text-pine focus:ring-pine border-line"
                  />
                  <span className="font-body text-sm text-char">
                    {getSmokeTypeEmoji(smokeType)} {formatSmokeType(smokeType)}
                  </span>
                  {isActive && !locked && smokeType === 'wildfire' && (
                    <kbd className="px-1 py-0.5 bg-ash text-haze rounded font-data text-xs font-medium">
                      1
                    </kbd>
                  )}
                  {isActive && !locked && smokeType === 'industrial' && (
                    <kbd className="px-1 py-0.5 bg-ash text-haze rounded font-data text-xs font-medium">
                      2
                    </kbd>
                  )}
                  {isActive && !locked && smokeType === 'other' && (
                    <kbd className="px-1 py-0.5 bg-ash text-haze rounded font-data text-xs font-medium">
                      3
                    </kbd>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: False Positive Types (shown when false positive is selected) */}
        {classification === 'false_positive' && (
          <div>
            <label className="block font-body text-sm font-medium text-char mb-3">
              False Positive Types (Select all that apply)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-4">
              {FALSE_POSITIVE_TYPES.map(fpType => {
                const isSelected = bbox.false_positive_types.includes(fpType);

                return (
                  <label key={fpType} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={locked}
                      onChange={e => {
                        const updatedBbox = { ...bbox };
                        if (e.target.checked) {
                          // Add the false positive type
                          updatedBbox.false_positive_types = [
                            ...bbox.false_positive_types,
                            fpType as FalsePositiveType,
                          ];
                        } else {
                          // Remove the false positive type
                          updatedBbox.false_positive_types = bbox.false_positive_types.filter(
                            type => type !== fpType
                          );
                        }
                        onBboxChange(cardKey, updatedBbox);
                      }}
                      className="w-3 h-3 text-char focus:ring-char border-line rounded"
                    />
                    <span className="font-body text-xs text-haze">{formatLabel(fpType)}</span>
                    {isActive && !locked && getKeyForType(fpType) && (
                      <kbd className="ml-1 px-1 py-0.5 bg-ash text-haze rounded font-data text-xs font-medium">
                        {getKeyForType(fpType)}
                      </kbd>
                    )}
                  </label>
                );
              })}
            </div>

            {/* Selected types display */}
            {bbox.false_positive_types.length > 0 && (
              <div className="mt-3">
                <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-2">
                  Selected:
                </div>
                <div className="flex flex-wrap gap-1">
                  {bbox.false_positive_types.map(type => (
                    <span
                      key={type}
                      className="inline-flex items-center rounded-full px-2 py-1 font-body text-xs font-medium bg-ash text-char border border-line"
                    >
                      {type
                        .split('_')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ')}
                      {!locked && (
                        <button
                          onClick={() => {
                            const updatedBbox = { ...bbox };
                            updatedBbox.false_positive_types = bbox.false_positive_types.filter(
                              t => t !== type
                            );
                            onBboxChange(cardKey, updatedBbox);
                          }}
                          className="ml-1 text-haze hover:text-signal"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Enhanced Status Bar */}
        <div
          className={`flex items-center justify-between p-3 rounded-lg ${
            isAnnotated ? 'bg-pine-soft' : 'bg-ember-soft'
          }`}
        >
          <div className="flex items-center space-x-2">
            {isAnnotated ? (
              <CheckCircle className="w-4 h-4 text-pine" />
            ) : (
              <AlertCircle className="w-4 h-4 text-ember" />
            )}
            <span
              className={`font-body text-sm font-medium ${isAnnotated ? 'text-pine' : 'text-ember'}`}
            >
              {isAnnotated ? 'Detection Reviewed' : 'Needs Review'}
            </span>
          </div>

          {/* Current Selection Summary */}
          <div className="font-body text-xs text-haze">
            {bbox.is_smoke && bbox.smoke_type && (
              <span className="text-pine font-medium">
                {getSmokeTypeEmoji(bbox.smoke_type)} {formatSmokeType(bbox.smoke_type)}
              </span>
            )}
            {bbox.is_smoke && !bbox.smoke_type && (
              <span className="text-ember font-medium">Smoke (type needed)</span>
            )}
            {!bbox.is_smoke && bbox.false_positive_types.length > 0 && (
              <span className="text-char font-medium">
                False Positive ({bbox.false_positive_types.length})
              </span>
            )}
            {!bbox.is_smoke && bbox.false_positive_types.length === 0 && (
              <span className="text-haze">No classification</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
