# PyroAnnotator Frontend - Claude Context

React/TypeScript SPA for annotating wildfire detection sequences against the PyroAnnotator API.

**Before any UI work, read [DESIGN.md](./DESIGN.md)** — the design guidelines
(palette, typography, component recipes). New code uses the fire-lookout
tokens; the legacy `gray-*` / `primary-*` palettes are deprecated.

## Stack
- React 18 + TypeScript, Vite 5
- Tailwind CSS 3, Headless UI, Lucide icons
- React Router v6
- TanStack Query v5 (server state) + Zustand 4 (client state)
- React Hook Form + Zod
- Axios
- Vitest + Testing Library
- ESLint (strict, max-warnings 0) + Prettier

## Project Structure

```
frontend/src/
├── App.tsx                      # Router shell, auth gate, react-query provider
├── main.tsx                     # Entry point
├── components/
│   ├── annotation/              # Sequence annotation pieces (CroppedImageSequence, FullImageSequence, ImageOverlays, SmokeTypeSelector)
│   ├── dashboard/               # PipelineStrip, PhaseCard, HowItWorks
│   ├── detection-annotation/    # Detection-level bbox annotation (canvas, toolbar, shortcuts modal, image card, progress header, submission)
│   ├── detection-sequence/      # AlertFrameGrid, ImageModal, ViewToolbar
│   ├── filters/                 # FalsePositiveFilter, ModelAccuracyFilter, SmokeTypeFilter, TabbedFilters, shared/
│   ├── layout/                  # AppLayout
│   ├── sequence/                # SequencePlayer, SequenceReviewer, MediaControls, PlayerControls, MissedSmokePanel, MissedSmokeInstructionsModal
│   ├── localize/                # LocalizeRail, LocalizeObjectRow, LocalizeMissedSmokeRow
│   ├── sequence-annotation/     # AnnotationHeader, MissedSmokePanel, ObjectStatusStrip, ProcessingStageMessages
│   ├── sequences/               # Table headers/rows + pagination for annotate / review queues, plus SequencesLegend
│   └── ui/                      # NotificationBadge, NotificationSystem, PasswordField, ProgressIndicator
├── hooks/
│   ├── annotation/              # useDrawingCanvas, useKeyboardShortcuts
│   └── *.ts                     # useAnnotationCounts, usePipelineStats, useCameras, useOrganizations, useSourceApis, useSequenceDetections, useDetectionImage, useImagePreloader, usePersistedFilters, usePersistedTabState
├── pages/
│   ├── LoginPage.tsx
│   ├── HomePage.tsx
│   ├── DashboardPage.tsx              # Pipeline dashboard (see docs/specs/2026-07-28-dashboard-taxonomy-redesign-design.md)
│   ├── GuidePage.tsx                  # Field guide (/guide)
│   ├── SequencesPage.tsx              # Annotate queue
│   ├── SequencesPageWrapper.tsx       # Stage-parameterized list (annotated, etc.)
│   ├── AnnotationInterface.tsx        # Annotate one sequence
│   ├── DetectionAnnotatePage.tsx      # Localize queue (alert-grouped)
│   ├── DetectionReviewPage.tsx        # Localize done list (alert-grouped)
│   ├── LocalizeAlertPage.tsx          # Localize one alert (queue + done modes)
│   └── UserManagementPage.tsx
├── services/api.ts              # Axios client (interceptors, JWT)
├── store/
│   ├── useAuthStore.ts          # Token + user (persisted)
│   └── useSequenceStore.ts      # Selection / in-progress sequence state
├── types/
│   ├── api.ts                   # Mirrors backend schemas (Sequence, Detection, *Annotation, enums)
│   └── branded.ts               # Branded ID types
└── utils/
    ├── annotation/              # annotationHandlers, canvasUtils, coordinateUtils, drawingUtils, effectUtils, imageUtils, keyboardUtils, navigationUtils, progressUtils, sequenceUtils, validationUtils, workflowUtils, index
    ├── notification/toastUtils.ts
    ├── api-functional.ts
    ├── constants.ts
    ├── filter-state.ts / filterHelpers.ts
    ├── modelAccuracy.ts
    ├── passwordUtils.ts
    ├── playback-calculations.ts
    └── processingStage.ts
```

## Routes (declared in `App.tsx`)

Path constants and builders live in `src/utils/routes.ts`. Detail pages encode
provenance in the path: `/classify/:id` was entered from the queue,
`/classify/done/:id` from the Done list (same component, `mode="done"`).

