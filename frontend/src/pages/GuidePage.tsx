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
        How a detection sequence becomes training data, and what to do at each pass.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 font-display text-lg font-semibold text-char">The pipeline</h2>
        <p className="font-body text-[13.5px] leading-relaxed text-char">
          Wildfire cameras send detection sequences to the platform. Every sequence travels the
          same path: it is classified first, then localized, and is complete when both passes are
          done. Classifying is quick and filters out false positives early, so the slower
          localization work is only spent on confirmed smoke.
        </p>
      </section>

      <section className="mb-8 border-l-2 border-ember pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-ember">
          Pass 01 — Classify sequences
        </h2>
        <p className="mb-2 font-body text-[13.5px] leading-relaxed text-char">
          Watch the sequence and decide what each highlighted track really is: wildfire smoke,
          other smoke (chimneys, agricultural burns), or a false positive (clouds, glare, dust,
          and similar). Flag any smoke the AI missed. This is a fast, whole-sequence judgment —
          when in doubt, mark the track unsure rather than guessing.
        </p>
        <p className="font-body text-[13.5px] leading-relaxed text-haze">
          Start from the dashboard’s “Start classifying” queue. Submitting moves the sequence to
          the Localize pass.
        </p>
      </section>

      <section className="mb-8 border-l-2 border-pine pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-pine">
          Pass 02 — Localize smoke
        </h2>
        <p className="mb-2 font-body text-[13.5px] leading-relaxed text-char">
          For sequences that passed classification, draw a tight bounding box around the smoke in
          each image. Boxes should hug the visible plume — tight boxes make better training labels
          than generous ones.
        </p>
        <p className="font-body text-[13.5px] leading-relaxed text-haze">
          Start from the dashboard’s “Start localizing” queue. Finishing the last image completes
          the sequence.
        </p>
      </section>

      <section className="border-l-2 border-char pl-4">
        <h2 className="mb-2 font-display text-lg font-semibold text-char">Complete</h2>
        <p className="font-body text-[13.5px] leading-relaxed text-char">
          Both passes done: the sequence’s labels are ready for dataset export and model training.
        </p>
      </section>
    </div>
  );
}
