# One smoke box per detection annotation

Issue: [#286](https://github.com/pyronear/pyro-annotator/issues/286)
Date: 2026-08-06

## Problem

"One object, one box per frame" is true of the data but enforced by nothing on
the server. The localize object editor enforces it client-side (see
`2026-08-05-localize-object-editor-revamp-design.md`), which protects the UI and
nothing else. Import scripts, future bulk-accept paths, and new importers all
write through the API and can reintroduce violations.

## Measurement

Dev database, 2026-08-06:

| detection annotations | non-empty | items | smoke items | rows with >1 smoke box | max smoke boxes/row |
| --------------------- | --------- | ----- | ----------- | ---------------------- | ------------------- |
| 231                   | 119       | 119   | 119         | 0                      | 1                   |

Every committed item today is a smoke box; no false-positive item exists yet.
No migration or backfill is needed.

## The rule

At most one item with a non-null `smoke_type` per detection annotation.

False-positive items (`smoke_type is None`) are uncounted and uncapped: an
annotation may hold one smoke box alongside any number of FP items kept for
traceability. `DetectionAnnotationItem.validate_exactly_one_type` already
guarantees every item is exactly one or the other, so counting non-null
`smoke_type` partitions the list cleanly.

The rule settles a modelling question: a plume that visually forks into two
strands and rejoins is still one fire's smoke, boxed as one box enclosing both
strands. A *persistent* split is a second fire, so a second object — "+ Add
object" handles that.

## Where it lives

A `model_validator(mode="after")` on `DetectionAnnotationData` in
`annotation_api/src/app/schemas/annotation_validation.py`:

```python
class DetectionAnnotationData(BaseModel):
    annotation: List[DetectionAnnotationItem]

    @model_validator(mode="after")
    def validate_at_most_one_smoke_box(self) -> "DetectionAnnotationData":
        smoke_count = sum(1 for i in self.annotation if i.smoke_type is not None)
        if smoke_count > 1:
            raise ValueError(
                f"At most one smoke box is allowed per detection annotation "
                f"(got {smoke_count}). A plume that forks into two strands and "
                "rejoins is one object — box it once. A persistent second plume "
                "is a separate object, with its own annotation track."
            )
        return self
```

`DetectionAnnotationData` is the field type on every schema that carries box
content, so one validator covers every server-side write:

- `POST /annotations/detections/` — `detection_annotations.py:68` builds
  `DetectionAnnotationData` explicitly
- `PATCH /annotations/detections/{id}` — via
  `DetectionAnnotationUpdate.annotation`

The other writers (`sequence_annotations.py:266`, `sequences.py:824`) insert
empty `{"annotation": []}` placeholder rows and are unaffected. The frontend
only ever PATCHes.

### Read path

The validator was deliberately placed on the shared type rather than a
write-only subclass: the invariant is a property of the data, not of the
direction it travels, and splitting the type in two for one rule is complexity
without a caller.

The consequence is that `DetectionAnnotationRead(**row)` validates on the way
out too, so a violating row would turn GET, list, and the paginated endpoints
into 500s. Accepted: nothing writes such a row today, and 0 of 231 existing rows
violate the rule. `GET /export/alerts` reads `det_ann.annotation` as a raw dict
(`_smoke_lane_boxes`, `export.py:93`) and never constructs the schema, so
exports are unaffected either way.

## Error surface

Both write paths already return 422 and neither endpoint needs changing:

- POST already catches `ValidationError` around its explicit construction
  (`detection_annotations.py:67-79`) and re-raises 422 with `e.errors()`; the
  new message flows through the existing handler and its log line.
- PATCH validates `DetectionAnnotationUpdate` as a FastAPI body, so Pydantic
  returns 422 automatically.

## Tests

`src/tests/schemas/test_annotation_validation.py`, in
`TestDetectionAnnotationData`:

- **invert** `test_multiple_annotation_items` (line 301) — it currently asserts
  two smoke items are valid, which is exactly the behavior being removed. It
  becomes a `pytest.raises(ValidationError)` case.
- one smoke box plus several FP items → valid
- several FP items with no smoke box → valid
- keep the existing single-item and empty-list cases

`src/tests/endpoints/test_detection_annotations.py`:

- POST with two smoke boxes → 422
- PATCH with two smoke boxes → 422

The endpoint tests are what prove the rule reaches the wire, which is the point
of the issue.

## Out of scope

The sequence-annotation side carries a sibling invariant — at most one box per
`detection_id` within a single `SequenceBBox`. Measured the same day: 0
violations across 9,987 boxes in 469 objects, over 475 annotations.

It is not enforced here because it is not just a validator.
`cluster_boxes_by_iou` (`annotation_generation.py:207-230`) pops boxes off a
flat cross-frame list of `(bbox, detection_id)` pairs and merges any pair over
the IoU threshold, never consulting `detection_id`. Two overlapping engine
predictions on the same frame will land in the same cluster. Enforcing the rule
would turn a currently-succeeding request into a 422 for a case that genuinely
occurs, so it first needs a decision on which same-frame box wins. Tracked as a
follow-up issue.
