import { AnnotationType } from '@/types/api';

const LABELS: Record<AnnotationType, string> = {
  wildfire_smoke: '🔥 Wildfire',
  other_smoke: '💨 Other Smoke',
  other: '○ Other',
};

/** Alert-platform annotation as plain text (🔥 / 💨 / ○); renders nothing when unset. */
export function PlatformAnnotationLabel({ value }: { value: AnnotationType | null }) {
  if (!value) return null;
  return <span>{LABELS[value]}</span>;
}
