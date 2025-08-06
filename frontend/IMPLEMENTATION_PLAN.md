# React Frontend Implementation Plan for PyroAnnotator

## Project Overview

This React frontend will replace the existing Streamlit sequence_labeler application, providing a modern, scalable interface for wildfire sequence annotation with full integration to the existing FastAPI backend.

## Project Structure
```
frontend/
├── public/                   # Static assets
│   ├── index.html
│   └── favicon.ico
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── ui/              # Basic UI components (Button, Input, etc.)
│   │   ├── layout/          # Layout components (Header, Sidebar, etc.)
│   │   ├── sequence/        # Sequence-related components
│   │   ├── annotation/      # Annotation-related components
│   │   └── media/           # Media components (GifViewer, etc.)
│   ├── pages/               # Main application pages
│   │   ├── SequencesPage.tsx
│   │   ├── AnnotationPage.tsx
│   │   └── HomePage.tsx
│   ├── hooks/               # Custom React hooks
│   │   ├── useSequences.ts
│   │   ├── useAnnotations.ts
│   │   └── useApi.ts
│   ├── services/            # API client services
│   │   ├── api.ts           # Main API client
│   │   ├── sequences.ts     # Sequence endpoints
│   │   └── annotations.ts   # Annotation endpoints
│   ├── types/               # TypeScript type definitions
│   │   ├── api.ts           # API response types
│   │   ├── sequence.ts      # Sequence types
│   │   └── annotation.ts    # Annotation types
│   ├── utils/               # Utility functions
│   │   ├── constants.ts     # App constants
│   │   ├── helpers.ts       # Helper functions
│   │   └── validation.ts    # Validation schemas
│   ├── store/               # State management
│   │   ├── useSequenceStore.ts
│   │   └── useAnnotationStore.ts
│   ├── App.tsx              # Main application component
│   ├── main.tsx             # Application entry point
│   └── index.css            # Global styles
├── Dockerfile               # Production Docker build
├── docker-compose.yml       # Container orchestration
├── package.json             # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build configuration
├── tailwind.config.js      # Tailwind CSS configuration
└── nginx.conf              # Nginx configuration for production
```

## Technology Stack

### Core Framework
- **React 18** with TypeScript for type safety and modern features
- **Vite** for fast development server and optimized builds
- **React Router** for client-side routing

### Styling & UI
- **Tailwind CSS** for utility-first styling
- **Lucide React** for consistent iconography
- **Headless UI** for accessible UI components

### State Management & Data Fetching
- **Zustand** for lightweight, flexible state management
- **React Query (TanStack Query)** for server state management and caching
- **React Hook Form** for efficient form handling

### API Integration
- **Axios** for HTTP requests with interceptors
- **OpenAPI TypeScript** for type-safe API client generation

## Core Features

### 1. Sequence Management
- **Sequence Browser**: Paginated grid/list view of sequences
- **Advanced Filtering**: Filter by source_api, camera_id, organization_id, annotation status
- **Search Functionality**: Text-based search across sequence metadata
- **Sorting Options**: Sort by date, location, annotation status
- **Progress Tracking**: Visual indicators for annotation completion

### 2. Annotation Interface
- **GIF Viewer**: Optimized display of sequence GIFs with playback controls
- **Label Selection**: Multi-select interface for the 7 categories:
  - Smoke
  - Industrial_smoke  
  - Sun flare
  - Cloud
  - Building
  - Antenna
  - Other
- **Batch Operations**: Annotate multiple sequences at once
- **Missed Detection Flag**: Option to mark sequences with undetected smoke
- **Auto-save**: Automatic saving of annotation progress

### 3. Detection Annotation (Future Phase)
- **Bounding Box Editor**: Interactive bbox drawing and editing
- **Frame-by-frame Review**: Individual detection annotation
- **Detection Validation**: Tools for validating AI predictions

## API Integration

### Backend Endpoints Used
```typescript
// Sequences
GET /api/v1/sequences - List sequences with filtering
GET /api/v1/sequences/{id} - Get sequence details
POST /api/v1/sequences - Create new sequence
DELETE /api/v1/sequences/{id} - Delete sequence

// Sequence Annotations  
GET /api/v1/annotations/sequences - List annotations
POST /api/v1/annotations/sequences - Create annotation
PATCH /api/v1/annotations/sequences/{id} - Update annotation
DELETE /api/v1/annotations/sequences/{id} - Delete annotation
POST /api/v1/annotations/sequences/{id}/generate-gifs - Generate GIFs
GET /api/v1/annotations/sequences/{id}/gifs/urls - Get GIF URLs

// Detection Annotations (Future)
GET /api/v1/annotations/detections - List detection annotations
POST /api/v1/annotations/detections - Create detection annotation
PATCH /api/v1/annotations/detections/{id} - Update detection annotation
```

### Type Safety
Generate TypeScript types from the OpenAPI schema:
```bash
npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts
```

## Component Architecture

### Core Layout Components
```typescript
// AppLayout: Main application shell
interface AppLayoutProps {
  children: React.ReactNode;
}

// Header: Top navigation and breadcrumbs  
interface HeaderProps {
  title: string;
  breadcrumbs?: Breadcrumb[];
}

// Sidebar: Navigation menu
interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}
```

### Sequence Components
```typescript
// SequenceList: Paginated sequence browser
interface SequenceListProps {
  filters: SequenceFilters;
  onSequenceSelect: (sequence: Sequence) => void;
}

// SequenceCard: Individual sequence preview
interface SequenceCardProps {
  sequence: Sequence;
  onClick: () => void;
  showProgress?: boolean;
}

// SequenceFilter: Advanced filtering interface  
interface SequenceFilterProps {
  filters: SequenceFilters;
  onFiltersChange: (filters: SequenceFilters) => void;
}
```

