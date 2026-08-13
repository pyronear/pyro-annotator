"""
Render QA contact sheets from a dataset produced by
``scripts.data_transfer.export.export_alerts``: one PNG per exported object
(lane), plus a combined PNG per multi-object alert, so annotations can be
eyeballed against the annotator UI.

Each sheet lays the object's frames out in time order. A cell stacks the full
frame with the exported box(es) drawn, a magnified crop of the box region, and
a caption naming the detection id. The crop row is what makes the sheets
usable: boxes are typically ~0.05% of the frame area, invisible once a 1280x720
frame is scaled to a grid cell.

For a multi-object alert every lane draws on the same image in its own colour.
Sibling lanes hold their own copies of one capture (distinct detection ids and
usually distinct bucket_keys), so frames are aligned across lanes by exact
``recorded_at``; each lane still gets its own zoom panel, because a crop around
the union of two objects at opposite ends of the frame just reproduces the
frame.

Example:
uv run python -m scripts.data_transfer.export.render_overlays \
  --dataset-dir outputs/alerts_export --fp-sample 40 --loglevel info
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

FULL_W, FULL_H = 400, 225
CROP_W, CROP_H = 400, 225
CAPTION_H = 22
CELL_H = FULL_H + CROP_H + CAPTION_H
MAX_COLS = 5
HEADER_H = 56
# Crop window = box size * this, so the box fills about a third of the panel.
CROP_CONTEXT = 3.0
# A box narrower than this many pixels is drawn at this size on the full frame,
# or a horizon-sized detection would be a single invisible pixel.
MIN_BOX_PX = 8

LANE_COLORS = [
    (255, 70, 70),
    (70, 200, 255),
    (140, 255, 120),
    (255, 0, 255),
    (255, 210, 0),
]
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _load_font(path: str, size: int) -> Any:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        logger.warning("Font %s unavailable, falling back to the default", path)
        return ImageFont.load_default()


FONT = _load_font(FONT_PATH, 13)
FONT_BOLD = _load_font(FONT_BOLD_PATH, 17)


def slug(text: str) -> str:
    """Filename-safe camera name."""
    return re.sub(r"[^A-Za-z0-9_-]+", "-", text).strip("-")


def lane_types(obj: Dict[str, Any]) -> List[str]:
    """The types that describe the lane, whichever kind it is."""
    if obj["record_kind"] == "smoke":
        return list(obj["smoke_types"])
    return list(obj["false_positive_types"])


def draw_full(
    img: Image.Image, entries: List[Tuple[Tuple[int, int, int], Any]]
) -> Image.Image:
    """Frame scaled to a cell, every lane's boxes drawn at a visible minimum."""
    cell = img.resize((FULL_W, FULL_H))
    d = ImageDraw.Draw(cell)
    for color, box in entries:
        x1, y1, x2, y2 = box["xyxyn"]
        cx, cy = (x1 + x2) / 2 * FULL_W, (y1 + y2) / 2 * FULL_H
        half_w = max((x2 - x1) * FULL_W / 2, MIN_BOX_PX / 2)
        half_h = max((y2 - y1) * FULL_H / 2, MIN_BOX_PX / 2)
        d.rectangle(
            [cx - half_w, cy - half_h, cx + half_w, cy + half_h],
            outline=color,
            width=2,
        )
    return cell


