# PyroAnnotator Frontend - Claude Context

## Project Overview
The PyroAnnotator Frontend is a React/TypeScript application for wildfire detection annotation. It provides a modern interface for annotating detection sequences with smoke type classifications and false positive identification using data from the PyroAnnotator annotation API backend.

## Technology Stack
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5.x
- **Package Manager**: npm
- **Styling**: Tailwind CSS 3.x
- **State Management**: Zustand 4.x
- **API Client**: TanStack Query v5 (React Query) + Axios
- **Routing**: React Router DOM v6
- **Forms**: React Hook Form + Zod validation
- **Icons**: Lucide React
- **UI Components**: Headless UI + custom components
- **Container**: Docker with Nginx
- **Development**: Hot reload with Vite dev server

## Project Structure
```
frontend/
├── src/
│   ├── components/
│   │   ├── annotation/          # Annotation-specific components
│   │   │   ├── AnnotationInterface.tsx
│   │   │   └── SequenceBboxCard.tsx
│   │   ├── layout/              # Layout components
│   │   │   └── AppLayout.tsx
│   │   ├── media/               # Media display components
│   │   └── ui/                  # Reusable UI components
│   │       └── ProgressIndicator.tsx
│   ├── hooks/                   # Custom React hooks
│   │   ├── useAnnotationStats.ts
│   │   └── useDetectionImage.ts
│   ├── pages/                   # Route components
│   │   ├── AnnotationInterface.tsx
│   │   ├── AnnotationPage.tsx   # Main annotation workflow
│   │   ├── AnnotationsPage.tsx  # List view
│   │   ├── DashboardPage.tsx
│   │   ├── HomePage.tsx
│   │   ├── SequenceDetailPage.tsx
│   │   └── SequencesPage.tsx
│   ├── services/
│   │   └── api.ts               # API client with axios
│   ├── store/                   # Zustand state management
│   │   ├── useAnnotationStore.ts
│   │   └── useSequenceStore.ts
│   ├── types/
│   │   └── api.ts               # TypeScript type definitions
│   ├── utils/
│   │   └── constants.ts         # App constants and enums
│   ├── App.tsx
│   └── main.tsx
├── public/                      # Static assets
├── docker-compose.yml          # Container orchestration
├── Dockerfile                  # Multi-stage build
├── nginx.conf                  # Nginx configuration
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── vite.config.ts
```

## Development Commands
```bash
# Development server
npm run dev                 # Start Vite dev server on port 5173

# Build & Quality
npm run build              # TypeScript compile + Vite build
npm run preview            # Preview production build
npm run lint               # ESLint check
npm run lint:fix           # ESLint auto-fix
npm run format             # Prettier formatting
npm run format:check       # Check formatting
npm run type-check         # TypeScript type checking
npm run quality            # Run all quality checks
npm run quality:fix        # Fix all quality issues

# Docker
docker compose up          # Start production container on port 3000
docker compose up -d       # Detached mode
docker compose down        # Stop and remove containers
docker compose build      # Rebuild image
docker compose build --no-cache  # Force rebuild
```

## API Integration
The frontend integrates with the PyroAnnotator annotation API backend:

### Type Definitions (`src/types/api.ts`)
Based on backend SQLModel schemas with comprehensive typing:
- `Sequence` - Detection sequence metadata
- `SequenceAnnotation` - Human annotations for sequences  
- `Detection` - Individual detection data
- `DetectionAnnotation` - Human annotations for detections
- `SmokeType` - 'wildfire' | 'industrial' | 'other' (from backend enum)
- `FalsePositiveType` - Extensive enum matching backend (antenna, building, cliff, etc.)
- `PaginatedResponse<T>` - Paginated API responses

### API Client (`src/services/api.ts`)
Axios-based client with:
- **Base Configuration**: Configurable base URL via `VITE_API_BASE_URL`
- **Request/Response Interceptors**: Logging and error handling
- **Comprehensive Methods**:
  - Sequences: CRUD operations with filtering/pagination
  - Detections: CRUD with image upload support
  - Sequence Annotations: CRUD with complex filtering
  - Detection Annotations: CRUD operations
- **Error Handling**: Typed `ApiError` responses

### State Management
**Zustand Stores**:
- `useAnnotationStore`: Current annotation work, progress tracking
- `useSequenceStore`: Sequence data, filtering, pagination

**TanStack Query Integration**:
- Caching with query keys from constants
- Optimistic updates for mutations
- Background refetching and error retry

## Key Features & Components

### Annotation Workflow
- **SequenceBboxCard**: Individual bbox annotation
- **AnnotationInterface**: Complete annotation workflow UI
- **Progress Tracking**: Visual progress indicators and statistics

