import { AnnotationType } from '@/types/api';

const PILLS: Record<AnnotationType, { classes: string; label: string }> = {
  wildfire_smoke: { classes: 'bg-red-100 text-red-800', label: '🔥 Wildfire' },
  other_smoke: { classes: 'bg-orange-100 text-orange-800', label: '💨 Other Smoke' },
  other: { classes: 'bg-gray-100 text-gray-800', label: '○ Other' },
};

/** Alert-platform annotation pill (🔥 / 💨 / ○); renders nothing when unset. */
export function PlatformAnnotationPill({ value }: { value: AnnotationType | null }) {
  if (!value) return null;
  const pill = PILLS[value];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${pill.classes}`}
    >
      {pill.label}
    </span>
  );
}
