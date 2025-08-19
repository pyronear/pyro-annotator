# pyro-annotator

Collection of modules to streamline the annotation of Pyronear data.

## Quick Start with Docker

Start both the annotation API backend and frontend with a single command:

```bash
# Start all services (database, backend API, frontend)
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove all data (fresh start)
docker compose down -v
```

### Service Access

Once running, access the services at:

- **Frontend Application**: http://localhost:3000
- **Backend API**: http://localhost:5050
- **API Documentation**: http://localhost:5050/docs
- **PostgreSQL Database**: localhost:5432
- **LocalStack S3**: http://localhost:4566

### Build and Development

The root docker-compose.yml orchestrates both services for production-like deployment. For active development on individual services, use their respective docker-compose files:

```bash
# Backend development (with live code reload)
cd annotation_api
make start  # Uses docker-compose-dev.yml with volume mounts

# Frontend development (with hot reload)
cd frontend
npm run dev  # Vite dev server on port 5173
```

## Importing Platform Data

The project includes a comprehensive data import script that fetches sequences and detections from the Pyronear platform API and automatically generates annotations ready for human review.

### Prerequisites

**Services must be running first:**
```bash
# Start all services
docker compose up -d

# Verify annotation API is accessible
curl http://localhost:5050/docs
```

**Required Environment Variables:**
```bash
# Platform API credentials (both regular and admin access required)
export PLATFORM_LOGIN="your_platform_username"
export PLATFORM_PASSWORD="your_platform_password"
export PLATFORM_ADMIN_LOGIN="your_admin_username"
export PLATFORM_ADMIN_PASSWORD="your_admin_password"
```

### Basic Usage

**Import platform data for a date range:**
```bash
cd annotation_api

# Import and generate annotations for January 1-2, 2024
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from 2024-01-01 --date-end 2024-01-02 --loglevel info
```

### What the Script Does

1. **Fetches Platform Data**: Retrieves sequences, detections, and images from platform API
2. **Posts to Annotation API**: Creates sequences and detections in your local system
3. **Generates Annotations**: Analyzes AI predictions and creates sequence annotations
4. **Sets Ready for Review**: Moves sequences to `READY_TO_ANNOTATE` stage

### Key Parameters

- `--date-from` / `--date-end`: Date range (YYYY-MM-DD format)
- `--confidence-threshold`: Minimum AI confidence (0.0-1.0, default: 0.0) 
- `--iou-threshold`: IoU threshold for clustering overlapping boxes (default: 0.3)
- `--dry-run`: Preview actions without execution
- `--skip-platform-fetch`: Process existing sequences only
- `--loglevel`: Logging level (debug/info/warning/error)

### Example Workflows

**Daily import routine:**
```bash
# Import yesterday's data
uv run python -m scripts.data_transfer.ingestion.platform.import \
  --date-from $(date -d '1 day ago' '+%Y-%m-%d') \
  --loglevel info
```

For detailed documentation, parameter reference, and troubleshooting, see [Data Ingestion Guide](annotation_api/docs/data-ingestion-guide.md).

### Troubleshooting

**Services won't start:**
- Ensure ports 3000, 5050, 5432, and 4566 are available
- Check logs: `docker compose logs [service_name]`
- Rebuild images: `docker compose build --no-cache`

**Frontend can't connect to backend:**
- Verify backend is healthy: `curl http://localhost:5050/status`
- Check backend logs for errors
- Ensure database and S3 services are running

**Database connection issues:**
- Wait for database to be healthy (may take 10-20 seconds on first start)
- Check database logs: `docker compose logs postgres`

**Fresh start (clear all data):**
```bash
docker compose down -v  # Removes containers and volumes
docker compose up -d    # Fresh start
```

## Individual Modules

- [API](./annotation_api/README.md)
- [Frontend](./frontend/README.md)
- [Sequence Level Annotation](./sequence_labeler/README.md)
- [SAM bbox propagation](./sam_based_bbox_propagation/README.md)
