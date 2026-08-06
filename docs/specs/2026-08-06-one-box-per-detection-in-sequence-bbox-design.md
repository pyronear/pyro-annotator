# One box per detection within a sequence bbox

Issue: [#315](https://github.com/pyronear/pyro-annotator/issues/315)
Date: 2026-08-06

## Problem

A `SequenceBBox` is one object's track across a sequence: a list of
`BoundingBox`, each carrying a `detection_id`. It should hold at most one box
per `detection_id` — the same "one object, one box per frame" rule that #286
enforces one layer down on detection annotations, and that #324 enforces one
layer up in the importer.

Nothing enforces it. `SequenceBBox`
(`annotation_api/src/app/schemas/annotation_validation.py:60`) declares a bare
`bboxes: List[BoundingBox]`.

The validator cannot be added on its own, because the API can produce the
violation itself. When a client POSTs or PATCHes a sequence annotation with an
empty `sequences_bbox`, `AnnotationGenerationService` fills it in:

- `cluster_boxes_by_iou` (`annotation_generation.py:175-230`) pops boxes off a
  flat cross-frame list of `(bbox, detection_id)` pairs and merges any pair
  whose IoU exceeds the threshold. It never consults `detection_id`.
- `_create_sequence_bboxes` (`annotation_generation.py:472-509`) then emits one
  `BoundingBox` per cluster member, with no per-detection cap.

So two overlapping engine predictions on the same frame land in one cluster and
become two boxes with the same `detection_id`. Adding the validator alone would
turn a currently-succeeding request into a 422 for a case that genuinely
occurs.

## Measurement

Dev database, 2026-08-06: **zero violations** — 9,987 boxes across 469 objects
with boxes, over 475 sequence annotations. No `(annotation, object,
detection_id)` triple appears twice.

The underlying same-frame overlap is nonetheless real. #324 found **1 of 19,205
detections** carrying two own boxes: detection `19167`, sequence 1018, alert
`41386`, camera `brison-01`, 2026-05-11 05:09:57Z, two near-duplicate boxes of
one small plume:

```
A = [0.102, 0.565, 0.113, 0.586]
B = [0.107, 0.564, 0.119, 0.584]
```

An earlier 10,268-detection sample showed zero and was misleading. The dev-DB
zero above is the same kind of evidence, so it is re-checked as a pre-merge gate
rather than trusted (see Rollout).

## The rule

**Within one `SequenceBBox`, a `detection_id` appears at most once. When a frame
contributes several boxes to one object, they collapse to the single box
enclosing them.**

This is #286's modelling rule at the sequence layer: a plume that forks into two
strands and rejoins is one object, boxed once. A persistent second plume is a
separate object with its own track.

Confidence does not enter here. `_create_sequence_bboxes` receives only
`(bbox, detection_id)` — `_cluster_temporal_bboxes` drops the prediction dict
before clustering — and `BoundingBox` has no confidence field. The importer's
`union_boxes` does carry confidence, as the group max, because 6,249 of 19,155
real engine boxes have `confidence: 0.0` and any weighted rule is degenerate on
a third of the data.

## Design

Three files. No new modules.

### 1. Shared union geometry

Add to `annotation_generation.py`, beside the existing `box_iou` (line 43):

```python
def union_xyxyn(boxes: List[List[float]]) -> List[float]:
    """Enclosing box of several boxes, in normalized xyxy."""
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]
```

`object_split.union_boxes` (`object_split.py:122`) delegates its four
coordinates and keeps the confidence max:

```python
def union_boxes(boxes: List[List[float]]) -> List[float]:
    return [*union_xyxyn(boxes), max(b[4] for b in boxes)]
```

The import direction is already established — `object_split.py:32` imports from
`app.schemas.annotation_validation`. The docstring and the #331 rationale
comment stay on `union_boxes`; behavior is unchanged, and its existing tests
(`src/tests/scripts/test_object_split.py:104-118`) are the regression net.

### 2. Collapse at emission

In `_create_sequence_bboxes`, group each cluster's members by `detection_id`
and emit one box per id:

```python
for cluster in bbox_clusters:
    valid: Dict[int, List[List[float]]] = {}
    for bbox_coords, detection_id in cluster:
        try:
            box = BoundingBox(detection_id=detection_id, xyxyn=bbox_coords)
        except Exception as e:
            self.logger.debug(
                f"Skipping invalid coordinates for detection {detection_id}: {e}"
            )
            continue
        valid.setdefault(box.detection_id, []).append(box.xyxyn)

    bboxes = [
        BoundingBox(
            detection_id=detection_id,
            xyxyn=union_xyxyn(coords) if len(coords) > 1 else coords[0],
        )
        for detection_id, coords in valid.items()
    ]
```

**Validate before unioning, not after.** The obvious shape — group raw
coordinates, union, then construct — is wrong: a frame carrying a valid box and
a `[0, 0, 0, 0]` null box would union to a box anchored at the origin, silently
inventing a huge plume out of a detection failure. Constructing each raw box
first keeps the existing per-box rejection, and only survivors reach the union.

The second construction cannot raise: a union of valid boxes lies within
`[0, 1]`, has `x1 <= x2` and `y1 <= y2`, and encloses a non-zero-area box, so it
is non-zero-area itself.

Insertion order of `valid` preserves each `detection_id`'s first appearance, so
clusters with no duplicates emit exactly the boxes they emit today, in the same
order.

**Placement.** After clustering, not inside it. `cluster_boxes_by_iou` stays a
pure geometric utility with its documented contract and doctests intact, and
`_cluster_temporal_bboxes`'s `min_cluster_size` filter keeps counting pre-merge
members — so a merge can never silently drop a cluster below the threshold.
This mirrors #331's placement finding one layer up, where merging inside
`cluster_objects` would have broken `select_primary_index`'s
exact-coordinate matching.

The existing per-box `try/except` that skips invalid coordinates is preserved,
now wrapping the merged box.

### 3. The validator

```python
    @model_validator(mode="after")
    def validate_one_box_per_detection(self) -> "SequenceBBox":
        """One object, one box per frame."""
        counts = Counter(b.detection_id for b in self.bboxes)
        repeated = sorted(d for d, n in counts.items() if n > 1)
        if repeated:
            raise ValueError(
                f"At most one box is allowed per detection within a sequence "
                f"bbox (detection_id repeated: {repeated}). A plume that forks "
                "into two strands and rejoins is one object — box it once. A "
                "persistent second plume is a separate object, with its own "
                "annotation track."
            )
        return self
```

`Counter` needs importing into `annotation_validation.py`; the module currently
imports only from `enum`, `typing`, `pydantic`, and `app.models`.

Same shape as #318's `DetectionAnnotationData.validate_at_most_one_smoke_box`,
and the message carries the same modelling explanation rather than a bare count.
It raises rather than coercing: a silent merge is how #324 hid across 19,205
detections.

### Ordering

The service fix (2) lands before the validator (3). Reversed, the generation
service 422s on its own output for the case this spec documents.

## Read-path exposure

`SequenceAnnotationRead.annotation` is a `SequenceAnnotationData`
(`sequence_annotations.py:197`), and `crud_sequence_annotation.py:127`
reconstructs `SequenceAnnotationData(**annotation_data)` from stored JSON. So
the validator runs on reads too: a pre-existing violating row would raise on GET
(a 500) rather than only rejecting new writes.

This is the same exposure #318 accepted for detection annotations, where
`DetectionAnnotationData` is likewise the read model. It is acceptable here on
the same terms, guarded by the pre-merge count below.

## Testing

- `union_xyxyn` unit tests: single box returns its own coordinates; two
  overlapping boxes return the enclosing box; a box fully containing another
  returns the container.
- `_create_sequence_bboxes`: a cluster holding two boxes with the same
  `detection_id` yields one `BoundingBox` whose `xyxyn` is the union; a cluster
  with distinct ids is unchanged; a null `[0, 0, 0, 0]` box sharing a
  `detection_id` with a valid box is dropped before the union rather than
  dragging it to the origin.

  The six existing `_create_sequence_bboxes` tests
  (`src/tests/services/test_annotation_generation.py:116-289`) all use distinct
  `detection_id`s per cluster and must stay green unmodified — including their
  exact `mock_logger.debug.call_count` assertions, which the validate-first
  ordering preserves.
- `SequenceBBox` validator: a duplicate `detection_id` raises; distinct ids
  pass; an empty `bboxes` list passes.
- End-to-end: POST a sequence annotation with an empty `sequences_bbox` for a
  sequence whose detections carry same-frame overlapping predictions, and assert
  201 rather than 422.

Detection 19167's coordinates are the shared fixture across the unit and
validator tests:

```
[0.102, 0.565, 0.113, 0.586] ∪ [0.107, 0.564, 0.119, 0.584]
                             = [0.102, 0.564, 0.119, 0.586]
```

## Rollout

Before merging, re-run the violation count from the Measurement section against
the target database. The 2026-08-06 zero is a point-in-time sample of the same
kind that misled #324 at 10,268 detections.

If it comes back non-zero, this branch does not merge as-is: repairing existing
rows is its own ticket, not scope here.

## Out of scope

- **#319** — bulk accept can still send more than one smoke box per frame, and
  `worker.py`'s `keep_boxes_overlapping` has the same missing per-frame cap on
  the auto layer. Separate issue, unchanged by this work.
- **Repair of existing rows.** No migration. See Rollout.
- **`cluster_boxes_by_iou`'s IoU-blind clustering across frames.** Merging
  distinct plumes into one cluster is a different problem from emitting two
  boxes for one frame, and is not addressed here.
