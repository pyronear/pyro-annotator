import type { RightStatus, User } from '@/types/api';

/**
 * What the user guide shows, from the user's two right statuses.
 * See docs/specs/2026-11-26-guide-training-access-design.md.
 *
 * - A training module is locked while its right is `locked`, and enabled
 *   once the right is `training` or `granted`.
 * - The guide is hidden once both rights are `granted`.
 * - The Skip button shows when classify is `granted` and localize is `locked`:
 *   the user has nothing left to train on and goes to classification.
 */
export interface GuideAccess {
  visible: boolean;
  classifyLocked: boolean;
  localizeLocked: boolean;
  showSkip: boolean;
}

export function guideAccess(classify: RightStatus, localize: RightStatus): GuideAccess {
  return {
    visible: !(classify === 'granted' && localize === 'granted'),
    classifyLocked: classify === 'locked',
    localizeLocked: localize === 'locked',
    showSkip: classify === 'granted' && localize === 'locked',
  };
}

/**
 * Same as `guideAccess`, read from the signed-in user. A missing user or
 * status falls back to the defaults of a new user (classify in training,
 * localize locked).
 */
export function guideAccessForUser(user: User | null | undefined): GuideAccess {
  return guideAccess(user?.classify_status ?? 'training', user?.localize_status ?? 'locked');
}
