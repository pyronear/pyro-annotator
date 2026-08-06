/**
 * Pure display helpers for the classify cockpit's decision rail — kept out
 * of the component files so those stay fast-refresh-safe (component-only
 * exports).
 */

import { SequenceBbox } from '@/types/api';
import { formatSmokeType } from '@/utils/modelAccuracy';
import { CardClassification } from '@/components/sequence-annotation';

export const formatFalsePositiveLabel = (type: string): string => {
  const [first, ...rest] = type.split('_');
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
};

export interface ObjectRowStatus {
  label: string;
  tone: 'pending' | 'positive' | 'neutral' | 'unsure';
}

export function getObjectRowStatus(args: {
  bbox: SequenceBbox;
  classification: CardClassification;
  unsure: boolean;
}): ObjectRowStatus {
  const { bbox, classification, unsure } = args;
  if (unsure) return { label: 'Unsure', tone: 'unsure' };
  if (classification === 'smoke' && bbox.smoke_type !== undefined) {
    return { label: `Smoke · ${formatSmokeType(bbox.smoke_type)}`, tone: 'positive' };
  }
  if (classification === 'smoke') return { label: 'Type needed', tone: 'pending' };
  if (bbox.false_positive_types.length > 0) {
    const extra = bbox.false_positive_types.length - 1;
    const first = formatFalsePositiveLabel(bbox.false_positive_types[0]);
    return { label: `FP · ${first}${extra > 0 ? ` +${extra}` : ''}`, tone: 'neutral' };
  }
  return { label: 'Pending', tone: 'pending' };
}
