# Tutorial: import alerts into an annotation API

This tutorial shows how to pull sequences from a Pyronear alert API, keep only
the ones the temporal model finds interesting, and import them into a
pyro-annotator annotation API (for example a local one) to annotate them, and
export the result (annotations and images) to a local folder.

## What the script does

For each day of the date range, one day after the other:

1. it fetches the day's sequences from the alert API;
2. for each sequence, it downloads the **first 20 images**;
3. it runs the **temporal model** (`pyronear/temporal-model`) on these images
   and gets a score between 0 and 1;
4. it keeps only the sequences with a score **above 0.1**;
5. it imports these sequences into the annotation API and gets them ready to
   annotate;
6. it moves on to the next day.

Nothing is downloaded ahead. If you stop the script halfway, the finished days
stay imported. If a day fails, the script reports it and goes on with the next
day.

## 1. Requirements

- **Git**
- **Docker** (Docker Desktop on Mac/Windows, Docker Engine on Linux), running
- **uv**, the Python package manager:
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- About **10 GB of free disk space** (PyTorch and the model are large)
- Internet access (Docker images, model on HuggingFace, alert API)
- Alert API credentials: **one user account and one admin account** (the admin
  account is used to list organizations; if your account is an admin, use it
  for both)

You don't need a GPU: the model runs on CPU (slower).

## 2. Get the code

```bash
git clone https://github.com/pyronear/pyro-annotator.git
cd pyro-annotator
```

## 3. Start a local annotation API

Skip this step if you import into an annotation API that is already online.

From the repo root:

```bash
make up
```

The first start takes a few minutes (it builds the images). Then:

- API: http://localhost:5050/status should return `{"status":"ok"}`
- Annotation app: http://localhost:3000
  (login `admin`, password `admin12345`)

To stop it later: `make down` (your data is kept).

## 4. Set the credentials

Create the file `annotation_api/.env` (it is never committed):

```bash
# Alert API credentials
ALERT_API_LOGIN=your_login
ALERT_API_PASSWORD=your_password
ALERT_API_ADMIN_LOGIN=your_admin_login
ALERT_API_ADMIN_PASSWORD=your_admin_password

# Local annotation API (docker compose defaults)
LOCAL_ANNOTATION_LOGIN=admin
LOCAL_ANNOTATION_PASSWORD=admin12345

# Remote annotation API (only if REMOTE_API is not localhost)
# MAIN_ANNOTATION_LOGIN=...
# MAIN_ANNOTATION_PASSWORD=...

# Dummy values: the script needs them to start but does not use them
POSTGRES_URL=postgresql://unused@localhost/unused
S3_ACCESS_KEY=unused
S3_SECRET_KEY=unused
S3_REGION=unused
S3_ENDPOINT_URL=http://localhost:1
```

The old names `PLATFORM_LOGIN`, `PLATFORM_ADMIN_LOGIN`, etc. still work but are
deprecated: use the `ALERT_API_*` names.

## 5. Test on one day without writing anything

`DRY_RUN=1` fetches and scores the sequences but imports nothing. Use it to
check that the credentials and the model work. From `annotation_api/`, with
your alert API URL:

```bash
cd annotation_api
make import-alert-api DATE_FROM=2026-10-10 \
  ALERT_API_URL=https://your-alert-api.example.org SOURCE_API=api_cenia \
  REMOTE_API=http://localhost:5050 DRY_RUN=1
```

The first run installs PyTorch and downloads the model from HuggingFace, so it
takes a few minutes. You should see `✅ Target annotation auth OK`, then a line
like:

```
🧠 Temporal filter (> 0.1): kept 2/3 sequence(s) (0 failed to score)
```

## 6. Import a date range

Same command, without `DRY_RUN`:

```bash
make import-alert-api DATE_FROM=2026-10-05 DATE_END=2026-10-11 \
  ALERT_API_URL=https://your-alert-api.example.org SOURCE_API=api_cenia \
  REMOTE_API=http://localhost:5050
```

The script prints one block per day (`📅 2026-10-05`, `📅 2026-10-06`, ...) with:

