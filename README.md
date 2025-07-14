Got it — here's a revised `README.md` section that makes it clear this is for **sequence-level annotation**, and that **frame-level tools will come later**:

---

# Pyro Annotator

This repository contains tools to annotate Pyronear wildfire detection data.

## 🛠️ Setup

### 🐍 Python dependencies

1. **Install `uv` with `pipx`:**

```bash
pipx install uv
```

2. **Create and activate the `uv` virtual environment:**

```bash
uv venv --python $(which python3.11)
source .venv/bin/activate
```

3. **Install dependencies:**

```bash
uv pip install -r requirements.txt
```

---

## 🔍 Sequence-Level Annotation

This tool helps you manually review and annotate **candidate detections** (as GIFs) generated from camera sequences.

> 📝 Frame-level annotation tools will be added later.

### Step 1 – Prepare the data

Edit `sequence_labeler/prepare_data.py` and set the path to your dataset:

```python
all_sequences_folder_path = "/path/to/your/sequences/folder"
```

Then run the script:

```bash
python sequence_labeler/prepare_data.py
```

This will:

* Run prediction filtering and NMS
* Generate full-frame and crop GIFs for each candidate
* Save annotation metadata to `all_sequences.json`

---

### Step 2 – Annotate candidates in the Streamlit app

Launch the annotation interface:

```bash
streamlit run sequence_labeler/app.py
```

This app allows you to:

* View candidate predictions as GIFs
* Choose labels (Smoke, Industrial_smoke, Sun flare, Cloud, Building, Antenna, Other)
* Mark sequences with missing smoke
* Track annotation status in the JSON file
