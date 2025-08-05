# Pyronear Annotation API - Claude Context

## Project Overview
The Pyronear Annotation API is a FastAPI-based backend service for wildfire prevention, detection and monitoring. It provides REST endpoints for managing detection annotations, sequences, and related wildfire data with advanced pagination, filtering, and validation capabilities.

## Technology Stack
- **Framework**: FastAPI with Python 3.9+
- **Package Manager**: uv (fast Python package installer and resolver)
- **Database**: PostgreSQL with SQLModel/SQLAlchemy
- **Storage**: S3-compatible storage (AWS S3/LocalStack)
- **Authentication**: JWT-based authentication
- **Container**: Docker with multi-stage builds
- **Quality Tools**: Ruff (linting/formatting), MyPy (type checking), Pytest (testing)
- **Pagination**: fastapi-pagination with async support

## Project Structure
```
annotation_api/
├── src/
│   ├── app/
│   │   ├── api/             # API endpoints and routing
│   │   │   ├── api_v1/
│   │   │   │   ├── endpoints/  # Individual endpoint modules
│   │   │   │   └── router.py   # API router configuration
│   │   │   └── dependencies.py # Dependency injection
│   │   ├── clients/         # API client modules
│   │   │   └── annotation_api.py # Rich API client with error handling
│   │   ├── core/            # Core configuration
│   │   │   └── config.py    # Settings and environment variables
│   │   ├── crud/            # Database CRUD operations
│   │   ├── schemas/         # Pydantic models for API
│   │   ├── services/        # Business logic services
│   │   ├── models.py        # SQLModel database models
│   │   ├── main.py          # FastAPI application entry point
│   │   └── db.py            # Database initialization
│   └── tests/               # Comprehensive test suite (84+ tests)
├── docs/                    # Complete user documentation
│   ├── README.md           # Documentation index
│   ├── api-client-guide.md # User guide with examples
│   ├── api-reference.md    # Complete technical reference
│   └── examples.md         # Real-world implementation patterns
├── Dockerfile               # Container configuration
├── scripts/                 # Utility and data transfer scripts
│   ├── data_transfer/       # Data ingestion scripts
│   │   └── ingestion/
│   │       └── platform/    # Platform API data fetching
│   └── setup.sh            # Project setup automation
├── pyproject.toml          # uv dependencies and tool config
├── uv.lock                 # Locked dependencies for reproducible builds
├── docker-compose-dev.yml  # Development environment
└── Makefile                # Development commands
```

## Key Endpoints
The API provides enhanced endpoints with pagination, filtering, and ordering:
- **Detections** (`/api/v1/detections/`) - Wildfire detection data with validated algo_predictions JSONB
  - Supports filtering by sequence_id, alert_api_id, recorded_at ranges
  - Ordering by created_at, recorded_at (asc/desc)
  - Paginated responses with items, page, pages, size, total
- **Detection Annotations** (`/api/v1/annotations/detections/`) - Annotations for detections
- **Sequences** (`/api/v1/sequences/`) - Image/video sequences with enhanced functionality
  - Supports filtering by source_api, camera_id, organisation_id, is_wildfire_alertapi
  - Ordering by created_at, recorded_at (asc/desc)
  - Paginated responses with comprehensive metadata
- **Sequence Annotations** (`/api/v1/annotations/sequences/`) - Annotations for sequences with derived has_smoke/has_false_positives fields

## Development Commands

### Package Management
- `uv sync` - Install production dependencies
- `uv sync --group dev` - Install development dependencies (includes quality, test tools)
- `uv add <package>` - Add new dependency
- `uv add --group dev <package>` - Add development dependency

### Quality & Linting
- `make lint` - Run format check, linting, and type checking
- `make fix` - Auto-format code and fix linting issues
- `uv run ruff format .` - Format code
- `uv run ruff check .` - Run linting
- `uv run mypy` - Type checking

### Testing
- `make test` - Run full test suite with coverage in Docker containers (includes live code mounting)
- `uv run pytest src/tests/ -s --cov=app` - Run tests locally with coverage (requires local setup)

**Note**: The `make test` command uses a specialized Docker setup with:
- Multi-stage Dockerfile with dedicated test target that includes dev dependencies
- Live code mounting via volumes (`./src/app:/app/app`, `./src/tests:/app/tests`) 
- Proper test isolation with database cleanup between tests
- Fixed HTTPX AsyncClient integration using `ASGITransport` for FastAPI testing
- Comprehensive test suite with 84+ test cases covering all endpoints and edge cases
- Clean test output with silenced debug messages and deprecation warnings