- the number of sequences found;
- the number kept by the temporal model (`kept X/Y`);
- the number of sequences imported and annotations created.

At the end, if something went wrong, it lists the failed days:

```
❌ 1 day(s) failed: 2026-10-08
```

Just run that day again (`DATE_FROM=2026-10-08 DATE_END=2026-10-08`). Running a
day that is already imported creates no duplicates: existing sequences are
skipped.

## 7. Annotate

Open the annotation app (http://localhost:3000 for a local one) and log in.
The imported sequences are in the annotation queue.

## 8. Export the annotations

When you are done annotating, export everything to a local folder (annotations
and images) to add it to the dataset later. From `annotation_api/`:

```bash
make export-alerts REMOTE_API=http://localhost:5050 OUTPUT_DIR=outputs/alerts_export
```

The folder contains:

```
outputs/alerts_export/
├── manifest.jsonl     # one line per alert: objects, labels, boxes, scores
└── images/{source_api}/{alert_id}/{detection_id}.jpg
```

Each frame in `manifest.jsonl` has an `image_path` that points into `images/`.

- Only **fully annotated** alerts are exported (every object of the alert is
  done). Alerts still in progress are left out.
- You can run it again at any time: the manifest is rewritten and only missing
  images are downloaded.

To check the boxes by eye, draw them on the images:

```bash
make render-overlays DATASET_DIR=outputs/alerts_export
```

This writes contact sheets to `outputs/alerts_export/overlays/`.

## Parameters

Pass them to `make import-alert-api` as `NAME=value`:

| Parameter | What it does | Default |
|---|---|---|
| `DATE_FROM` | First day (required) | – |
| `DATE_END` | Last day (included) | `DATE_FROM` |
| `ALERT_API_URL` | Source alert API | `https://alertapi.pyronear.org` |
| `SOURCE_API` | Source tag saved on the data: `pyronear_french`, `api_cenia` or `alert_wildfire`. Set automatically for `alertapi.pyronear.org` and `apicenia.pyronear.org`, required for any other URL | from the URL |
| `REMOTE_API` | Target annotation API | `https://annotationapi.pyronear.org` |
| `IMAGE_TRANSFER` | How images reach the annotation API: `url` (the annotation API downloads them) or `bucket-copy` (direct copy between S3 buckets, only between Pyronear France servers) | `bucket-copy` for `alertapi.pyronear.org`, `url` otherwise |
| `MIN_TEMPORAL_SCORE` | Temporal model threshold. Empty = no filter | `0.1` |
| `TEMPORAL_MODEL_VERSION` | Model version on HuggingFace | `v0.6.0` |
| `FRAMES_LIMIT` | Number of images per sequence (the first ones) | `20` |
| `MAX_SEQUENCES` | Max sequences per day (0 = no limit) | `0` |
| `DRY_RUN` | `1` = fetch and score only, import nothing | empty |

**Warning**: `REMOTE_API` points to the Pyronear France annotation API by
default. For a local one, always pass `REMOTE_API=http://localhost:5050`.

**From the Pyronear France alert API into a local annotation API**: add
`IMAGE_TRANSFER=url`. Otherwise the local API tries to copy the images from
Pyronear's S3 buckets, which it cannot access.

## Troubleshooting

| Message | Cause | Fix |
|---|---|---|
| `KeyError: 'POSTGRES_URL'` | `.env` is missing or not in `annotation_api/` | Create `annotation_api/.env` (step 4) and run from `annotation_api/` |
| `Target annotation auth failed` | The annotation API is not running, or wrong credentials | Check http://localhost:5050/status and `LOCAL_ANNOTATION_*` |
| `ALERT_API_... is not set` | One of the 4 alert API credentials is missing | Fill in `ALERT_API_*` in `.env` |
| `Authentication failed` | Wrong alert API credentials | Check `ALERT_API_*` in `.env` |
| `--source-api is required for an unknown alert API URL` | Unknown alert API URL | Add `SOURCE_API=...` |
| Every detection fails with `IMAGE_TRANSFER=bucket-copy` | The annotation API cannot access the alert API's buckets | Add `IMAGE_TRANSFER=url` |
