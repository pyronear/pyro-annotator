# PyroAnnotator Frontend

A modern React application for wildfire detection annotation, replacing the legacy Streamlit interface with a professional, scalable solution.

## Features

- 🔥 **Modern UI**: Built with React 18, TypeScript, and Tailwind CSS
- 📊 **Real-time Data**: Integration with PyroAnnotator API backend  
- 🎯 **Advanced Filtering**: Filter sequences by source, camera, organization, and wildfire alerts
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices
- 🚀 **Performance**: Optimized with React Query for caching and Zustand for state management
- 🎨 **Interactive GIF Viewer**: Side-by-side GIF comparison with playback controls
- 📋 **Smart Annotation**: Intuitive interface matching API data models
- 🐳 **Docker Ready**: Containerized for easy deployment

## Technology Stack

### Core Framework
- **React 18** with TypeScript for type safety
- **Vite** for fast development and building
- **React Router** for client-side routing

### Styling & UI
- **Tailwind CSS** for utility-first styling
- **Lucide React** for consistent iconography  
- **Headless UI** for accessible components

### State Management & Data
- **Zustand** for lightweight state management
- **React Query (TanStack Query)** for server state and caching
- **React Hook Form** for form handling
- **Zod** for validation

### API Integration
- **Axios** for HTTP requests
- **TypeScript types** generated from OpenAPI schema

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
│   │   ├── layout/         # Layout components
│   │   ├── media/          # Media components (GifViewer)
│   │   └── ui/             # Basic UI components
│   ├── pages/              # Route components
│   │   ├── HomePage.tsx    # Landing page
│   │   ├── SequencesPage.tsx # Sequence browser
│   │   └── AnnotationPage.tsx # Annotation interface
│   ├── hooks/              # Custom React hooks
│   ├── services/           # API client services
│   │   └── api.ts          # Main API client
│   ├── store/              # Zustand state management
│   │   ├── useSequenceStore.ts
│   │   └── useAnnotationStore.ts
│   ├── types/              # TypeScript type definitions
│   │   └── api.ts          # API response types
│   ├── utils/              # Utility functions and constants
│   │   └── constants.ts    # App constants and enums
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

### SequencesPage
- Browse and filter wildfire detection sequences
- Pagination and search functionality
- Real-time data from API with caching

### AnnotationPage  
- Interactive GIF viewer with playback controls
- Smart annotation interface matching API enums
- Progress tracking and batch operations

### GifViewer
- Side-by-side main/crop GIF comparison
- Zoom, fullscreen, and playback controls
- Optimized loading and error handling

### API Client
- Type-safe API client with error handling
- Automatic request/response interceptors
- Pagination and filtering support

## API Integration

The frontend integrates with the PyroAnnotator API using:

### Endpoints Used
- `GET /api/v1/sequences` - List sequences with filtering
- `GET /api/v1/sequences/{id}` - Get sequence details
- `GET /api/v1/annotations/sequences` - List sequence annotations
- `POST /api/v1/annotations/sequences` - Create annotations
- `PATCH /api/v1/annotations/sequences/{id}` - Update annotations  
- `POST /api/v1/annotations/sequences/{id}/generate-gifs` - Generate GIFs
- `GET /api/v1/annotations/sequences/{id}/gifs/urls` - Get GIF URLs

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

### Adding New Features
1. Create feature branch: `git checkout -b feature/new-feature`
2. Add components in appropriate directories
3. Update TypeScript types if needed
4. Add to routing in `App.tsx`
5. Test with API integration
6. Submit pull request

### API Updates
When the backend API changes:
1. Update types in `src/types/api.ts`
2. Update API client in `src/services/api.ts`  
3. Update constants in `src/utils/constants.ts`
4. Test all affected components

### State Management
- Use **Zustand** for app-level state (sequences, annotations)
- Use **React Query** for server state (API data, caching)
- Use **local state** for component-specific data

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
- Verify GIF resources are properly disposed
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