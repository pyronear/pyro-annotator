import { AnnotationType } from '@/types/api';

const PILLS: Record<AnnotationType, { classes: string; label: string }> = {
  wildfire_smoke: { classes: 'bg-red-100 text-red-800', label: '🔥 Wildfire' },
  other_smoke: { classes: 'bg-orange-100 text-orange-800', label: '💨 Other Smoke' },
  other: { classes: 'bg-gray-100 text-gray-800', label: '○ Other' },
};

/** Alert-API model prediction pill (🔥 / 💨 / ○); renders nothing when no prediction. */
export function WildfirePredictionPill({ prediction }: { prediction: AnnotationType | null }) {
  if (!prediction) return null;
  const pill = PILLS[prediction];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${pill.classes}`}
    >
      {pill.label}
    </span>
  );
}
