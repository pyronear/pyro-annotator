import { Link } from 'react-router-dom';

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/" className="font-body text-[12.5px] text-haze hover:text-char">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 font-display text-[27px] font-semibold tracking-tight text-char">
        Field guide
      </h1>
      <p className="mb-8 mt-1 font-body text-[13.5px] text-haze">
        How an alert becomes training data, and what to do at each pass.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg font-semibold text-char">The pipeline</h2>
        <p className="font-body text-[13.5px] leading-relaxed text-char">
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
        <p className="mb-2 font-body text-[13.5px] leading-relaxed text-char">
          Watch the alert and decide what each highlighted object really is: wildfire smoke, other
          smoke (chimneys, agricultural burns), or a false positive (clouds, glare, dust, and
          similar). Flag any smoke the AI missed. This is a fast, whole-object judgment — when in
          doubt, mark the object unsure rather than guessing.
        </p>
        <p className="font-body text-[13.5px] leading-relaxed text-haze">
          Start from the dashboard’s “Start classifying” queue. Submitting sends the alert’s smoke
          objects on to the Localize pass; false positives are done.
        </p>
      </section>

      <section className="mb-8 border-l-2 border-pine pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-pine">
          Pass 02 — Localize smoke
        </h2>
        <p className="mb-2 font-body text-[13.5px] leading-relaxed text-char">
          For objects that passed classification, draw a tight bounding box around the smoke in each
          frame. Boxes should hug the visible plume — tight boxes make better training labels than
          generous ones.
        </p>
        <p className="font-body text-[13.5px] leading-relaxed text-haze">
          Start from the dashboard’s “Start localizing” queue. Finishing the last frame completes
          the object.
        </p>
      </section>

      <section className="border-l-2 border-char pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-char">Complete</h2>
        <p className="font-body text-[13.5px] leading-relaxed text-char">
          Both passes done: the object’s labels are ready for dataset export and model training.
        </p>
      </section>
    </div>
  );
}
