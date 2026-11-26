import { beforeEach, describe, expect, it } from 'vitest';
import { useGuideProgressStore } from '@/store/useGuideProgressStore';

describe('useGuideProgressStore', () => {
  beforeEach(() => {
    useGuideProgressStore.setState({ completedByUser: {} });
  });

  it('records a finished module per user', () => {
    useGuideProgressStore.getState().markCompleted('1', '/guide/classification');
    const { completedByUser } = useGuideProgressStore.getState();
    expect(completedByUser['1']).toEqual(['/guide/classification']);
    expect(completedByUser['2']).toBeUndefined();
  });

  it('records a module only once', () => {
    const { markCompleted } = useGuideProgressStore.getState();
    markCompleted('1', '/guide/localization');
    markCompleted('1', '/guide/localization');
    expect(useGuideProgressStore.getState().completedByUser['1']).toEqual(['/guide/localization']);
  });
});
