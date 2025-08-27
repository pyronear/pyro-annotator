# PyroAnnotator Frontend

A modern React application for wildfire detection annotation, replacing the legacy Streamlit interface with a professional, scalable solution.

## Features

- 🔥 **Modern UI**: Built with React 18, TypeScript, and Tailwind CSS
- 📊 **Real-time Data**: Integration with PyroAnnotator API backend  
- 🎯 **Advanced Filtering**: Filter sequences by source, camera, organization, and wildfire alerts
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices
- 🚀 **Performance**: Optimized with React Query for caching and Zustand for state management
- 🎨 **Interactive Image Viewer**: Side-by-side image comparison with controls
- 📋 **Smart Annotation**: Intuitive interface matching API data models
- 🐳 **Docker Ready**: Containerized for easy deployment

## Technology Stack

### Core Framework
- **React 18** with TypeScript for type safety and modern concurrent features
- **Vite 5.x** for fast development server and optimized production builds
- **React Router DOM v6** for declarative client-side routing

### Styling & UI
- **Tailwind CSS 3.x** for utility-first styling and responsive design
- **Lucide React** for consistent iconography and modern icon set
- **Headless UI** for accessible components and focus management

### State Management & Data
- **Zustand 4.x** for lightweight, performant state management
- **TanStack Query v5 (React Query)** for server state, caching, and background refetching
- **React Hook Form** with Zod validation for type-safe form handling
- **Axios** for HTTP client with request/response interceptors

### Architecture & Code Quality
- **13 Specialized Annotation Utilities**: Modular utility layer for maintainability
- **Comprehensive JSDoc Documentation**: Full coverage across all utilities and functions
- **TypeScript Strict Mode**: Enhanced type safety with strict compiler options
- **ESLint + Prettier**: Code formatting and quality enforcement
- **Functional Programming Patterns**: Pure functions and immutable state updates

### API Integration & Types
- **Type-safe API Client**: Custom Axios client with comprehensive error handling
- **Backend Enum Synchronization**: Frontend constants matching backend SQLModel enums
- **Query Key Management**: Structured cache invalidation with centralized query keys
- **Optimistic Updates**: UI-first interactions with server synchronization

## Prerequisites

- **Node.js** 18+ and npm
- **PyroAnnotator API** running on `http://localhost:5050` 
- Modern web browser with ES2020+ support

## Quick Start

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Environment Configuration

Create a `.env.local` file (optional):

```bash
# API Base URL (default: http://localhost:5050)
VITE_API_BASE_URL=http://localhost:5050

# Environment (development/production)
VITE_ENVIRONMENT=development
```

### 3. Start Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### 4. Verify API Connection

1. Ensure the PyroAnnotator API is running at `http://localhost:5050`
2. Check API health: `curl http://localhost:5050/status`
3. View API docs: `http://localhost:5050/docs`

## Available Scripts

### Development
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally

### Code Quality
- `npm run lint` - Run ESLint for code linting
- `npm run type-check` - Run TypeScript type checking

## Project Structure

