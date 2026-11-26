# Sample dataset and `make seed-sample`

`make seed-sample` fills a local stack with real, anonymized alerts in every
annotation state, without any credential. It is opt-in: run it after `make up`.

```bash
make up
make seed-sample
```

The first run downloads the pinned dataset (a GitHub release asset of this
repository) into `./.sample-data/`, checks its SHA-256, and loads it through the
local API. Later runs download nothing and skip the alerts already loaded, so
the command is safe to repeat. `./.sample-data/` is outside the Docker volumes:
`make clean` wipes the database and the bucket but keeps the download.

## What gets loaded

Each alert is loaded in the state `load_states.csv` gives it:

| `load_state` | Result | Where to look |
|---|---|---|
| `to_classify` | every object at `ready_to_annotate` | Classify › Alerts |
| `to_localize` | objects classified; wildfire ones at `seq_annotation_done` | Localize › Smoke |
| `done` | every object `annotated`, boxes included | Done pages, `make export-alerts` |
| `skip` | not loaded | |

The loader replays the real workflow (import, classify-submit, localize-submit)
through the API, so nothing is written to Postgres or S3 directly.

Alerts in `to_localize` show up in the Localize queue once the worker has
auto-annotated them, about 30 seconds per object on a laptop.

An alert with no wildfire object has nothing to localize: asked for
`to_localize`, it is loaded as `done`.

## Tags

After the alerts, `make seed-sample` runs `make seed-tags`
(`src/app/cli/seed_tags.py`), which sets up tags to try scoped access on:

| What | Seeded |
|---|---|
| Tags | `org-alpha`, `org-bravo`, `org-charlie`, each on every alert of that organisation |
| `annotator-alpha` / `annotator12345` | tag `org-alpha` |
| `annotator-multi` / `annotator12345` | tags `org-bravo` and `org-charlie` |
| admin | `full_access` on |

Both annotators can classify and localize. The script writes to Postgres
directly, since the API to tag alerts and users does not exist yet. It is
idempotent: rerun `make seed-tags` alone to tag alerts loaded since.

## Changing the distribution

Copy the file, edit the `load_state` column, and point the loader at it:

```bash
cp .sample-data/sample-data-v1/load_states.csv .sample-data/my_states.csv
make clean && make up
make seed-sample SEED_ARGS="--load-states /sample-data/my_states.csv"
```

`./.sample-data` is mounted at `/sample-data` in the container. An alert that is
already loaded is never modified, hence the `make clean` before reloading with
different states.

## Dataset format

The archive holds one directory, `sample-data-<version>/`:

- `manifest.jsonl` and `images/`: the `make export-alerts` format, one alert
  per line.
- a `seed` block on each object and frame: what the export leaves out and the
  loader needs to rebuild an alert before it was annotated (engine predictions,
  the import-time track, per-object sequence fields).
- `load_states.csv`: the default state of each alert.

Organisation and camera names, ids and coordinates are fictional. One
organisation is published under a second `source_api`, so camera ids and
`platform_alert_id`s collide across sources on purpose.

## Publishing a new version

Needs read access to the annotation API the data comes from
(`MAIN_ANNOTATION_LOGIN` / `MAIN_ANNOTATION_PASSWORD` in `annotation_api/.env`).
Run from `annotation_api/`.

1. Export the finished alerts: `make export-alerts OUTPUT_DIR=outputs/alerts_export`.
2. Select alerts and their load states, then review `selection.csv`:

   ```bash
   uv run python scripts/sample_data/select_sample.py outputs/alerts_export outputs/sample_selection
   ```

3. Write the private organisation map (see the docstring of
   `scripts/sample_data/build_sample.py`), then build:

   ```bash
   uv run python -m scripts.sample_data.build_sample \
     --export-dir outputs/alerts_export --selection-dir outputs/sample_selection \
     --org-map outputs/sample_selection/org_map.PRIVATE.json \
     --output-dir outputs/sample-data-v2
   ```

4. Review the images, then test locally before publishing:

   ```bash
   cp -R outputs/sample-data-v2 ../.sample-data/
   make -C .. seed-sample SEED_ARGS="--dataset-dir /sample-data/sample-data-v2"
   ```

5. Archive it and compute the checksum:

   ```bash
   tar -czf sample-data-v2.tar.gz -C outputs sample-data-v2
   shasum -a 256 sample-data-v2.tar.gz
   ```

6. Attach the archive to a GitHub release tagged `sample-data-v2`, with the
   license in the notes.
7. Update `SAMPLE_VERSION` and `SAMPLE_SHA256` in `src/app/cli/seed_sample.py`.

Everything under `outputs/` is git-ignored. The `*.PRIVATE.json` files map real
names to fictional ones: never publish them.
