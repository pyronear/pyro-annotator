import { describe, expect, it } from 'vitest';
import { guideAccess, guideAccessForUser } from '@/utils/guideAccess';
import type { RightStatus } from '@/types/api';

// One row per state of docs/specs/2026-11-26-guide-training-access-design.md.
const cases: Array<[string, RightStatus, RightStatus, ReturnType<typeof guideAccess>]> = [
  [
    'S1',
    'training',
    'locked',
    { visible: true, classifyLocked: false, localizeLocked: true, showSkip: false },
  ],
  [
    'S2',
    'granted',
    'locked',
    { visible: true, classifyLocked: false, localizeLocked: true, showSkip: true },
  ],
  [
    'S3',
    'training',
    'training',
    { visible: true, classifyLocked: false, localizeLocked: false, showSkip: false },
  ],
  [
    'S4',
    'granted',
    'training',
    { visible: true, classifyLocked: false, localizeLocked: false, showSkip: false },
  ],
  [
    'S5',
    'training',
    'granted',
    { visible: true, classifyLocked: false, localizeLocked: false, showSkip: false },
  ],
  [
    'S6',
    'granted',
    'granted',
    { visible: false, classifyLocked: false, localizeLocked: false, showSkip: false },
  ],
];

describe('guideAccess', () => {
  it.each(cases)('%s: classify %s, localize %s', (_state, classify, localize, expected) => {
    expect(guideAccess(classify, localize)).toEqual(expected);
  });

  it('locks the classify module when the classify right is locked', () => {
    expect(guideAccess('locked', 'locked').classifyLocked).toBe(true);
  });

  it('falls back to a new user (S1) when the user or the statuses are missing', () => {
    expect(guideAccessForUser(null)).toEqual(guideAccess('training', 'locked'));
  });
});