### Data Management  
- **Pagination**: All list views support server-side pagination
- **Filtering**: Advanced filtering by smoke type, false positive type, processing stage
- **Search**: Real-time search across sequences and annotations
- **Caching**: Intelligent caching with TanStack Query

### UI/UX
- **Responsive Design**: Mobile-friendly with Tailwind CSS
- **Dark Mode Ready**: CSS custom properties for theming
- **Accessible**: Semantic HTML and ARIA labels
- **Performance**: Code splitting and lazy loading

## Environment Configuration
```bash
# Development (.env.local)
VITE_API_BASE_URL=http://localhost:5050  # Backend API URL
VITE_ENVIRONMENT=development

# Production (docker-compose.yml)
VITE_API_BASE_URL=http://localhost:5050  # Backend API URL
VITE_ENVIRONMENT=production
```

## Docker Configuration

### Multi-stage Dockerfile
- **Builder Stage**: Node 18 Alpine for building
- **Production Stage**: Nginx Alpine for serving
- **Build Process**: npm ci → npm run build → copy to nginx
- **Security**: Non-root user, minimal attack surface

### Nginx Configuration (`nginx.conf`)
- **SPA Support**: Client-side routing with try_files
- **Compression**: Gzip for static assets
- **Caching**: Appropriate cache headers for different file types
- **Security Headers**: XSS protection, content type sniffing prevention
- **Health Check**: `/health` endpoint for container orchestration

### Docker Compose
- **Port Mapping**: Host 3000 → Container 80
- **Health Checks**: Built-in curl-based health monitoring
- **Restart Policy**: `unless-stopped` for reliability
- **Network**: Uses default bridge network (external network removed)

## Common Issues & Solutions

### TypeScript Configuration
- **Strict Mode**: Full TypeScript strict mode enabled
- **Path Mapping**: `@/*` aliases to `./src/*`
- **Unused Variable Detection**: `noUnusedLocals` and `noUnusedParameters` enabled

### React Query v5 Migration
- **Breaking Change**: `cacheTime` → `gcTime`
- **Query Keys**: Use array format consistently
- **Error Handling**: Proper error type definitions

### Build Issues
```bash
# Clear caches and rebuild
rm -rf node_modules dist
npm ci
npm run build

# Docker cache issues
docker compose down
docker compose build --no-cache
docker compose up
```

### Nginx Configuration
- **gzip_proxied**: Valid values only (removed `must-revalidate`)
- **try_files**: Essential for SPA routing support
- **Cache Headers**: Different strategies for HTML vs assets

## Data Flow Architecture

### API Data Sources
Backend enums are the source of truth:
- `SmokeType` enum from backend models
- `FalsePositiveType` enum from backend models
- No hardcoded label arrays in frontend

### Annotation Workflow
1. **Sequence Selection**: Browse paginated sequence list
2. **Annotation Creation**: Auto-create annotation record if none exists
3. **Bbox Processing**: Iterate through detection bboxes
4. **Classification**: Select smoke type or false positive types
5. **Completion**: Mark annotation as complete

### State Synchronization
- **Optimistic Updates**: Immediate UI updates with server sync
- **Cache Invalidation**: Strategic cache updates after mutations
- **Error Recovery**: Rollback on failed mutations

## Migration Notes

### From Old Sequence Labeler
- **Removed Components**: Old `LabelSelector` component removed
- **Updated Types**: Use backend enum types instead of hardcoded labels
- **API Integration**: Full integration with new annotation API
- **State Management**: Migrated to Zustand from previous state solution

### Recent Fixes (2024)
- **React Query v5**: Updated for latest API changes
- **Type Safety**: Comprehensive TypeScript error resolution
- **Docker Optimization**: Removed external network dependencies
- **Build Pipeline**: Fixed all compilation errors for production builds

## Performance Considerations
- **Code Splitting**: Route-based code splitting with React Router
- **Image Optimization**: Lazy loading for image previews
- **API Efficiency**: Pagination and filtering to reduce data transfer
- **Caching Strategy**: Aggressive caching for static data, fresh data for annotations

## Security
- **Environment Variables**: No secrets in frontend code
- **Content Security Policy**: Basic CSP headers in nginx
- **XSS Protection**: Browser security headers enabled
- **HTTPS Ready**: Production deployment assumes HTTPS termination upstream

## Future Enhancements
- **Real-time Updates**: WebSocket integration for live annotation status
- **Batch Operations**: Bulk annotation processing
- **Export Features**: Annotation data export in various formats
- **Advanced Filtering**: More sophisticated search and filter options
- **Mobile App**: React Native version for field annotations

## Troubleshooting
- **Build Failures**: Check TypeScript configuration and dependency versions
- **Docker Issues**: Verify nginx config syntax and port mappings
- **API Connection**: Confirm backend is running and CORS is configured
- **State Issues**: Clear browser storage and check Zustand devtools