### Development Server
- `make start` - Start development environment with Docker Compose
- `make stop` - Stop development environment
- `make start-prod` - Start production environment
- `make stop-prod` - Stop production environment
- `make docker-build` - Build Docker image
- `make setup` - Run setup tasks (creates acme.json, checks prerequisites)

### Database
- Database migrations handled via Alembic
- PostgreSQL with async support (asyncpg)
- Development uses local PostgreSQL in Docker

## Environment Configuration
Key environment variables (see `src/app/core/config.py`):
- `POSTGRES_URL` - Database connection string
- `SUPERADMIN_LOGIN/PWD/ORG` - Admin user credentials
- `JWT_SECRET` - JWT token secret
- `S3_ACCESS_KEY/SECRET_KEY/REGION/ENDPOINT_URL` - S3 storage config
- `DEBUG` - Debug mode flag

## Development Setup
1. Clone repository
2. Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
3. Copy `.env.template` to `.env` and configure (if needed)
4. **Automated setup**: Run `make start` - this automatically creates `acme.json` and checks prerequisites
5. Install dependencies (for local dev): `uv sync --group dev`
6. Run: `make start` (Docker - recommended) or `uv run uvicorn app.main:app --reload --app-dir src` (local)
7. Access API docs at: http://localhost:5050/docs

### Setup Commands
- `make setup` - Run setup tasks only (creates acme.json, checks prerequisites)
- `make start` - Development environment with automatic setup
- `make start-prod` - Production environment with automatic setup
- `make stop` / `make stop-prod` - Stop respective environments

## Code Standards
- Python 3.9+ with type hints
- uv for fast dependency management
- Ruff for formatting and linting (120 char line length)
- MyPy for type checking
- Pytest for testing with async support
- FastAPI best practices with dependency injection
- SQLModel for database models
- Pydantic for API schemas and JSONB validation

## Data Validation & Business Logic

### Database Schema Enhancements
- **Sequence Model**: Added required `recorded_at` field for temporal tracking
- **Database Indices**: Comprehensive indexing for performance optimization:
  - Sequences: created_at, recorded_at, last_seen_at, source_api, camera_id, organisation_id, is_wildfire_alertapi
  - Detections: sequence_id, created_at, recorded_at, sequence_id+created_at composite
  - Annotations: has_smoke, has_false_positives, has_missed_smoke for sequence annotations
- **Unique Constraints**: 
  - Sequences: (alert_api_id, source_api) uniqueness
  - Detections: (alert_api_id, id) uniqueness
  - Annotations: One annotation per detection/sequence

### JSONB Field Validation
The API implements comprehensive Pydantic validation for JSONB fields:

#### Detection.algo_predictions Validation
- **Structure**: `{predictions: [{xyxyn: [x1n y1n x2n y2n], confidence: float, class_name: str}, ...]}`
- **xyxyn constraints**: 4 floats between 0-1, with x1≤x2 and y1≤y2
- **confidence**: Float between 0.0-1.0
- **Validation models**: `AlgoPrediction`, `AlgoPredictions` in `app/schemas/annotation_validation.py`

#### SequenceAnnotation.annotation Validation & Derived Fields
- **Structure**: `{sequences_bbox: [{is_smoke: bool, gif_url_main?: str, gif_url_crop?: str, false_positive_types: [enum, ...], bboxes: [{detection_id: int, xyxyn: [x1n y1n x2n y2n]}]}, ...]}`
- **Derived fields**: `has_smoke` and `has_false_positives` are automatically calculated from annotation data
- **FalsePositiveType enum**: Validates false_positive_types against predefined enum values
- **xyxyn constraints**: Same as Detection (4 floats, 0-1 range, coordinate constraints)
- **Validation models**: `SequenceAnnotationData`, `SequenceBBox`, `BoundingBox` in `app/schemas/annotation_validation.py`

### Field Derivation Logic
- **has_smoke**: Derived from any `is_smoke: true` in sequences_bbox
- **has_false_positives**: Derived from any non-empty `false_positive_types` arrays
- **false_positive_types**: JSON string of unique false positive types from all sequences_bbox

