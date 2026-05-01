# PyroAnnotator Frontend

React/TypeScript UI for annotating wildfire detection sequences against the PyroAnnotator API.

## Stack

- React 18 + TypeScript, built with Vite 5
- Tailwind CSS, Headless UI, Lucide icons
- Routing: React Router v6
- Server state: TanStack Query v5
- Client state: Zustand
- Forms: React Hook Form + Zod
- HTTP: Axios
- Tests: Vitest + Testing Library

## Prerequisites

- Node.js 18+ and npm
- A running annotation API (default `http://localhost:5050`) — see `../annotation_api/`

## Quick Start

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```

Optional `frontend/.env.local`:

```
VITE_API_BASE_URL=http://localhost:5050
VITE_ENVIRONMENT=development
```

## Scripts

| Command              | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `npm run dev`        | Vite dev server on port 3000                             |
| `npm run build`      | TypeScript compile + production build                    |
| `npm run preview`    | Serve the production build locally                       |
| `npm run lint`       | ESLint (strict — fails on warnings)                      |
| `npm run lint:fix`   | ESLint auto-fix                                          |
| `npm run format`     | Prettier write                                           |
| `npm run type-check` | `tsc --noEmit`                                           |
| `npm run quality`    | `type-check` + `lint` + `format:check`                   |
| `npm run quality:fix`| `type-check` + `lint:fix` + `format`                     |
| `npm test`           | Vitest run                                               |
| `npm run test:watch` | Vitest watch mode                                        |

## Project Structure

```
frontend/src/
├── components/
│   ├── annotation/             # Sequence annotation UI (Cropped/Full image, overlays, smoke type)
│   ├── detection-annotation/   # Detection-level bbox annotation (canvas, toolbar, shortcuts modal)
│   ├── detection-sequence/     # Detection grid + image modal for a sequence
│   ├── filters/                # Filter UI (smoke type, FP, model accuracy, date range)
│   ├── layout/                 # AppLayout
│   ├── sequence/               # Sequence player and missed-smoke panels
│   ├── sequence-annotation/    # Sequence-level annotation grid + headers
│   ├── sequences/              # Tables, pagination, legend for sequence lists
│   └── ui/                     # Notifications, password field, progress, contributors
├── hooks/                      # Custom hooks (annotation/, plus useCameras, useDetectionImage, etc.)
├── pages/                      # Route components (see below)
├── services/api.ts             # Axios client + request/response interceptors
├── store/                      # Zustand stores: useAuthStore, useSequenceStore
├── types/                      # api.ts (mirror of backend schemas), branded.ts
└── utils/                      # annotation/ utilities, notification/, filter helpers, etc.
```

## Routes

| Path                                                  | Page                              | Purpose                                  |
| ----------------------------------------------------- | --------------------------------- | ---------------------------------------- |
| `/login`                                              | `LoginPage`                       | Auth                                     |
| `/sequences/annotate`                                 | `SequencesPage`                   | Sequences awaiting annotation            |
| `/sequences/review`                                   | `SequencesPageWrapper`            | Already-annotated sequence list          |
| `/sequences/:id/annotate`                             | `AnnotationInterface`             | Annotate a single sequence               |
| `/detections/annotate`                                | `DetectionAnnotatePage`           | Detection-level annotation queue         |
| `/detections/review`                                  | `DetectionReviewPage`             | Review detection annotations             |
| `/detections/:sequenceId/annotate/:detectionId?`      | `DetectionSequenceAnnotatePage`   | Detection annotation for one sequence    |
| `/users`                                              | `UserManagementPage`              | User management                          |

## API Integration

`src/services/api.ts` is an Axios client configured via `VITE_API_BASE_URL`. Backend enums (`SmokeType`, `FalsePositiveType`) live in `src/types/api.ts` and are the source of truth — don't hardcode label strings in components.

Endpoints used: `/api/v1/sequences`, `/api/v1/detections`, `/api/v1/annotations/sequences`, `/api/v1/annotations/detections`. JWT bearer auth; the token is held in `useAuthStore`.

## State Management

- **TanStack Query** for server data (sequences, detections, annotations) — caching + invalidation.
- **Zustand** for cross-page client state: `useAuthStore` (token, user) and `useSequenceStore` (selection, in-progress work).
- **Local React state** for component-scoped UI.

## Docker

Multi-stage build (Node 18 → nginx Alpine). Expose container port 80, mapped to host 3000.

```bash
docker build -t pyro-annotator-frontend .
docker run -p 3000:80 -e VITE_API_BASE_URL=http://your-api-host:5050 pyro-annotator-frontend
```

The repo's top-level `docker-compose.yml` runs the frontend together with the backend stack.

## Environment Variables

| Variable             | Default                  | Description                |
| -------------------- | ------------------------ | -------------------------- |
| `VITE_API_BASE_URL`  | `http://localhost:5050`  | Backend API base URL       |
| `VITE_ENVIRONMENT`   | `development`            | Environment label          |

## Troubleshooting

- **Sequences don't load** — check the backend is up (`curl http://localhost:5050/status`) and CORS allows your origin.
- **Type errors after API change** — update `src/types/api.ts` and `src/services/api.ts`, then `npm run type-check`.
- **Build fails** — `rm -rf node_modules dist && npm ci && npm run build`.
- **Stale auth state** — clear localStorage; `useAuthStore` persists the JWT.
