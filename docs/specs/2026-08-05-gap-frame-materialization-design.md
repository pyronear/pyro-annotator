# Drawing on frames outside an object's detected range

Date: 2026-08-05
Status: implemented
Issue: #287

## Problem

A lane holds Detection rows only for the frames where its object was detected
(`object_split.py:198` builds each object's records from `own_by_frame`). When
the detector first picks a plume up late, the earlier frames — where it was
visible but fainter — are not part of that object. On the development database
35 of 475 lanes (7.4%) cover fewer frames than their alert, missing 12.6
frames on average.

Since the editor revamp
(`docs/specs/2026-08-05-localize-object-editor-revamp-design.md`), those
frames are *viewable*: the filmstrip spans the alert's full range, a gap frame
borrows a sibling lane's photo (same `recorded_at`, same photograph), renders
an out-of-range banner, and disables drawing. This spec makes them
**drawable**: drawing on a gap frame materializes a Detection row in the lane
and saves the box, in one flow.

## Decisions taken

- **Implicit materialization.** Drag-to-draw simply works on a gap frame. No
  "add frame" button; committing the drawn box materializes the row. The
  banner softens to say drawing will add this frame to the object.
- **Two orchestrated calls, not one atomic endpoint.** The backend gains a
  minimal frame-materialization endpoint; the box then flows through the
  existing `saveDetectionReview` path unchanged. A failure between the calls
  leaves a boxless in-object frame — already a first-class, visible,
  retryable state.
- **Un-materialize on clear.** Clearing or deleting the box on a
  model-evidence-free frame deletes the Detection row; the frame reverts to a
  gap. Symmetric, self-healing, no stuck states.

## Backend

Two additive endpoints on the sequences router. Both use `get_current_user`,
matching `add_object` (`sequences.py:684`), whose insert this narrows to one
frame.

### `POST /api/v1/sequences/{sequence_id}/frames`

Request `{ recorded_at: datetime }` → 201 `DetectionRead`.

1. 404 if the sequence does not exist.
2. Find a Detection at exactly that `recorded_at` in a sibling lane (same
   `source_api` + `platform_alert_id`). 422 if none — only frames the alert
   actually has can be materialized.
3. If this lane already has a Detection at that `recorded_at`, return it with
   200 — idempotent, so a double-fire or a stale client is not an error.
4. Insert and return:

   ```
   Detection(sequence_id=sequence_id,
             recorded_at=recorded_at,
             bucket_key=sibling.bucket_key,      # shared S3 object, no copy
             alert_api_id=sibling.alert_api_id,
             algo_predictions={"predictions": []})
   ```

   The same field set `add_object` copies (`sequences.py:769–780`);
   `auto_predictions` and `others_bboxes` stay null — the sibling's model
   evidence belongs to *its* object, not this one.
5. An IntegrityError against `uq_detection_sequence_alert_api_id` → 409.

No `DetectionAnnotation` is seeded: `saveDetectionReview` already creates one
when none exists, and `add_object`'s `BBOX_ANNOTATION` seeding exists to feed
a different flow.

### `DELETE /api/v1/sequences/{sequence_id}/frames/{detection_id}`

→ 204. The un-materialize.

- 404 if the detection does not exist or does not belong to the sequence.
- 409 unless the detection is **model-evidence-free**: `algo_predictions` and
  `auto_predictions` both empty or null. An imported frame's engine track —
  the record of where the detector saw the object — is never deletable this
  way.
- 409 if it is the lane's last remaining detection. A zero-frame lane is
  degenerate: the object vanishes from the frame model while its
  `SequenceAnnotation` still claims a smoke object. (Real object removal is a
  separate feature blocked on an `is_manual` marker.)
- Deletes the row only. **Never touches S3** — `bucket_key` is shared with
  the sibling, which is why `DELETE /detections/{id}` (which unconditionally
  deletes the S3 object, `detections.py:343`) cannot be reused. The
  `DetectionAnnotation` and its contributions go via FK cascade
  (`models.py:417`).

### Why "model-evidence-free" and not a marker column

There is no `is_materialized` column, and adding one is schema work this
feature does not otherwise need. "No model evidence" is an exact proxy for
imported lanes: importer-created frames always carry the engine track the
lane was split on; human-materialized frames never do.

The proxy over-matches on one population — **human-added lanes**, whose
frames are all evidence-free because `add_object` copies the sibling's frame
set with empty predictions. Consequence, accepted deliberately: in an added
lane, clearing a box removes the frame from the lane (back to gap,
re-drawable) instead of leaving it confirmed-empty. That is the better
semantics for both populations: a frame whose only content is a human's box
has no reason to exist once the box is gone. "Confirmed empty" remains the
behavior for frames with model evidence, where a human is overruling the
detector.

## Frontend

All in the localize object editor and its page; the filmstrip, cockpit grid
and submit gate need **no logic changes** — they derive from the per-lane
detections query, so invalidating `QUERY_KEYS.SEQUENCE_DETECTIONS(laneId)`
makes the new cell appear and the gate count it.

### Drawing on a gap frame

On a peeked frame (`LocalizeObjectEditor.tsx` `peeked` state), drag-to-draw
becomes enabled. The rail stays empty (no candidates), `Enter` stays a no-op,
Accept-remaining and Reclassify stay hidden. The out-of-range banner stays
but its text changes: the object was never detected here, and drawing will
add this frame to it.

Commit flow for a box drawn on a gap frame:

1. `POST /sequences/{laneId}/frames { recorded_at }` → new Detection.
2. `saveDetectionReview` against the new `detectionId` (creates the
   annotation with the drawn box, `origin: 'human'`, stage `annotated`).
3. Invalidate `SEQUENCE_DETECTIONS(laneId)`.
4. Navigate the URL to the new detection — it is now legitimately
   addressable under the route guard (`:detectionId` belongs to `:laneId`),
   clearing `peeked`. No route change needed.

Failure handling:

- Step 1 fails → toast, nothing changed, frame still a gap.
- Step 2 fails → the frame exists boxless: it visibly blocks submit (no
  annotation ⇒ not `'done'` in `getCellState`), and drawing again retries
  without re-materializing (the POST's idempotent 200 covers a retry that
  re-fires it).

### Clearing

The frontend applies the same rule as the server: on a frame whose detection
is model-evidence-free, Clear / the `Delete` key calls the DELETE endpoint
instead of saving an empty annotation. On success, invalidate
`SEQUENCE_DETECTIONS(laneId)` and drop the editor back to the peeked view of
the same `recordedAt` (URL returns to the last in-object frame, as for any
peek). A 409 (e.g. last-frame guard) falls back to the ordinary
empty-annotation Clear.

Frames with model evidence keep today's Clear: save an annotation with no
smoke box — "confirmed empty".

## Testing

Backend (`tests/endpoints/`, isolated compose stack):

- Materialize: 201 with sibling-copied fields; idempotent 200 on re-POST;
  404 unknown sequence; 422 when no sibling has that `recorded_at`.
- Delete: 204 removes row and cascades the annotation; S3 object untouched;
  409 on a frame with `algo_predictions`; 409 on a frame with
  `auto_predictions`; 409 on the lane's last detection; 404 for a detection
  of another lane.

Frontend (Vitest):

- Drawing on a gap frame issues POST then annotation save, and the URL moves
  to the new detection.
- POST failure leaves the frame a gap with a toast; save failure leaves a
  boxless in-object frame, and a retry redraw re-fires the POST, which
  returns the existing row (idempotent 200) before saving again.
- Clear on an evidence-free frame calls DELETE and reverts the frame to a
  gap; Clear on an evidence-bearing frame saves an empty annotation as
  today.
- The filmstrip and submit gate reflect a materialized frame after
  invalidation (existing derivations, exercised through the page test).

Success criteria: backend `make lint` + test suite green in an isolated
stack; frontend `npm run quality` clean and full suite green.

## Out of scope

- Backend one-box-per-annotation validator (#286).
- "Remove added object" and any `is_manual` marker.
- Auto-advance or bulk operations over gap frames.

## Amendments from implementation

- **After un-materialize the editor lands on the nearest earlier in-object
  frame** (else the first later one), rather than re-peeking the removed
  frame's timestamp. The peek holds a filmstrip-entry snapshot; re-peeking
  mid-refetch would show a stale identity, and stepping back onto the
  now-gap frame is one keypress.
- **`ApiError` gained an optional `status`** (set by the axios interceptor)
  so the page recognizes the DELETE's 409 without string-matching the detail
  message.
- **A concurrent double-POST resolves idempotently**: the losing insert
  re-selects the winner's row and returns it with 200, so 409 is reserved
  for a genuine `alert_api_id` collision. The DELETE's last-frame guard
  stays advisory under concurrency — accepted for a single-annotator tool.