### API Enhancements
- **Pagination**: All list endpoints return paginated responses using fastapi-pagination
- **Filtering**: Advanced filtering capabilities on key fields
- **Ordering**: Configurable ordering by timestamp fields with asc/desc direction
- **Error Handling**: Comprehensive exception handling with detailed validation messages

## Authentication & Security
- JWT-based authentication with configurable expiration
- CORS middleware configured
- Superadmin user setup via environment variables
- S3 storage with presigned URLs for file access

## Monitoring & Observability
- Process time headers added to responses
- Sentry integration for error tracking
- PostHog for analytics
- Prometheus metrics via fastapi-instrumentator
- Custom OpenAPI documentation with branding

## API Client Library & Documentation

### Comprehensive User Documentation (`docs/`)
Professional documentation suite for end users and developers:

#### Documentation Structure
- **[API Client Guide](docs/api-client-guide.md)** - Practical user-focused documentation with quick start, core concepts, and common workflows
- **[API Reference](docs/api-reference.md)** - Complete technical reference with all functions, parameters, response formats, and error handling
- **[Examples & Recipes](docs/examples.md)** - Real-world implementation patterns including complete workflows, batch processing, ML data export, and web/background task integration
- **[Documentation Index](docs/README.md)** - Overview and navigation guide

### Annotation API Client (`src/app/clients/annotation_api.py`)
Robust synchronous client library with comprehensive error handling and validation.

#### Enhanced Client Features
- **Rich Exception Hierarchy**: `AnnotationAPIError`, `ValidationError`, `NotFoundError`, `ServerError`
- **Detailed Error Messages**: Field-level validation errors with context
- **Paginated Response Support**: Handles new paginated API responses
- **Comprehensive Validation**: Client-side data validation before API calls
- **File Upload Support**: Multipart file uploads for detection images
- **Retry Logic**: Built-in retry mechanisms for transient failures

#### Core Operations
**Sequences:**
```python
from app.clients.annotation_api import create_sequence, list_sequences, ValidationError

# Create sequence with required recorded_at field
sequence_data = {
    "source_api": "pyronear_french",
    "alert_api_id": 123,
    "camera_name": "Test Camera",
    "recorded_at": "2024-01-15T10:30:00",  # Now required
    "last_seen_at": "2024-01-15T10:35:00",
    # ... other required fields
}
try:
    sequence = create_sequence("http://localhost:5050", sequence_data)
except ValidationError as e:
    print(f"Validation failed: {e.field_errors}")

# List with paginated response
sequences_page = list_sequences("http://localhost:5050")
print(f"Page {sequences_page['page']} of {sequences_page['pages']}")
for seq in sequences_page['items']:
    print(f"Sequence: {seq['id']}")
```

**Detections with Enhanced Validation:**
```python
from app.clients.annotation_api import create_detection

# AI predictions with validated coordinates
algo_predictions = {
    "predictions": [
        {
            "xyxyn": [0.1, 0.2, 0.4, 0.6],  # Normalized coordinates [x1, y1, x2, y2]
            "confidence": 0.87,  # 0-1 range
            "class_name": "smoke"
        }
    ]
}

detection_data = {
    "sequence_id": 1,
    "alert_api_id": 456,
    "recorded_at": "2024-01-15T10:25:00",
    "algo_predictions": algo_predictions
}

with open("detection.jpg", "rb") as f:
    detection = create_detection(
        "http://localhost:5050", 
        detection_data, 
        f.read(), 
        "detection.jpg"
    )
```

#### Complete Function Set
- **Sequences**: `create_sequence`, `get_sequence`, `list_sequences`, `delete_sequence`
- **Detections**: `create_detection`, `get_detection`, `list_detections`, `get_detection_url`, `delete_detection`
- **Detection Annotations**: `create_detection_annotation`, `get_detection_annotation`, `list_detection_annotations`, `update_detection_annotation`, `delete_detection_annotation`
- **Sequence Annotations**: `create_sequence_annotation`, `get_sequence_annotation`, `list_sequence_annotations`, `update_sequence_annotation`, `delete_sequence_annotation`

#### Integration Examples
- **Complete Workflows**: Camera data processing with images and annotations
- **Batch Processing**: Quality control annotation processing from CSV
- **ML Data Export**: Training dataset generation with COCO format
- **Web Integration**: Flask application patterns
- **Background Tasks**: Celery integration for async processing

## Data Transfer Scripts

### Platform Data Ingestion
Scripts for fetching data from the Pyronear platform API and transferring it to the annotation API.

