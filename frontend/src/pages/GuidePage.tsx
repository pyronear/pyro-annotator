import { Link } from 'react-router-dom';

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/" className="font-body text-detail text-haze hover:text-char">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 font-display text-title font-semibold tracking-tight text-char">
        Field guide
      </h1>
      <p className="mb-8 mt-1 font-body text-body text-haze">
        How an alert becomes training data, and what to do at each pass.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg font-semibold text-char">The pipeline</h2>
        <p className="font-body text-body leading-relaxed text-char">
          Wildfire cameras send <strong>alerts</strong> to the platform — one alert per camera
          event. Each alert groups one or more <strong>objects</strong> (a smoke plume, a
          false-positive source), and every object is built from a run of <strong>frames</strong>{' '}
          (the individual images). Every object travels the same path: it is classified first, then
          localized, and is complete when both passes are done. Classifying is quick and filters out
          false positives early, so the slower localization work is only spent on confirmed smoke.
        </p>
      </section>

      <section className="mb-8 border-l-2 border-ember pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-ember">
          Pass 01 — Classify alerts
        </h2>
        <p className="mb-2 font-body text-body leading-relaxed text-char">
          Watch the alert and decide what each highlighted object really is: wildfire smoke, other
          smoke (chimneys, agricultural burns), or a false positive (clouds, glare, dust, and
          similar). Flag any smoke the AI missed. This is a fast, whole-object judgment — when in
          doubt, mark the object unsure rather than guessing.
        </p>
        <p className="font-body text-body leading-relaxed text-haze">
          Start from the dashboard’s “Start classifying” queue. Submitting sends the alert’s smoke
          objects on to the Localize pass; false positives are done.
        </p>
      </section>

      <section className="mb-8 border-l-2 border-pine pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-pine">
          Pass 02 — Localize smoke
        </h2>
        <p className="mb-2 font-body text-body leading-relaxed text-char">
          Opens the whole alert as an object timeline: one row per object, a segment per frame.
          Click a row or a segment to focus that object — the frame grid crops in and steps you
          through just its frames. Draw a tight bounding box around the smoke in each frame, or
          accept a frame outright when the model’s own prediction already looks right; boxes should
          hug the visible plume, since tight boxes make better training labels than generous ones.
        </p>
        <p className="font-body text-body leading-relaxed text-haze">
          Start from the dashboard’s “Start localizing” queue — it opens the alert page with every
          object’s status. If the classify pass missed smoke entirely, answer the missed-smoke
          question Yes and use “+ Add object”: pick the first and last frame the plume appears on,
          draw one box on the first, and every frame in that range gets a copy — then refine any of
          them in the editor. “Skip alert” remains for what drawing can’t fix, such as an alert you
          can’t judge. “Accept all & submit alert” accepts every object’s pending predictions and
          submits the whole alert in one step. The old per-object editor still exists, but only as a
          direct link to a specific frame — it’s no longer part of the normal queue flow.
        </p>
      </section>

      <section className="border-l-2 border-char pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-char">Complete</h2>
        <p className="font-body text-body leading-relaxed text-char">
          Both passes done: the object’s labels are ready for dataset export and model training.
        </p>
      </section>
    </div>
  );
}
