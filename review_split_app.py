"""Streamlit viewer: compare model split (fp/wf) against human annotations.

Run:
  uv run --with streamlit,pillow streamlit run review_split_app.py
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import streamlit as st
from PIL import Image, ImageDraw

DEFAULT_EXPORT = Path(
    "annotation_api/outputs/sequences_and_annotations_20260417_083753.json"
)
DEFAULT_SPLIT_ROOT = Path(
    "/Users/mateo/pyronear/vision/train/pyro-train/sdis77_split_nimble-narwhal"
)
DEFAULT_SEQ_ROOT = Path(
    "/Users/mateo/pyronear/vision/dataset/pyro-dataset/data/raw/pyronear-platform/sequences/sdis-77-new_model/sdis-77"
)
SEQ_PATTERN = re.compile(r"sequence-(\d+)$")


@st.cache_data(show_spinner=False)
def load_export(path: str) -> dict[str, Any]:
    data = json.loads(Path(path).read_text())
    annotations = {a["sequence_id"]: a for a in data["annotations"]["items"]}
    sequences = {s["id"]: s for s in data["sequences"]["items"]}
    alert_to = {}
    for sid, anno in annotations.items():
        s = sequences.get(sid)
        if s:
            alert_to[s["alert_api_id"]] = {"seq": s, "anno": anno}
    return {"alert_to": alert_to, "annotations": annotations, "sequences": sequences}


@st.cache_data(show_spinner=False)
def scan_split(split_root: str) -> dict[int, str]:
    alert_to_split = {}
    for split in ("fp", "wf"):
        p = Path(split_root) / split
        if not p.exists():
            continue
        for name in os.listdir(p):
            m = SEQ_PATTERN.search(name)
            if m:
                alert_to_split[int(m.group(1))] = split
    return alert_to_split


@st.cache_data(show_spinner=False)
def scan_seq_folders(seq_root: str) -> dict[int, str]:
    alert_to_path = {}
    root = Path(seq_root)
    for dirpath, dirnames, _ in os.walk(root):
        for d in dirnames:
            m = SEQ_PATTERN.search(d)
            if m:
                alert_to_path[int(m.group(1))] = str(Path(dirpath) / d)
    return alert_to_path


def classify(anno: dict[str, Any], split: str) -> dict[str, Any]:
    human_smoke = bool(anno.get("has_smoke"))
    model_smoke = split == "wf"
    if human_smoke and model_smoke:
        confusion = "TP"
    elif not human_smoke and not model_smoke:
        confusion = "TN"
    elif model_smoke and not human_smoke:
        confusion = "FP"
    else:
        confusion = "FN"
    if anno.get("is_unsure"):
        human_cat = "unsure"
        human_sub = ""
    elif human_smoke:
        human_cat = "smoke"
        human_sub = (anno.get("smoke_types") or ["?"])[0]
    elif anno.get("has_false_positives"):
        human_cat = "fp"
        human_sub = (anno.get("false_positive_types") or ["?"])[0]
    else:
        human_cat = "other"
        human_sub = ""
    return {
        "confusion": confusion,
        "human_cat": human_cat,
        "human_sub": human_sub,
        "model": "smoke" if model_smoke else "no-smoke",
        "human_smoke": human_smoke,
    }


def parse_yolo_label(path: Path) -> list[tuple[float, float, float, float, float]]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text().strip().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        _, xc, yc, w, h, *rest = parts
        conf = float(rest[0]) if rest else 1.0
        out.append((float(xc), float(yc), float(w), float(h), conf))
    return out


def draw_frame(
    img_path: Path,
    pred_boxes: list[tuple[float, float, float, float, float]],
    anno_boxes: list[tuple[float, float, float, float]],
) -> Image.Image:
    img = Image.open(img_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    W, H = img.size
    for xc, yc, w, h, conf in pred_boxes:
        x1 = (xc - w / 2) * W
        y1 = (yc - h / 2) * H
        x2 = (xc + w / 2) * W
        y2 = (yc + h / 2) * H
        draw.rectangle([x1, y1, x2, y2], outline="red", width=3)
        draw.text((x1 + 3, max(0, y1 - 14)), f"pred {conf:.2f}", fill="red")
    for x1n, y1n, x2n, y2n in anno_boxes:
        draw.rectangle(
            [x1n * W, y1n * H, x2n * W, y2n * H], outline="lime", width=3
        )
    return img


def main() -> None:
    st.set_page_config(page_title="Split viewer", layout="wide")
    st.title("Model split vs human annotation")

    with st.sidebar:
        st.header("Sources")
        export_path = st.text_input("Export JSON", str(DEFAULT_EXPORT))
        split_root = st.text_input("Split root", str(DEFAULT_SPLIT_ROOT))
        seq_root = st.text_input("Sequences root", str(DEFAULT_SEQ_ROOT))

    try:
        exp = load_export(export_path)
        split_map = scan_split(split_root)
        path_map = scan_seq_folders(seq_root)
    except Exception as e:
        st.error(f"Load failed: {e}")
        return

    rows = []
    for aid, split in split_map.items():
        entry = exp["alert_to"].get(aid)
        if entry is None:
            continue
        cls = classify(entry["anno"], split)
        rows.append(
            {
                "alert_api_id": aid,
                "sequence_id": entry["seq"]["id"],
                "camera": entry["seq"].get("camera_name"),
                "recorded_at": entry["seq"].get("recorded_at"),
                "split": split,
                **cls,
                "_anno": entry["anno"],
                "_seq": entry["seq"],
                "_path": path_map.get(aid),
            }
        )

    total = len(rows)
    st.caption(f"{total} sequences loaded")

    with st.sidebar:
        st.header("Filter")
        conf_choice = st.multiselect(
            "Confusion", ["TP", "FP", "FN", "TN"], default=["TP", "FP", "FN", "TN"]
        )
        cat_choice = st.multiselect(
            "Human category",
            ["smoke", "fp", "unsure", "other"],
            default=["smoke", "fp", "unsure", "other"],
        )
        subtypes = sorted({r["human_sub"] for r in rows if r["human_sub"]})
        sub_choice = st.multiselect("Human subtype (optional)", subtypes)

    filtered = [
        r
        for r in rows
        if r["confusion"] in conf_choice
        and r["human_cat"] in cat_choice
        and (not sub_choice or r["human_sub"] in sub_choice)
    ]
    st.subheader(f"Matches: {len(filtered)}")

    counts = {}
    for r in filtered:
        key = (r["confusion"], r["human_cat"], r["human_sub"] or "-")
        counts[key] = counts.get(key, 0) + 1
    if counts:
        with st.expander("Breakdown", expanded=False):
            for (c, h, s), n in sorted(counts.items(), key=lambda x: -x[1]):
                st.write(f"{c} · human={h}/{s} → {n}")

    if not filtered:
        return

    labels = [
        f"[{r['confusion']}] {r['human_cat']}/{r['human_sub'] or '-'} · "
        f"seq-{r['alert_api_id']} · {r['camera']} · {r['recorded_at']}"
        for r in filtered
    ]
    idx = st.selectbox("Sequence", range(len(filtered)), format_func=lambda i: labels[i])
    row = filtered[idx]

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Confusion", row["confusion"])
    c2.metric("Model", row["split"])
    c3.metric("Human", f'{row["human_cat"]}/{row["human_sub"] or "-"}')
    c4.metric("Sequence ID", row["alert_api_id"])

    with st.expander("Annotation JSON"):
        st.json(row["_anno"])

    path = row["_path"]
    if not path or not Path(path).exists():
        st.warning(f"Sequence folder not found for alert_api_id={row['alert_api_id']}")
        return

    img_dir = Path(path) / "images"
    lbl_dir = Path(path) / "labels_predictions"

    detection_boxes: dict[int, list[tuple[float, float, float, float]]] = {}
    for sb in (row["_anno"].get("annotation") or {}).get("sequences_bbox", []):
        for b in sb.get("bboxes", []):
            detection_boxes.setdefault(b["detection_id"], []).append(tuple(b["xyxyn"]))

    st.write(f"Frames in `{img_dir.name}`")
    images = sorted(img_dir.glob("*.jpg"))
    show_preds = st.checkbox("Show model predictions (red)", value=True)
    show_annos = st.checkbox("Show human annotation bboxes (green)", value=True)

    cols_per_row = st.slider("Columns", 1, 5, 3)
    rows_of_imgs = [images[i : i + cols_per_row] for i in range(0, len(images), cols_per_row)]
    for batch in rows_of_imgs:
        cols = st.columns(cols_per_row)
        for col, img_path in zip(cols, batch):
            preds = parse_yolo_label(lbl_dir / (img_path.stem + ".txt")) if show_preds else []
            annos = []
            if show_annos:
                # xyxyn are already normalized; we don't know detection_id per frame,
                # so overlay all bboxes for the sequence on every frame.
                for lst in detection_boxes.values():
                    annos.extend(lst)
            img = draw_frame(img_path, preds, annos)
            col.image(img, caption=img_path.name, use_container_width=True)


if __name__ == "__main__":
    main()
