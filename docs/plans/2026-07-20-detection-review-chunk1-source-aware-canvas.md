# Chunk 1 — Source-Aware Detection Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each detection box's provenance (`engine` / `auto_annotation` / `human`) carried through the frontend and visible on the canvas — colored by smoke_type as today, distinguished by origin via a border-style accent, with per-origin show/hide toggles.

**Architecture:** The editable in-memory box is `DrawnRectangle` (`{id, xyxyn, smokeType}`), a separate shape from the API's `DetectionAnnotationBbox`, bridged by field-picking at three sites. We add an optional `source` to both, set it on create (`human`), import (`engine`), and smoke-type edit (flip to `human`), round-trip it through the three bridge sites, and render an origin border-style accent + per-origin visibility toggles.

**Tech Stack:** React 18 + TypeScript (strict), Vite, Tailwind, Vitest + Testing Library. Commands: `npm test`, `npm run type-check`, `npm run build` (run from `frontend/`).

## Global Constraints

- TypeScript strict; `noUnusedLocals`/`noUnusedParameters` on — no unused imports.
- Backend enums are the source of truth; provenance values are exactly `engine` | `auto_annotation` | `human`.
- Border **color** stays keyed to `smoke_type` (unchanged). Origin is shown via border **style** (solid/dashed/dotted) + toggles — never by changing the color.
- Edit-flip rule: the only box edit that exists is changing a box's smoke-type; that flips `source` to `{origin:'human'}`. (No geometry move/resize exists to hook.)
- `source` is **optional** on both box types to avoid breaking existing `DrawnRectangle` literals; missing source is treated as `{origin:'human'}` at render/serialize.
- Run all commands from `frontend/`. Lint gate: `npm run type-check` must pass; `npm test` for unit tests.

---

### Task 1: Frontend provenance types + thread `source` through draw/import/edit utils

**Files:**
- Modify: `frontend/src/types/api.ts` (add types; add `source` to `DetectionAnnotationBbox` ~line 101)
- Modify: `frontend/src/utils/annotation/drawingUtils.ts` (`DrawnRectangle`, `createDrawnRectangle`, `importPredictionsAsRectangles`, `updateRectangleSmokeType`)
- Test: `frontend/tests/utils/annotation/drawingUtils.test.ts`

