import { AnnotationType } from '@/types/api';

const LABELS: Record<AnnotationType, { dotClass: string; label: string; title: string }> = {
  wildfire_smoke: {
    dotClass: 'bg-signal',
    label: 'Wildfire',
    title: 'Wildfire smoke — the alert platform classified this sequence as a wildfire',
  },
  other_smoke: {
    dotClass: 'bg-ember',
    label: 'Other smoke',
    title: 'Other smoke — the alert platform classified this as smoke, but not a wildfire',
  },
  other: {
    dotClass: 'border border-haze',
    label: 'Other',
    title: 'Other — the alert platform classified this as neither wildfire nor smoke',
  },
};

/** Alert-platform classification as a dot + label (OutcomeCode style); renders nothing when unset. */
export function PlatformAnnotationLabel({ value }: { value: AnnotationType | null }) {
  if (!value) return null;
  const entry = LABELS[value];
  return (
    <span title={entry.title} className="inline-flex items-center gap-1.5 text-detail text-char">
      <span aria-hidden className={`h-2 w-2 flex-none rounded-full ${entry.dotClass}`} />
      {entry.label}
    </span>
  );
}
