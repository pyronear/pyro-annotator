import { User } from '@/types/api';

vi.mock('@/services/api', () => ({
  apiClient: {
    login: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

import { useAuthStore } from '@/store/useAuthStore';

const baseUser: User = {
  id: 1,
  username: 'annotator',
  is_active: true,
  is_superuser: false,
  is_system: false,
  can_localize: false,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

describe('useAuthStore.canLocalize', () => {
  it('is false when no user is loaded', () => {
    expect(useAuthStore.getState().canLocalize()).toBe(false);
  });

  it('is false for a classify-only user', () => {
    useAuthStore.setState({ user: baseUser });
    expect(useAuthStore.getState().canLocalize()).toBe(false);
  });

  it('is true when the user has can_localize', () => {
    useAuthStore.setState({ user: { ...baseUser, can_localize: true } });
    expect(useAuthStore.getState().canLocalize()).toBe(true);
  });

  it('is true for a superuser without the flag', () => {
    useAuthStore.setState({ user: { ...baseUser, is_superuser: true } });
    expect(useAuthStore.getState().canLocalize()).toBe(true);
  });
});