#### Script Execution
Use the Python module execution syntax with `uv run`:

```bash
# Fetch sequences for a date range
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequences \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info

# Fetch specific sequence
uv run python -m scripts.data_transfer.ingestion.platform.fetch_platform_sequence_id \
  --sequence-id 123 --loglevel info
```

#### Environment Variables Required
- `PLATFORM_LOGIN` - Platform API login
- `PLATFORM_PASSWORD` - Platform API password  
- `PLATFORM_ADMIN_LOGIN` - Admin login for organization access
- `PLATFORM_ADMIN_PASSWORD` - Admin password for organization access

#### Script Features
- **Relative imports** - Clean module structure with relative imports
- **Concurrent processing** - Multi-threading for faster data fetching
- **Progress tracking** - tqdm progress bars for long-running operations
- **Flexible date ranges** - Configurable date filtering
- **Logging support** - Configurable log levels for debugging

## Migration Notes (Poetry → uv)

### What Changed
- **Package Manager**: Migrated from Poetry to uv for 10-15x faster dependency installation
- **pyproject.toml**: Converted from Poetry format to standard PEP 621 format
- **Lock File**: `uv.lock` replaces `poetry.lock` for deterministic builds
- **Docker**: Multi-stage builds with better layer caching and performance optimizations
- **Dependencies**: Consolidated dev/quality/test groups into single `dev` group

### Key Benefits
- **Performance**: Dramatically faster dependency resolution and installation
- **Standards Compliance**: Uses standard Python packaging specifications (PEP 621)
- **Docker Optimization**: Multi-stage builds with selective volume mounts for development
- **Simplified Workflow**: Single dependency group for all development tools

### Docker Development Notes
- Development mode uses selective volume mounts to preserve virtual environment
- Production mode runs without volume mounts for optimal performance
- Both configurations use the same multi-stage Dockerfile with uv

### Dependency Management
- Production dependencies: `uv sync`
- Development dependencies: `uv sync --group dev`
- Add dependencies: `uv add <package>` or `uv add --group dev <package>`
- Lock file automatically updated when dependencies change

## Recent Enhancements (2024)

### Database & Schema Improvements
- **Added recorded_at field** to Sequence model as required field for temporal tracking
- **Enhanced database indexing** for optimal query performance on timestamp and filter fields
- **Improved unique constraints** to prevent data duplication and maintain integrity

### API Enhancements
- **Pagination Support**: All list endpoints now return paginated responses with metadata
- **Advanced Filtering**: Filter sequences by source_api, camera_id, organisation_id, is_wildfire_alertapi
- **Flexible Ordering**: Order by created_at or recorded_at in ascending/descending order
- **Enhanced Error Handling**: Detailed validation messages with field-level error reporting

### Test Suite Improvements
- **Comprehensive Coverage**: 84+ test cases covering all endpoints and edge cases
- **Clean Test Output**: Silenced debug messages and deprecation warnings for cleaner CI
- **Proper Isolation**: Database cleanup and sequence resets between tests
- **Pagination Testing**: Updated tests to handle new paginated response format
- **Modern AsyncClient**: Using ASGITransport for FastAPI testing best practices

### Client Library & Documentation
- **Rich Exception Hierarchy**: Detailed error types with contextual information
- **Professional Documentation**: Complete user guides, API reference, and real-world examples
- **Validation Helpers**: Client-side validation to catch errors before API calls
- **Integration Patterns**: Examples for web apps, background tasks, and batch processing

## Troubleshooting

### Common Issues
- **Module not found in Docker**: Ensure volume mounts don't overwrite virtual environment
- **Dependencies out of sync**: Run `uv sync` to update from lock file
- **Type checking errors**: Install dev dependencies with `uv sync --group dev`
- **Docker build fails**: Clear build cache with `docker builder prune` and rebuild
- **Test failures with AsyncClient**: Tests use `ASGITransport(app=app)` instead of deprecated `app=app` parameter
- **Database constraint violations in tests**: Tests use proper isolation with sequence resets and cleanup
- **Missing recorded_at field**: All sequence creation now requires recorded_at timestamp
- **Pagination format changes**: List endpoints return `{items: [], page: 1, pages: N}` instead of arrays

### Performance Notes
- **Database queries** are optimized with proper indexing
- **Pagination** prevents memory issues with large datasets
- **FastAPI async** support provides excellent concurrent request handling
- **uv package management** dramatically speeds up dependency resolution and installation