def lane_panel(
    img: Image.Image,
    color: Tuple[int, int, int],
    seq_id: int,
    boxes: List[Dict[str, Any]],
    panel_w: int,
) -> Image.Image:
    """One lane's zoom panel: a crop around ITS boxes, drawn at true scale."""
    if not boxes:
        panel = Image.new("RGB", (panel_w, CROP_H), (30, 30, 30))
        d = ImageDraw.Draw(panel)
        d.text(
            (6, CROP_H // 2 - 8), f"{seq_id}: no box", fill=(180, 180, 180), font=FONT
        )
        d.rectangle([0, 0, panel_w - 1, CROP_H - 1], outline=color, width=2)
        return panel

    w, h = img.size
    xs = [v for b in boxes for v in (b["xyxyn"][0], b["xyxyn"][2])]
    ys = [v for b in boxes for v in (b["xyxyn"][1], b["xyxyn"][3])]
    x1, x2, y1, y2 = min(xs) * w, max(xs) * w, min(ys) * h, max(ys) * h
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2

    # Window keeps the panel's aspect ratio, is never larger than the frame,
    # and never so tight that a small box loses its surroundings.
    win_w = max((x2 - x1) * CROP_CONTEXT, 100)
    win_h = max((y2 - y1) * CROP_CONTEXT, 100 * CROP_H / panel_w)
    win_w = min(max(win_w, win_h * panel_w / CROP_H), w)
    win_h = min(win_w * CROP_H / panel_w, h)
    win_w = win_h * panel_w / CROP_H

    left = min(max(cx - win_w / 2, 0), max(w - win_w, 0))
    top = min(max(cy - win_h / 2, 0), max(h - win_h, 0))
    region = img.crop(
        (int(left), int(top), int(left + win_w), int(top + win_h))
    ).resize((panel_w, CROP_H))
    scale = panel_w / win_w

    d = ImageDraw.Draw(region)
    for box in boxes:
        bx1, by1, bx2, by2 = box["xyxyn"]
        d.rectangle(
            [
                (bx1 * w - left) * scale,
                (by1 * h - top) * scale,
                (bx2 * w - left) * scale,
                (by2 * h - top) * scale,
            ],
            outline=color,
            width=2,
        )
    zoom = f"x{scale:.0f}" if scale >= 10 else f"x{scale:.1f}"
    d.text((4, 2), f"{seq_id}  {zoom}", fill=color, font=FONT)
    d.rectangle([0, 0, panel_w - 1, CROP_H - 1], outline=color, width=2)
    return region


def open_backdrop(
    dataset_dir: Path, per_lane: Dict[int, Dict[str, Any]]
) -> Optional[Image.Image]:
    """Decode some lane's copy of this capture, or None if none can be read.

    Sibling lanes hold their own copies of one capture, so any of them serves
    as the backdrop; lanes are tried in sequence-id order so the pick is
    stable, and a lane whose copy is missing or corrupt simply yields to the
    next. Two ways a copy is unusable: the exporter writes image_path null for
    a download it could not complete, and a download that produced a truncated
    file is never retried (its idempotency check is mere existence).
    """
    for _seq_id, frame in sorted(per_lane.items()):
        path = frame.get("image_path")
        if not path:
            continue
        try:
            # convert() forces the decode, so a truncated file fails here
            # rather than later mid-render.
            return Image.open(dataset_dir / path).convert("RGB")
        except (OSError, ValueError) as exc:
            logger.warning("Unusable image %s: %s", path, exc)
    return None


def render_sheet(
    dataset_dir: Path,
    item: Dict[str, Any],
    lanes: List[Dict[str, Any]],
    out_path: Path,
) -> bool:
    """One sheet covering `lanes` of `item`, frames aligned by recorded_at.

    Returns whether a sheet was written: an alert whose images are all missing
    or corrupt yields nothing, and the caller must not index a file that does
    not exist.
    """
    if len(lanes) > len(LANE_COLORS):
        logger.warning(
            "alert %s has %d lanes but only %d distinct colours; some lanes "
            "share one on the full-frame row",
            item["platform_alert_id"],
            len(lanes),
            len(LANE_COLORS),
        )
    colors = {
        obj["sequence_id"]: LANE_COLORS[i % len(LANE_COLORS)]
        for i, obj in enumerate(lanes)
    }
    lane_order = [obj["sequence_id"] for obj in lanes]
    panel_w = CROP_W // len(lanes)

    by_time: Dict[str, Dict[int, Dict[str, Any]]] = collections.defaultdict(dict)
    for obj in lanes:
        for frame in obj["frames"]:
            by_time[frame["recorded_at"]][obj["sequence_id"]] = frame

    # Build every cell first, decoding each capture exactly once: the grid can
    # only be sized once the unreadable captures are known.
    cells: List[Tuple[Image.Image, Image.Image, str]] = []
    for timestamp in sorted(by_time):
        per_lane = by_time[timestamp]
        img = open_backdrop(dataset_dir, per_lane)
        if img is None:
            continue
        entries = [
            (colors[seq_id], box)
            for seq_id, frame in sorted(per_lane.items())
            for box in frame["boxes"]
        ]
        crop_row = Image.new("RGB", (CROP_W, CROP_H), (12, 12, 12))
        for panel_i, seq_id in enumerate(lane_order):
            frame = per_lane.get(seq_id)
            if frame is None:
                panel = Image.new("RGB", (panel_w, CROP_H), (24, 24, 24))
                pd = ImageDraw.Draw(panel)
                pd.text(
                    (6, CROP_H // 2 - 8),
                    f"{seq_id}: no frame",
                    fill=(140, 140, 140),
                    font=FONT,
                )
                pd.rectangle([0, 0, panel_w - 1, CROP_H - 1], outline=(80, 80, 80))
            else:
                panel = lane_panel(img, colors[seq_id], seq_id, frame["boxes"], panel_w)
            crop_row.paste(panel, (panel_i * panel_w, 0))
        present = ", ".join(
            f"{seq_id}:{len(f['boxes'])}b/det{f['detection_id']}"
            for seq_id, f in sorted(per_lane.items())
        )
        cells.append(
            (draw_full(img, entries), crop_row, f"{timestamp[11:19]}  {present}")
        )

    dropped = len(by_time) - len(cells)
    if dropped:
        logger.warning(
            "alert %s: skipped %d capture(s) with no usable image",
            item["platform_alert_id"],
            dropped,
        )
    if not cells:
        logger.warning(
            "alert %s: nothing to render for lanes %s",
            item["platform_alert_id"],
            lane_order,
        )
        return False

    cols = min(MAX_COLS, len(cells))
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * FULL_W, HEADER_H + rows * CELL_H), (12, 12, 12))
    d = ImageDraw.Draw(sheet)

    d.text(
        (8, 6),
        f"alert {item['platform_alert_id']} | {item['camera_name']} "
        f"({item['organisation_name']}) | {len(lanes)} object(s) | "
        f"{len(cells)} captures | "
        f"{item['recorded_at'][:19].replace('T', ' ')} UTC",
        fill=(235, 235, 235),
        font=FONT_BOLD,
    )
    x = 10
    for obj in lanes:
        color = colors[obj["sequence_id"]]
        # Swatch drawn rather than a filled-square glyph: the fallback font
        # has no such glyph.
        d.rectangle([x, 34, x + 9, 43], fill=color)
        text = (
            f"seq {obj['sequence_id']}: {obj['record_kind']} "
            f"{','.join(lane_types(obj)) or '-'} ({len(obj['frames'])} frames)"
        )
        d.text((x + 15, 32), text, fill=color, font=FONT)
        x += int(d.textlength(text, font=FONT)) + 37

    for i, (full, crop_row, caption) in enumerate(cells):
        cx = (i % cols) * FULL_W
        cy = HEADER_H + (i // cols) * CELL_H
        sheet.paste(full, (cx, cy))
        sheet.paste(crop_row, (cx, cy + FULL_H))
        d.rectangle(
            [cx, cy + FULL_H + CROP_H, cx + FULL_W, cy + CELL_H], fill=(20, 20, 20)
        )
        d.text(
            (cx + 4, cy + FULL_H + CROP_H + 4),
            f"#{i + 1} {caption}",
            fill=(200, 200, 200),
            font=FONT,
        )
        d.line([cx, cy, cx, cy + CELL_H], fill=(60, 60, 60))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
    logger.info("Wrote %s (%d captures)", out_path, len(cells))
    return True


def select_lanes(
    items: List[Dict[str, Any]], fp_sample: int
) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """Every smoke lane, plus FP lanes sampled round-robin across type combos.

    Round-robin rather than head-of-list so the sample spans all false-positive
    type combinations before it deepens any one of them; alerts are taken in id
    order so the selection is reproducible.
    """
    smoke: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    fp_by_type: Dict[str, List[Tuple[Dict[str, Any], Dict[str, Any]]]] = (
        collections.defaultdict(list)
    )
    for item in items:
        for obj in item["objects"]:
            if obj["record_kind"] == "smoke":
                smoke.append((item, obj))
            else:
                fp_by_type[",".join(obj["false_positive_types"]) or "-"].append(
                    (item, obj)
                )

    for pairs in fp_by_type.values():
        pairs.sort(key=lambda pair: pair[0]["platform_alert_id"])

    limit = sum(len(v) for v in fp_by_type.values()) if fp_sample <= 0 else fp_sample
    fp: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    depth = 0
    while len(fp) < limit:
        added = False
        for key in sorted(fp_by_type):
            if depth < len(fp_by_type[key]) and len(fp) < limit:
                fp.append(fp_by_type[key][depth])
                added = True
        if not added:
            break
        depth += 1

    logger.info(
        "Selected %d smoke lanes and %d of %d false-positive lanes "
        "(%d distinct type combinations)",
        len(smoke),
        len(fp),
        sum(len(v) for v in fp_by_type.values()),
        len(fp_by_type),
    )
    return smoke + fp


def load_manifest(
    dataset_dir: Path, alerts: Optional[Sequence[int]]
) -> List[Dict[str, Any]]:
    wanted = set(alerts or ())
    items = []
    with (dataset_dir / "manifest.jsonl").open(encoding="utf-8") as fh:
        for line in fh:
            item = json.loads(line)
            if not wanted or item["platform_alert_id"] in wanted:
                items.append(item)
    return items


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render QA contact sheets from an exported alert dataset"
    )
    parser.add_argument(
        "--dataset-dir",
        type=Path,
        default=Path("outputs/alerts_export"),
        help="Dataset directory holding manifest.jsonl and images/",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Where to write sheets (default: <dataset-dir>/overlays)",
    )
    parser.add_argument(
        "--mode",
        default="both",
        choices=["objects", "multi", "both"],
        help="Per-object sheets, combined multi-object sheets, or both",
    )
    parser.add_argument(
        "--fp-sample",
        type=int,
        default=40,
        help="How many false-positive lanes to render as per-object sheets, "
        "0 for all. Every smoke lane is always rendered, and this does not "
        "bound --mode multi, which covers every multi-object alert; use "
        "--alerts to bound the run itself",
    )
    parser.add_argument(
        "--alerts",
        type=int,
        nargs="*",
        help="Restrict to these platform_alert_ids",
    )
    parser.add_argument(
        "--loglevel",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=args.loglevel.upper(),
        format="%(asctime)s - %(levelname)s - %(message)s",
    )
    out_dir = args.output_dir or args.dataset_dir / "overlays"
    items = load_manifest(args.dataset_dir, args.alerts)
    logger.info("Loaded %d alerts from %s", len(items), args.dataset_dir)

    rows: List[Dict[str, Any]] = []

    if args.mode in ("objects", "both"):
        for item, obj in select_lanes(items, args.fp_sample):
            name = (
                f"alert{item['platform_alert_id']}_seq{obj['sequence_id']}"
                f"_{slug(item['camera_name'])}.png"
            )
            path = out_dir / obj["record_kind"] / name
            if not render_sheet(args.dataset_dir, item, [obj], path):
                continue
            rows.append(
                {
                    "sheet": str(path.relative_to(out_dir)),
                    "record_kind": obj["record_kind"],
                    "platform_alert_id": item["platform_alert_id"],
                    "sequence_id": obj["sequence_id"],
                    "camera_name": item["camera_name"],
                    "organisation": item["organisation_name"],
                    "types": ";".join(lane_types(obj)),
                    "frames": len(obj["frames"]),
                    "boxes": sum(len(f["boxes"]) for f in obj["frames"]),
                    "recorded_at": item["recorded_at"][:19],
                }
            )

    if args.mode in ("multi", "both"):
        for item in items:
            lanes = item["objects"]
            if len(lanes) < 2:
                continue
            name = (
                f"alert{item['platform_alert_id']}_{slug(item['camera_name'])}"
                f"_{len(lanes)}objects.png"
            )
            path = out_dir / "multi_object" / name
            if not render_sheet(args.dataset_dir, item, lanes, path):
                continue
            rows.append(
                {
                    "sheet": str(path.relative_to(out_dir)),
                    "record_kind": "+".join(o["record_kind"] for o in lanes),
                    "platform_alert_id": item["platform_alert_id"],
                    "sequence_id": ";".join(str(o["sequence_id"]) for o in lanes),
                    "camera_name": item["camera_name"],
                    "organisation": item["organisation_name"],
                    "types": " vs ".join(",".join(lane_types(o)) or "-" for o in lanes),
                    "frames": sum(len(o["frames"]) for o in lanes),
                    "boxes": sum(len(f["boxes"]) for o in lanes for f in o["frames"]),
                    "recorded_at": item["recorded_at"][:19],
                }
            )

    out_dir.mkdir(parents=True, exist_ok=True)
    index = out_dir / "index.csv"
    with index.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "sheet",
                "record_kind",
                "platform_alert_id",
                "sequence_id",
                "camera_name",
                "organisation",
                "types",
                "frames",
                "boxes",
                "recorded_at",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    logger.info("Wrote %d sheets and %s", len(rows), index)


if __name__ == "__main__":
    main()