```
frontend/
├── public/                 # Static assets
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── annotation/     # Annotation-specific components
│   │   │   ├── AnnotationInterface.tsx    # Main annotation interface (547 lines)
│   │   │   ├── DetectionAnnotationCanvas.tsx # Canvas for bbox annotation
│   │   │   ├── SubmissionControls.tsx     # Annotation submission controls
│   │   │   ├── AnnotationToolbar.tsx      # Annotation action toolbar
│   │   │   ├── KeyboardShortcutModal.tsx  # Keyboard shortcuts help
│   │   │   └── SequenceBboxCard.tsx       # Individual bbox annotation
│   │   ├── layout/         # Layout components
│   │   │   └── AppLayout.tsx
│   │   ├── media/          # Media display components
│   │   └── ui/             # Reusable UI components
│   │       └── ProgressIndicator.tsx
│   ├── pages/              # Route components
│   │   ├── HomePage.tsx         # Landing page
│   │   ├── SequencesPage.tsx    # Sequence browser
│   │   ├── AnnotationPage.tsx   # Main annotation workflow
│   │   ├── AnnotationsPage.tsx  # List view
│   │   ├── DashboardPage.tsx
│   │   ├── SequenceDetailPage.tsx
│   │   └── AnnotationInterface.tsx
│   ├── hooks/              # Custom React hooks
│   │   ├── useAnnotationStats.ts
│   │   └── useDetectionImage.ts
│   ├── services/           # API client services
│   │   └── api.ts          # Main API client with axios
│   ├── store/              # Zustand state management
│   │   ├── useSequenceStore.ts
│   │   └── useAnnotationStore.ts
│   ├── types/              # TypeScript type definitions
│   │   └── api.ts          # API response types
│   ├── utils/              # Utility functions and constants
│   │   ├── annotation/     # Annotation workflow utilities (13 files)
│   │   │   ├── sequenceUtils.ts    # Sequence data utilities
│   │   │   ├── progressUtils.ts    # Progress tracking utilities
│   │   │   ├── effectUtils.ts      # useEffect hook utilities
│   │   │   ├── keyboardUtils.ts    # Keyboard shortcut handling
│   │   │   ├── navigationUtils.ts  # Navigation state utilities
│   │   │   ├── annotationHandlers.ts # Event handler utilities
│   │   │   ├── coordinateUtils.ts  # Canvas coordinate utilities
│   │   │   ├── drawingUtils.ts     # Canvas drawing utilities
│   │   │   ├── validationUtils.ts  # Validation utilities
│   │   │   ├── canvasUtils.ts      # Canvas manipulation utilities
│   │   │   ├── imageUtils.ts       # Image processing utilities
│   │   │   ├── workflowUtils.ts    # Annotation workflow utilities
│   │   │   └── index.ts            # Utility exports
│   │   ├── notification/   # Notification utilities
│   │   │   └── toastUtils.ts       # Toast notification management
│   │   ├── constants.ts    # App constants and enums
│   │   ├── modelAccuracy.ts # Model accuracy analysis utilities
│   │   ├── processingStage.ts # Processing stage utilities
│   │   ├── passwordUtils.ts # Password validation utilities
│   │   └── filter-state.ts  # Filter state management utilities
│   ├── App.tsx             # Main app component
│   ├── main.tsx            # App entry point
│   └── index.css           # Global styles
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite configuration
├── tailwind.config.js      # Tailwind CSS configuration
└── README.md               # This file
```

## Key Components

### AnnotationInterface (Refactored Architecture)
The main annotation component has been significantly refactored from 1,561 lines to 547 lines (65% reduction) through systematic extraction of utilities and modular design:

- **Modular Components**: Extracted specialized components (DetectionAnnotationCanvas, SubmissionControls, AnnotationToolbar)
- **Utility Layer**: 13 annotation utilities handling specific concerns (sequence management, progress tracking, keyboard shortcuts, canvas operations)
- **Toast Notifications**: Centralized notification system with useToastNotifications hook
- **Event Handlers**: Extracted annotation event handlers into dedicated utilities
- **Comprehensive JSDoc**: Full documentation coverage for maintainability

### Annotation Workflow Utilities
A comprehensive set of 13 specialized utilities powering the annotation interface:

- **sequenceUtils.ts**: Sequence data management and processing
- **progressUtils.ts**: Progress tracking and statistics calculation
- **effectUtils.ts**: useEffect hook management and lifecycle utilities
- **keyboardUtils.ts**: Keyboard shortcut handling and navigation
- **navigationUtils.ts**: Navigation state management between sequences
- **annotationHandlers.ts**: Event handling for annotation interactions
- **coordinateUtils.ts**: Canvas coordinate transformations and calculations
- **drawingUtils.ts**: Canvas drawing operations and bbox rendering
- **validationUtils.ts**: Input validation and data integrity checking
- **canvasUtils.ts**: Canvas manipulation and image processing
- **imageUtils.ts**: Image loading, scaling, and optimization
- **workflowUtils.ts**: Annotation workflow state management
- **index.ts**: Centralized utility exports and public API

### SequencesPage
- Browse and filter wildfire detection sequences
- Advanced filtering with model accuracy analysis
- Pagination and search functionality with URL state persistence
- Real-time data from API with intelligent caching

### Annotation Pages
- **AnnotationPage**: Main annotation workflow with enhanced UI
- **AnnotationsPage**: List view with processing stage visualization
- **SequenceDetailPage**: Detailed sequence information and metadata
- Interactive image viewer with side-by-side comparison
- Progress tracking and batch operations
- Smart annotation interface matching backend API enums

### API Client & State Management
- **Type-safe API client** with comprehensive error handling
- **Automatic request/response interceptors** with logging
- **TanStack Query v5** for advanced caching and background refetching
- **Zustand stores** for annotation and sequence state management
- **Query key management** for cache invalidation strategies

## API Integration

The frontend integrates with the PyroAnnotator API using:

