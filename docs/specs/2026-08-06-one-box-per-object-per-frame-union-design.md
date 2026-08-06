# One box per object per frame

Issue: [#324](https://github.com/pyronear/pyro-annotator/issues/324)
Date: 2026-08-06

## Problem

`cluster_objects` can attach two boxes from the same frame to one object. Nothing
forbids it, in either path that adds members:

- **Attach** (`object_clustering.py:178-186`) — box A on frame F joins object O,
  which makes `O.last_box` A's box. Box B on the same frame is then tested
  against A, and if they overlap it joins O too. Nothing compares
  `image_filename`.
- **Spawn** (`object_clustering.py:188-200`) — `window` gathers pending
  detections overlapping `det.box`, so two same-frame boxes both pending and
  overlapping spawn an object holding both.

Both are made likelier by `bboxes_overlap` (`object_clustering.py:80`) being a
bare strictly-positive-intersection test ported from pyro-api, with no IoU
threshold: boxes that merely graze count as overlapping.

Everything downstream assumes one object holds at most one box per frame.
`own_by_frame[key]` becomes `detection_bboxes` becomes the detection's
`algo_predictions`, and the localize accept path turns every one of those into a
committed smoke box. Since #286, a second smoke box on a detection annotation is
a 422.

## Measurement

Local DB, 2026-08-06, after importing three windows of production alert-API
data: **19,205 detections across 984 sequences**.

| metric | value |
| --- | --- |
| detections with ≥2 own boxes (`algo_predictions`) | **1** (0.005%) |
| max own boxes | 2 |
| frames carrying sibling boxes (`others_bboxes`) | 2,793 |
| frames with 2+ siblings | 408 |
| max boxes on a single frame | 4 |

The one occurrence is **detection 19167** — sequence 1018, alert `41386`, camera
`brison-01`, recorded 2026-05-11 05:09:57Z:

```
A = [0.102, 0.565, 0.113, 0.586]
B = [0.107, 0.564, 0.119, 0.584]
```

They overlap in both axes and are near-duplicates of one small plume.
`others_bboxes` is null, so both are the object's own boxes. The lane sits at
`READY_TO_ANNOTATE` with `has_smoke = true` and an empty `auto_predictions`, so
the engine layer wins and bulk-accepting it will 422.

Note that an earlier 10,268-detection sample showed **zero** occurrences. The
counterexample only appeared after widening to 19,205 — a reminder that one
import window is not enough to conclude an invariant holds.

## The rule

Within one object, all boxes on the same frame collapse to the single box
enclosing them, carrying the highest confidence of the group.

This is #286's modelling rule applied one layer up: a plume that visually forks
into two strands and rejoins is still one fire's smoke, boxed as one box
enclosing both strands. A *persistent* split is a second fire, which the
clustering already separates into its own object.

Confidence is taken as the max rather than the mean or the first: a third of
engine boxes (6,249 of 19,155) carry `confidence: 0.0`, including both boxes on
detection 19167, so any confidence-weighted rule is degenerate on a large slice
of real data. Max is the "best evidence available" reading and is stable.

## Where it lives

In `object_split.py`, immediately after `own_by_frame` is built
(`object_split.py:178-180`):

```python
own_by_frame: Dict[str, List[List[float]]] = {}
for member in obj.members:
    own_by_frame.setdefault(member.image_filename, []).append(member.box)

# One object, one box per frame. A plume the detector split into two
# overlapping boxes on one frame is still one plume, boxed as the box
# enclosing both (see the #286 modelling note).
for key, boxes in own_by_frame.items():
    if len(boxes) > 1:
        own_by_frame[key] = [union_boxes(boxes)]
```

with:

```python
def union_boxes(boxes: List[List[float]]) -> List[float]:
    """Enclosing box of several same-frame boxes of one object, carrying the
    highest confidence of the group."""
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
        max(b[4] for b in boxes),
    ]
```

### Why not in `cluster_objects`

The ticket points at `cluster_objects`, and the invariant is arguably a property
of the object model. But `select_primary_index` (`object_split.py:96-111`)
identifies bbox-sourced members by exact coordinates:

```python
if (m.image_filename, tuple(m.box[:4])) in primary_keys
```

`primary_keys` holds the original coordinates from `detection_bboxes`. A unioned
box matches **neither** original, so merging inside `cluster_objects` would drop
that frame's bbox-sourced count and could flip which object is selected as
primary — which decides which lane keeps the alert's real `alert_api_id` and
which gets a synthetic one. That trades a rare box bug for a rarer identity bug
that is harder to notice.

Collapsing in `own_by_frame` runs *after* `select_primary_index` (called at
`object_split.py:162`), so lane identity is untouched.

The cost is that `TrackedObject.members` can still hold two members for one
frame. Consequences are contained: `member_keys` is `sorted(own_by_frame)`, so
frame keys are already unique; `object_cone_azimuth` uses `members[0]`. The
remaining leak is `boxes_by_frame`, which feeds `others_bboxes` — a duplicate
member means another object's sibling list carries both boxes, a read-only
display artifact.

### The fallback path is deliberately exempt

When `split_sequence_records` raises, `split_all_records` imports the sequence
whole (`records=[dict(r) for r in seq_records]`), bypassing the merge. That is
correct, not an oversight: a fallback sequence was never split into objects, so
the several boxes on one of its frames may belong to *different* plumes. Unioning
them there would merge distinct objects into one box — strictly worse than
leaving them alone.

So the guarantee this design establishes is scoped: **every successfully split
object holds at most one box per frame**. A fallback sequence can still carry a
frame with several boxes, and downstream that still means a detection with
several `algo_predictions`. Fallbacks are already counted in
`split_stats['fallback_sequences']` and were 0 across the 352-sequence
verification window.

### Box shape

`build_frames` filters boxes at `len(b) >= 5`, so a box is at least
`[x1, y1, x2, y2, conf]`. `union_boxes` returns exactly 5 elements, dropping
anything beyond index 4. That is safe: `parse_alert_api_bboxes`
(`shared.py:238-243`) is the only consumer of `detection_bboxes` and reads
`bbox[:4]` as coordinates and `bbox[4]` as confidence, ignoring the rest.

## Visibility

A silent merge is how this stayed invisible across 19,205 detections. Add a
`same_frame_merges` counter to the `split_stats` dict returned by
`split_all_records`, and surface it in the existing import summary line
(`import.py:520-524`) next to the sibling and cross-dedup counts.

## Tests

In `src/tests/scripts/test_object_clustering.py`, which already provides
`make_frames`, `BOX_A`, and `BOX_B`:

1. **Real-data regression** — detection 19167's two boxes verbatim as a fixture;
   assert the object yields one box on that frame equal to
   `[0.102, 0.564, 0.119, 0.586]`. This is the shape production actually
   produced, not an invented one.
2. **Union helper** — a single box passes through unchanged; confidence is the
   max of the group; three boxes enclose all three.
3. **Unchanged behavior** — the existing
   `test_two_disjoint_box_groups_form_two_objects` must stay green. The union
   applies only within one object, so two disjoint boxes still form two objects.

## End-to-end verification

Re-running the May import alone will *not* exercise the fix: sequence 1018 is
already imported and would be skipped. Verification needs the alert re-ingested
— either delete the sequences for alert `41386` and re-import
`2026-05-10..2026-05-24`, or import that window into a fresh database. Then:

```sql
SELECT count(*) FROM detections
WHERE jsonb_array_length(algo_predictions->'predictions') >= 2;
```

This currently returns 1 and must return 0.

## Out of scope

Detection 19167 is already written and this change does not repair it, so
bulk-accepting sequence 1018 still 422s. That is left to #319, which caps the
accept payload and handles any pre-existing row generically rather than
special-casing one.

The auto layer has the same absence of a per-frame cap —
`worker.py`'s `keep_boxes_overlapping` retains every sensitive-model box
overlapping the anchor. It measures max 1 today, but across only 312 frames.
Also #319.