**Interfaces:**
- Produces: `AnnotationOrigin`, `Predictor`, `AnnotationSource` (in `types/api.ts`); `DrawnRectangle.source?: AnnotationSource`; `createDrawnRectangle` returns `source:{origin:'human'}`; `importPredictionsAsRectangles` returns `source:{origin:'engine'}`; `updateRectangleSmokeType` sets `source:{origin:'human'}`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/utils/annotation/drawingUtils.test.ts` inside the top-level `describe('drawingUtils', …)` block:

```typescript
  describe('source provenance', () => {
    const imageBounds: ImageBounds = { width: 800, height: 600, x: 0, y: 0 };

    it('createDrawnRectangle tags new boxes as human', () => {
      const rect = createDrawnRectangle(
        { startX: 100, startY: 150, currentX: 300, currentY: 350 },
        imageBounds,
        'wildfire'
      );
      expect(rect.source).toEqual({ origin: 'human' });
    });

    it('importPredictionsAsRectangles tags imported boxes as engine', () => {
      const imported = importPredictionsAsRectangles(
        [{ xyxyn: [0.1, 0.2, 0.4, 0.6] }],
        'wildfire'
      );
      expect(imported[0].source).toEqual({ origin: 'engine' });
    });

    it('updateRectangleSmokeType flips source to human', () => {
      const rects: DrawnRectangle[] = [
        {
          id: 'r1',
          xyxyn: [0.1, 0.2, 0.4, 0.6],
          smokeType: 'wildfire',
          source: { origin: 'auto_annotation', predictor: { name: 'm', version: '1' } },
        },
      ];
      const updated = updateRectangleSmokeType(rects, 'r1', 'industrial');
      expect(updated[0].smokeType).toBe('industrial');
      expect(updated[0].source).toEqual({ origin: 'human' });
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- drawingUtils`
Expected: FAIL — the three new assertions fail (`rect.source` is `undefined`).

- [ ] **Step 3: Add the provenance types**

In `frontend/src/types/api.ts`, immediately **before** `export interface DetectionAnnotationBbox {` (~line 101), insert:

```typescript
export type AnnotationOrigin = 'engine' | 'auto_annotation' | 'human';

export interface Predictor {
  name: string;
  version: string;
}

export interface AnnotationSource {
  origin: AnnotationOrigin;
  predictor?: Predictor | null;
}
```

Then add `source` to `DetectionAnnotationBbox`:

```typescript
export interface DetectionAnnotationBbox {
  xyxyn: [number, number, number, number];
  class_name: string;
  // exactly one of smoke_type / false_positive_type is set
  smoke_type?: SmokeType | null;
  false_positive_type?: FalsePositiveType | null;
  source?: AnnotationSource | null;
}
```

- [ ] **Step 4: Add `source` to `DrawnRectangle` and thread it through the utils**

In `frontend/src/utils/annotation/drawingUtils.ts`:

Change the import line at the top:
```typescript
import { SmokeType, AnnotationSource } from '@/types/api';
```

Add `source` to `DrawnRectangle`:
```typescript
export interface DrawnRectangle {
  id: string;
  xyxyn: [number, number, number, number]; // normalized coordinates
  smokeType: SmokeType;
  source?: AnnotationSource;
}
```

In `createDrawnRectangle`, update the returned object (was lines 95-99):
```typescript
  return {
    id: Date.now().toString(),
    xyxyn: [x1, y1, x2, y2],
    smokeType,
    source: { origin: 'human' },
  };
```

In `importPredictionsAsRectangles`, update the pushed object (was lines 267-271):
```typescript
      newRectangles.push({
        id: `imported-${Date.now()}-${index}`,
        xyxyn: pred.xyxyn,
        smokeType,
        source: { origin: 'engine' },
      });
```

In `updateRectangleSmokeType`, flip source on edit (was lines 210-212):
```typescript
  return rectangles.map(rect =>
    rect.id === rectangleId
      ? { ...rect, smokeType: newSmokeType, source: { origin: 'human' } }
      : rect
  );
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- drawingUtils`
Expected: PASS (new `source provenance` block plus all existing drawingUtils tests).

If an existing `updateRectangleSmokeType` (or `createDrawnRectangle`) test fails on a strict whole-object `toEqual` because the returned object now has a `source` key, update that assertion to include `source: { origin: 'human' }` (do **not** weaken it to a partial match). Only touch assertions broken by the added key.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/utils/annotation/drawingUtils.ts \
        frontend/tests/utils/annotation/drawingUtils.test.ts
git commit -m "feat(frontend): carry box source provenance through draw/import/edit"
```

---

### Task 2: Origin border-style util

**Files:**
- Modify: `frontend/src/utils/annotation/drawingUtils.ts`
- Test: `frontend/tests/utils/annotation/drawingUtils.test.ts`

**Interfaces:**
- Produces: `getOriginBorderStyle(origin: AnnotationOrigin): string` → `'border-solid' | 'border-dashed' | 'border-dotted'`.

- [ ] **Step 1: Write the failing test**

Add inside `describe('drawingUtils', …)` in `frontend/tests/utils/annotation/drawingUtils.test.ts`:

```typescript
  describe('getOriginBorderStyle', () => {
    it('maps origins to border styles', () => {
      expect(getOriginBorderStyle('human')).toBe('border-solid');
      expect(getOriginBorderStyle('auto_annotation')).toBe('border-dashed');
      expect(getOriginBorderStyle('engine')).toBe('border-dotted');
    });
  });
```

And add `getOriginBorderStyle` to the import block at the top of the test file (the existing `import { … } from '@/utils/annotation/drawingUtils'`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- drawingUtils`
Expected: FAIL — `getOriginBorderStyle` is not exported.

- [ ] **Step 3: Implement the util**

In `frontend/src/utils/annotation/drawingUtils.ts`, change the import to also bring in `AnnotationOrigin`:
```typescript
import { SmokeType, AnnotationSource, AnnotationOrigin } from '@/types/api';
```

Add, right after the `getSmokeTypeColors` definition (~line 60):
```typescript
const ORIGIN_BORDER_STYLE: Record<AnnotationOrigin, string> = {
  human: 'border-solid',
  auto_annotation: 'border-dashed',
  engine: 'border-dotted',
};

/**
 * Border-style accent for a box's provenance origin. Color stays keyed to
 * smoke_type; origin is distinguished by solid/dashed/dotted.
 */
export const getOriginBorderStyle = (origin: AnnotationOrigin): string =>
  ORIGIN_BORDER_STYLE[origin];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- drawingUtils`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/annotation/drawingUtils.ts \
        frontend/tests/utils/annotation/drawingUtils.test.ts
git commit -m "feat(frontend): add origin border-style accent util"
```

---

### Task 3: Round-trip `source` through the three bridge sites

**Files:**
- Modify: `frontend/src/components/detection-sequence/ImageModal.tsx` (deserialize ~lines 205-211)
- Modify: `frontend/src/pages/DetectionSequenceAnnotatePage.tsx` (serialize ~lines 378-382 and ~401-405)

**Interfaces:**
- Consumes: `DrawnRectangle.source`, `DetectionAnnotationBbox.source` (Task 1).
- Produces: source survives API→modal→save→API round-trips (defaulting missing source to `{origin:'human'}`).

- [ ] **Step 1: Preserve source when deserializing API boxes → DrawnRectangle**

In `frontend/src/components/detection-sequence/ImageModal.tsx`, update the `.map` that builds `existingRects` (was ~lines 207-211):
```typescript
        .map((item, index) => ({
          id: `existing-${index}`,
          xyxyn: item.xyxyn,
          smokeType: item.smoke_type as SmokeType,
          source: item.source ?? { origin: 'human' as const },
        }));
```

- [ ] **Step 2: Preserve source when serializing DrawnRectangle → API boxes**

In `frontend/src/pages/DetectionSequenceAnnotatePage.tsx`, update **both** `drawnRectangles.map` blocks (the update path ~lines 378-382 and the create path ~lines 401-405) to the same shape:
```typescript
        const annotationItems = drawnRectangles.map(rect => ({
          xyxyn: rect.xyxyn,
          class_name: 'smoke',
          smoke_type: rect.smokeType,
          source: rect.source ?? { origin: 'human' as const },
        }));
```

- [ ] **Step 3: Type-check and build**

Run: `npm run type-check && npm run build`
Expected: no errors (the API payload types now include the optional `source`).

- [ ] **Step 4: Verify the round-trip in the running app**

With the stack running on this branch (rebuild the backend so it returns `source`; see "Running locally" below), open a detection with engine-prefilled boxes, save it, reload, and confirm via the API that saved boxes retain their source:

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:5050/api/v1/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin12345"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s "http://localhost:5050/api/v1/annotations/detections/?sequence_id=1" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print([b.get('source') for a in d['items'] for b in a['annotation']['annotation']][:5])"
```
Expected: box source objects print (e.g. `[{'origin': 'engine'}, …]`), and a box whose smoke-type you changed in the UI prints `{'origin': 'human'}`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/detection-sequence/ImageModal.tsx \
        frontend/src/pages/DetectionSequenceAnnotatePage.tsx
git commit -m "feat(frontend): round-trip box source through modal load and save"
```

---

### Task 4: Render the origin border-style accent on editable boxes

**Files:**
- Modify: `frontend/src/components/annotation/ImageOverlays.tsx` (`DrawingOverlay`, box render ~lines 251-259)

**Interfaces:**
- Consumes: `getOriginBorderStyle` (Task 2), `DrawnRectangle.source` (Task 1).

- [ ] **Step 1: Import the util**

In `frontend/src/components/annotation/ImageOverlays.tsx`, add `getOriginBorderStyle` to the existing import that already brings in `getSmokeTypeColors` from `@/utils/annotation` (or `@/utils/annotation/drawingUtils` — match the existing path).

- [ ] **Step 2: Apply the accent to the box className**

In `DrawingOverlay`, update the box `div` className (was line 259). Compute the style near the existing `colors`:
```typescript
        const colors = getSmokeTypeColors(rect.smokeType);
        const originStyle = getOriginBorderStyle(rect.source?.origin ?? 'human');
```
and change the className to include it:
```tsx
            className={`absolute border-2 ${originStyle} ${isSelected ? 'border-yellow-400' : colors.border} pointer-events-auto cursor-pointer`}
```

- [ ] **Step 3: Type-check and build**

Run: `npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 4: Verify in the running app**

Open `http://localhost:3000/detections/1/annotate`. The 17 engine-prefilled boxes should render with a **dotted** border (still colored by smoke_type). Draw a new box → **solid**. Change a box's smoke type → it becomes **solid** (flipped to human).
Capture a screenshot of the detection with a mix of dotted (engine) and solid (human) boxes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/annotation/ImageOverlays.tsx
git commit -m "feat(frontend): show box origin as a border-style accent"
```

---

### Task 5: Per-origin show/hide toggles

**Files:**
- Modify: `frontend/src/components/detection-sequence/ImageModal.tsx` (visibility state; filter rendered rectangles)
- Modify: `frontend/src/components/detection-annotation/AnnotationToolbar.tsx` (three toggle buttons)

**Interfaces:**
- Consumes: `DrawnRectangle.source`, `AnnotationOrigin`.
- Produces: a `hiddenOrigins` set that hides boxes of toggled-off origins from the canvas without mutating the annotation.

- [ ] **Step 1: Add visibility state in ImageModal**

In `frontend/src/components/detection-sequence/ImageModal.tsx`, add near the other `useState` hooks:
```typescript
  const [hiddenOrigins, setHiddenOrigins] = useState<Set<AnnotationOrigin>>(new Set());

  const toggleOrigin = (origin: AnnotationOrigin) =>
    setHiddenOrigins(prev => {
      const next = new Set(prev);
      next.has(origin) ? next.delete(origin) : next.add(origin);
      return next;
    });

  const visibleRectangles = drawnRectangles.filter(
    rect => !hiddenOrigins.has(rect.source?.origin ?? 'human')
  );
```
Add `AnnotationOrigin` to the `@/types/api` import in this file.

- [ ] **Step 2: Render the filtered set**

Find where `drawnRectangles` is passed into the canvas/`DetectionAnnotationCanvas` for **rendering** and pass `visibleRectangles` instead (rendering only — keep `drawnRectangles` as the source of truth for selection, counts, and save). If the canvas takes a single `drawnRectangles` prop used for both, pass `visibleRectangles` to it; selection of a hidden box is not possible while hidden, which is the intended behavior.

- [ ] **Step 3: Add toggle buttons to the toolbar**

In `frontend/src/components/detection-annotation/AnnotationToolbar.tsx`, extend the props:
```typescript
  hiddenOrigins: Set<AnnotationOrigin>;
  onToggleOrigin: (origin: AnnotationOrigin) => void;
```
(add `AnnotationOrigin` to the `@/types/api` import), and render three small buttons before the Reset-Zoom button, mirroring the existing circular button style:
```tsx
        {(['engine', 'auto_annotation', 'human'] as const).map(origin => (
          <button
            key={origin}
            onClick={() => onToggleOrigin(origin)}
            className={`px-2 py-1 rounded-full text-xs backdrop-blur-sm transition-colors ${
              hiddenOrigins.has(origin)
                ? 'bg-white bg-opacity-5 text-gray-500 line-through'
                : 'bg-white bg-opacity-10 hover:bg-opacity-20 text-white'
            }`}
            title={`Toggle ${origin} boxes`}
          >
            {origin === 'engine' ? 'engine' : origin === 'auto_annotation' ? 'auto' : 'human'}
          </button>
        ))}
```
Then pass `hiddenOrigins={hiddenOrigins}` and `onToggleOrigin={toggleOrigin}` where `AnnotationToolbar` is rendered in `ImageModal.tsx`.

- [ ] **Step 4: Type-check and build**

Run: `npm run type-check && npm run build`
Expected: no errors.

- [ ] **Step 5: Verify in the running app**

On `http://localhost:3000/detections/1/annotate`, click the `engine` toggle → the dotted engine boxes disappear; click again → they return. Draw a `human` box and toggle `human` off/on to confirm it hides/shows.
Capture a screenshot showing engine boxes toggled off.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/detection-sequence/ImageModal.tsx \
        frontend/src/components/detection-annotation/AnnotationToolbar.tsx
git commit -m "feat(frontend): per-origin show/hide toggles on the detection canvas"
```

---

## Running locally (for the Task 3-5 app verification)

The backend must return `source` (Chunk 0), so run the stack on this stacked branch:
```bash
cd /mnt/data/ssd_1/earthtoolsmaker/projects/pyronear/pyro-annotator
docker compose up -d --build annotation_api postgres localstack
# frontend dev: cd frontend && npm run dev   (or use the compose frontend on :3000)
```
Seq #1 already carries 17 engine-tagged boxes from the earlier import; if starting from an empty DB, re-import via the platform importer with `--force-url` and advance seq #1 to `annotated`.

## Notes for the implementer

- **Why `source` is optional:** existing `DrawnRectangle` literals (in tests and elsewhere) omit it; making it required would force edits far outside this change. Every render/serialize path falls back to `{origin:'human'}`.
- **Predictor metadata:** `AlgoPredictions` (`types/api.ts`) has no predictor name/version, so imported `engine` boxes carry `{origin:'engine'}` with no predictor — matching the backend, where `engine` has no predictor.
- **Do not change border color logic** — smoke_type coloring is intentional and unit-tested; origin is style + toggles only.
