# Sequence Labeler

## 🛠️ Setup

### 🐍 Python dependencies

1. **Install `uv` with `pipx`:**

```bash
pipx install uv
```

2. **Install dependencies:**

```bash
uv sync
```

3. **Activate the `uv` virtual environment:**

```bash
source .venv/bin/activate
```

---

## 🔍 Sequence-Level Annotation

This tool helps you manually review and annotate **candidate detections** (as GIFs) generated from camera sequences.

> 📝 Frame-level annotation tools will be added later.

### Step 1 – Prepare the data

Edit `tools/prepare_data.py` and set the path to your dataset:

```python
all_sequences_folder_path = "/path/to/your/sequences/folder"
```

Then run the script:

```bash
make prepare_data
```

This will:

* Run prediction filtering and NMS
* Generate full-frame and crop GIFs for each candidate
* Save annotation metadata to `all_sequences.json`

---

### Step 2 – Annotate candidates in the Streamlit app

Launch the annotation interface:

```bash
make run_annotation_app
```

This app allows you to:

* View candidate predictions as GIFs
* Choose labels (Smoke, Industrial_smoke, Sun flare, Cloud, Building, Antenna, Other)
* Mark sequences with missing smoke
* Track annotation status in the JSON file
