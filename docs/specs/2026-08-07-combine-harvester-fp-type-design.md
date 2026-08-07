# Combine Harvester False Positive Type

**Date**: 2026-08-07
**Status**: Approved

## Goal

Add `combine_harvester` (French: *moissonneuse-batteuse*) as a new false
positive type. Combine harvesters kick up dust plumes during harvest that the
detection model mistakes for smoke; annotators need a dedicated category
instead of filing these under `dust`.

## Background

False positive types are defined once in the backend
(`FalsePositiveType` enum) and mirrored in several frontend maps. Sequence
annotations store the values as strings in a JSONB column
(`sequences_annotations.false_positive_types`) and sequence groups store a
single value in a `Text` column — there is no Postgres enum type, so **no
Alembic migration is required**.

## Changes

All insertions go after `cliff`, keeping the existing quasi-alphabetical
order. Ordering is display/iteration order only; stored data uses the string
values, so repositioning is safe.

### Backend

- `annotation_api/src/app/models.py` — add
  `COMBINE_HARVESTER = "combine_harvester"` to `FalsePositiveType`, with an
  inline comment matching the existing style (harvest dust plumes mistaken
  for smoke). Schemas and CRUD validate against this enum, so no other
  backend change is needed. The data-transfer client
  (`clients/annotation_api.py`) has no mirrored enum.

### Frontend

| File | Change |
|------|--------|
| `src/types/api.ts` | Add `'combine_harvester'` to the `FalsePositiveType` union |
| `src/utils/constants.ts` | Add to `FALSE_POSITIVE_TYPES` array and its docstring |
| `src/utils/annotation/annotationHandlers.ts` | Hotkey `v` → `indexOf('combine_harvester')` |
| `src/utils/annotation/sequenceUtils.ts` | Letter map: `combine_harvester: 'V'` |
| `src/components/classify/ClassificationChips.tsx` | `FP_TYPE_KEYS`: `combine_harvester: 'V'` |
| `src/components/sequence-annotation/ObjectCard.tsx` | Letter map: `combine_harvester: 'V'` |
| `src/utils/modelAccuracy.ts` | `getFalsePositiveEmoji` map: `combine_harvester: 'V'` — a plain letter, **not** an emoji, per user preference; this is what the `FalsePositiveFilter` dropdown renders next to the label |

Hotkey rationale: `c` (cliff) and `h` (high_cloud) are taken; free letters
are `q`, `v`, `z`. `v` = har**v**ester.

Display labels need no change — they are derived from the value
(`combine_harvester` → "Combine harvester" / "Combine Harvester" depending on
formatter).

## Testing

- Extend the existing FP-type assertions in
  `frontend/tests/utils/annotation/sequenceUtils.test.ts` (key letter,
  label formatting) and
  `frontend/tests/components/classify/ClassificationChips.test.tsx`
  with `combine_harvester` cases.
- Type-check enforces union/array consistency (`npm run type-check`).
- Backend: enum addition is declarative; the existing suite covers
  round-tripping annotation payloads. No new backend test.

## Verification

- `npm run quality` (lint + type-check + tests) in `frontend/`
- Backend pre-commit ruff/mypy via `pre-commit run --files` on `models.py`
- Manual: classify page shows a "Combine harvester" chip with the `V` badge;
  pressing `v` toggles it; the false positive filter dropdown lists
  "V Combine Harvester".
