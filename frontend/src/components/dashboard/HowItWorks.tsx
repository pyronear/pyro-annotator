import { Link } from 'react-router-dom';

const STEPS = [
  {
    key: 'Pass 01 · Classify',
    border: 'border-ember',
    text: 'text-ember',
    body: 'Watch the sequence and decide what each highlighted track really is: wildfire smoke, other smoke, or a false positive. Flag any smoke the AI missed.',
  },
  {
    key: 'Pass 02 · Localize',
    border: 'border-pine',
    text: 'text-pine',
    body: 'For sequences that passed classification, draw a tight bounding box around the smoke in each image — the labels that train better detection models.',
  },
  {
    key: 'Complete',
    border: 'border-char',
    text: 'text-char',
    body: "Both passes done: the sequence's labels are ready for dataset export and model training.",
  },
];

export default function HowItWorks() {
  return (
    <div className="rounded-[10px] border border-line bg-paper px-[22px] py-5">
      <div className="mb-3 font-data text-[10.5px] font-medium uppercase tracking-[0.14em] text-haze">
        How annotation works
      </div>
      <p className="mb-3.5 font-body text-[13px] leading-relaxed text-char">
        Wildfire cameras send detection sequences to the platform. Every sequence travels the same
        path, and your work happens in two passes:
      </p>
      <div className="mb-3.5 flex flex-col gap-4 md:flex-row">
        {STEPS.map(step => (
          <div key={step.key} className={`flex-1 border-l-2 pl-3.5 ${step.border}`}>
            <div
              className={`mb-1 font-data text-[10.5px] font-medium uppercase tracking-[0.12em] ${step.text}`}
            >
              {step.key}
            </div>
            <p className="font-body text-[12.5px] leading-relaxed text-haze">{step.body}</p>
          </div>
        ))}
      </div>
      <div className="flex items-baseline border-t border-line pt-3 font-body text-[12.5px] italic text-haze">
        Why two passes? Classifying is quick and filters out false positives early, so the slower
        localization work is only spent on confirmed smoke.
        <Link
          to="/guide"
          className="ml-auto shrink-0 pl-4 font-semibold not-italic text-char hover:text-ember"
        >
          Open the field guide →
        </Link>
      </div>
    </div>
  );
}