### Annotation Components
```typescript
// AnnotationForm: Complete annotation interface
interface AnnotationFormProps {
  sequence: Sequence;
  onSubmit: (annotation: SequenceAnnotation) => void;
  onSkip: () => void;
}

// LabelSelector: Multi-select label interface
interface LabelSelectorProps {
  labels: string[];
  selectedLabels: string[];
  onChange: (labels: string[]) => void;
}

// GifViewer: Optimized GIF display
interface GifViewerProps {
  gifUrl: string;
  cropUrl?: string;
  onLoad?: () => void;
}
```

## State Management Strategy

### Zustand Stores
```typescript
// Sequence Store
interface SequenceStore {
  sequences: Sequence[];
  filters: SequenceFilters;
  pagination: Pagination;
  loading: boolean;
  setFilters: (filters: SequenceFilters) => void;
  loadSequences: () => Promise<void>;
}

// Annotation Store  
interface AnnotationStore {
  currentSequence: Sequence | null;
  annotations: Map<string, SequenceAnnotation>;
  progress: AnnotationProgress;
  setCurrentSequence: (sequence: Sequence) => void;
  saveAnnotation: (annotation: SequenceAnnotation) => Promise<void>;
}
```

## Docker Strategy

### Multi-stage Dockerfile
```dockerfile
# Build stage
FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine as production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Environment Configuration
```env
# Development
VITE_API_BASE_URL=http://localhost:8000
VITE_ENVIRONMENT=development

# Production
VITE_API_BASE_URL=http://backend:8000
VITE_ENVIRONMENT=production
```

### Docker Compose Integration
```yaml
version: '3.8'
services:
  frontend:
    build: 
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    environment:
      - VITE_API_BASE_URL=http://backend:8000
    depends_on:
      - backend
    networks:
      - app-network
```

## Migration from Streamlit

### Feature Mapping
| Streamlit Feature | React Implementation |
|-------------------|---------------------|
| Sequential review | SequenceList with pagination |
| GIF display | GifViewer component |
| Label selection | LabelSelector with 7 categories |
| Progress tracking | ProgressIndicator component |
| JSON persistence | API integration with backend |
| Missed detection flag | Checkbox in AnnotationForm |

### Data Flow Improvements
- **Real-time updates**: Replace file-based persistence with API calls
- **Optimistic updates**: Immediate UI feedback while API calls process
- **Caching**: Intelligent caching of sequences and annotations
- **Batch operations**: Efficient bulk annotation capabilities

## Development Workflow

### Phase 1: Foundation (Week 1)
1. Project setup with Vite + React + TypeScript
2. Basic routing and layout structure
3. API client setup and type generation
4. Core UI components (Button, Input, Modal, etc.)

### Phase 2: Sequence Management (Week 2)  
1. Sequence browser with pagination
2. Filtering and search functionality
3. Sequence detail views
4. Progress tracking components

### Phase 3: Annotation Interface (Week 3)
1. GIF viewer component
2. Annotation form with label selection
3. Batch annotation capabilities
4. Auto-save functionality

### Phase 4: Production Ready (Week 4)
1. Docker configuration and optimization
2. Error handling and user feedback
3. Performance optimizations
4. Testing and documentation

## Testing Strategy

### Unit Testing
- **Jest + React Testing Library** for component testing
- **MSW (Mock Service Worker)** for API mocking
- **Testing utilities** for common test patterns

### Integration Testing
- **Cypress** for end-to-end testing
- **API integration tests** with real backend
- **Docker compose testing** environment

## Performance Considerations

### Optimization Techniques
- **Code splitting** by route and feature
- **Lazy loading** of non-critical components
- **Image optimization** for GIFs and thumbnails
- **Virtual scrolling** for large sequence lists
- **Query optimization** with React Query caching

### Bundle Size Management
- **Tree shaking** to eliminate unused code
- **Dynamic imports** for heavy dependencies
- **Bundle analysis** with webpack-bundle-analyzer
- **Compression** with gzip/brotli in production

## Security Considerations

### Frontend Security
- **Input validation** on all user inputs
- **XSS prevention** with proper escaping
- **CSRF protection** for API requests
- **Content Security Policy** headers
- **Environment variable security** (no secrets in frontend)

## Monitoring & Analytics

### Error Tracking
- **Error boundaries** for graceful error handling
- **Console error monitoring** in production
- **User feedback collection** for improvement

### Performance Monitoring
- **Core Web Vitals** tracking
- **API response time** monitoring
- **User interaction** analytics

## Future Enhancements

### Advanced Features
- **Real-time collaboration** with WebSocket support
- **Keyboard shortcuts** for power users
- **Dark mode** theme support
- **Accessibility improvements** (ARIA labels, keyboard navigation)
- **Mobile responsiveness** for tablet annotation
- **Advanced filtering** with saved filter presets
- **Annotation history** and version control
- **Export functionality** for annotations
- **Integration with SAM-based bbox tool**

### Detection Annotation Phase
- **Bounding box drawing** with canvas or SVG
- **Frame-by-frame navigation**
- **AI-assisted annotation** suggestions
- **Annotation validation** workflows
- **Quality control** features

This comprehensive plan provides a solid foundation for building a modern, scalable React frontend that improves upon the existing Streamlit application while providing extensibility for future features.