### Endpoints Used
- `GET /api/v1/sequences` - List sequences with filtering
- `GET /api/v1/sequences/{id}` - Get sequence details
- `GET /api/v1/annotations/sequences` - List sequence annotations
- `POST /api/v1/annotations/sequences` - Create annotations
- `PATCH /api/v1/annotations/sequences/{id}` - Update annotations  

### Data Models
The frontend uses TypeScript types that match the API's data models:

- **Sequences**: Camera sequences with metadata
- **Annotations**: Human annotations with smoke/false positive classification
- **Enums**: SmokeType and FalsePositiveType matching backend definitions

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:5050` | Backend API base URL |
| `VITE_ENVIRONMENT` | `development` | Environment mode |

## Docker Deployment

### Build Docker Image

```bash
docker build -t pyro-annotator-frontend .
```

### Run Container

```bash
docker run -p 3000:80 \
  -e VITE_API_BASE_URL=http://your-api-host:5050 \
  pyro-annotator-frontend
```

### Docker Compose

```yaml
version: '3.8'
services:
  frontend:
    build: .
    ports:
      - "3000:80"
    environment:
      - VITE_API_BASE_URL=http://backend:5050
    depends_on:
      - backend
```

## Development Workflow

### Refactored Architecture (2024)
The frontend has undergone significant architectural improvements:

- **Component Reduction**: Main AnnotationInterface reduced from 1,561 lines to 547 lines (65% reduction)
- **Modular Utilities**: Created 13 specialized annotation utilities for maintainability
- **Comprehensive Documentation**: Added complete JSDoc coverage across all utilities
- **Enhanced Type Safety**: Full TypeScript strict mode with comprehensive error resolution
- **Performance Optimization**: Improved state management and caching strategies

### Adding New Features
1. Create feature branch: `git checkout -b feature/new-feature`
2. Identify appropriate utility modules in `src/utils/annotation/`
3. Add new components following modular patterns
4. Leverage existing utilities (sequenceUtils, progressUtils, etc.)
5. Update TypeScript types if needed
6. Add comprehensive JSDoc documentation
7. Add to routing in `App.tsx`
8. Test with API integration and run quality checks
9. Submit pull request

### Working with Annotation Utilities
When modifying annotation functionality:
1. **Identify the right utility**: Use the appropriate utility from `src/utils/annotation/`
2. **Follow established patterns**: Each utility has a specific concern and API
3. **Maintain documentation**: Update JSDoc when modifying function signatures
4. **Test interactions**: Ensure utilities work together correctly
5. **Use the index.ts**: Import utilities through the centralized export

### API Updates
When the backend API changes:
1. Update types in `src/types/api.ts`
2. Update API client in `src/services/api.ts`  
3. Update constants in `src/utils/constants.ts`
4. Update model accuracy utilities in `src/utils/modelAccuracy.ts`
5. Test all affected components and utilities

### State Management Strategy
- **Zustand** for app-level state (sequences, annotations, UI state)
- **TanStack Query v5** for server state (API data, caching, background refetching)
- **Local state** for component-specific data and temporary UI state
- **Toast notifications** managed through centralized toastUtils
- **Navigation state** handled by dedicated navigationUtils

### Code Quality Standards
- **TypeScript**: Full strict mode enabled with comprehensive type checking
- **ESLint**: Strict linting with warnings treated as errors in CI
- **JSDoc**: Comprehensive documentation for all public functions and interfaces
- **Testing**: Integration with API and component testing
- **Performance**: Monitoring bundle size and render performance

## Troubleshooting

### Common Issues

**API Connection Failed**
```
Failed to load sequences
```
- Check if backend API is running on `http://localhost:5050`
- Verify CORS settings in backend
- Check network connectivity

**Build Errors**
```
Module not found
```
- Run `npm install` to ensure dependencies are installed
- Check import paths use `@/` alias for src directory
- Verify TypeScript configuration

**Type Errors**
```
Property does not exist on type
```
- Update API types in `src/types/api.ts`
- Check backend API schema changes
- Run `npm run type-check`

### Performance Issues

**Slow Loading**
- Check React Query cache configuration
- Verify API response times
- Monitor network requests in DevTools

**Memory Usage**
- Check for memory leaks in useEffect cleanup
- Verify image resources are properly disposed
- Monitor component re-renders

## Contributing

1. Follow TypeScript best practices
2. Use existing component patterns
3. Add proper error handling
4. Update documentation for new features
5. Test with real API data
6. Follow conventional commit messages

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](../LICENSE) file for details.

## Support

For issues and questions:
- Check the [API documentation](http://localhost:5050/docs)
- Review the [implementation plan](./IMPLEMENTATION_PLAN.md)
- Open issues on the project repository