| Path                                       | Component                         |
| ------------------------------------------ | --------------------------------- |
| `/login`                                   | `LoginPage`                       |
| `/`                                        | `DashboardPage`                   |
| `/classify`                                | `SequencesPage` (classify queue)  |
| `/classify/done`                           | `SequencesPageWrapper`            |
| `/classify/:id`                            | `ClassifyAlertPage`               |
| `/classify/done/:id`                       | `ClassifyAlertPage` (done mode)   |
| `/classify/groups`                         | `SequenceGroupsListPage`          |
| `/classify/groups/:id`                     | `SequenceGroupAnnotatePage`       |
| `/localize`                                | `DetectionAnnotatePage` (alert-grouped Localize queue) |
| `/localize/done`                           | `DetectionReviewPage` (alert-grouped Done list) |
| `/localize/:sequenceId`                    | `LocalizeAlertPage`               |
| `/localize/done/:sequenceId`               | `LocalizeAlertPage` (done mode)   |
| `/localize/:sequenceId/object/:laneId` | `LocalizeAlertPage` with that object selected (child route; bare `/localize/:sequenceId` auto-redirects here for the first workable object; same under the `/localize/done` prefix) |
| `/localize/:sequenceId/object/:laneId/:detectionId` | `LocalizeAlertPage` + per-frame editor (child route, so the page is not remounted; same under the `/localize/done` prefix) |
| `/users`                                   | `UserManagementPage`              |
| `/guide`                                   | `GuidePage`                       |

Old entity-named routes (`/sequences/*`, `/detections/*`, `/sequence-groups*`)
redirect permanently — see `src/components/routing/legacyRedirects.tsx`.

## Development Commands

```bash
npm run dev               # Vite dev server, port 3000
npm run build             # tsc + vite build
npm run preview           # serve dist/

npm run lint              # ESLint, --max-warnings 0
npm run lint:ci           # ESLint, --max-warnings 100 (CI lenient)
npm run lint:fix
npm run format            # Prettier write
npm run format:check
npm run type-check        # tsc --noEmit
npm run quality           # type-check + lint + format:check
npm run quality:fix       # type-check + lint:fix + format

npm test                  # Vitest run
npm run test:watch
npm run test:coverage
```

Docker:

```bash
docker compose up         # builds and serves at http://localhost:3000
docker compose build --no-cache
```

## API Integration

- Client: `src/services/api.ts` (Axios). Base URL: `VITE_API_BASE_URL` (default `http://localhost:5050`). Request interceptor injects the JWT from `useAuthStore`.
- Types: `src/types/api.ts` mirrors backend schemas. Backend enums (`SmokeType`, `FalsePositiveType`) are the source of truth — no hardcoded label strings in components.
- Error type: `ApiError` for typed catch.

Endpoints used: `/api/v1/sequences`, `/api/v1/detections`, `/api/v1/annotations/sequences`, `/api/v1/annotations/detections`, `/api/v1/auth/login`.

## State Management

- **`useAuthStore`** — JWT token, current user. Persisted to localStorage.
- **`useSequenceStore`** — selection / in-progress sequence state during an annotation session.
- **TanStack Query** — all server reads. Query keys live alongside the hooks that own them. Use `invalidateQueries` after mutations rather than manual cache writes.
- **Local component state** — for transient UI only.

## Conventions

- Path alias `@/*` → `./src/*`.
- TypeScript strict mode; `noUnusedLocals` / `noUnusedParameters` enabled — don't leave unused imports.
- Annotation logic lives in `src/utils/annotation/` and `src/hooks/annotation/`. Prefer extending those modules over inlining canvas/keyboard/coordinate logic into components.
- Notifications: use `src/utils/notification/toastUtils.ts` and the `NotificationSystem` UI — don't roll your own.
- Dates: render every user-facing date through `src/utils/datetime.ts` — `formatDateTime` (`YYYY-MM-DD HH:mm`) or `formatDate` (`YYYY-MM-DD`), both viewer-local. Don't call `toLocaleString` / `toLocaleDateString` on a date; they render differently per browser locale.
- Filter state: persisted via `usePersistedFilters` / `usePersistedTabState`.

## Common Issues

- **TanStack Query v5**: `cacheTime` is `gcTime`; query keys are arrays.
- **Build fails after API change**: regenerate / update `src/types/api.ts`, then `npm run type-check`.
- **Auth bounces to `/login`**: check token persistence in `useAuthStore`; clear localStorage to reset.
- **CORS errors** in dev: backend must allow `http://localhost:3000`.
- **Cache rebuild**: `rm -rf node_modules dist && npm ci && npm run build`. For Docker: `docker compose build --no-cache`.

## Docker

- Multi-stage Dockerfile: Node 18 builder → nginx Alpine runtime.
- `nginx.conf` handles SPA routing (`try_files`), gzip, cache headers, and a `/health` endpoint.
- Container port 80, mapped to host 3000 in compose.

## Environment Variables

| Variable             | Default                  | Description           |
| -------------------- | ------------------------ | --------------------- |
| `VITE_API_BASE_URL`  | `http://localhost:5050`  | Backend API base URL  |
| `VITE_ENVIRONMENT`   | `development`            | Label only            |
