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
  role: 'annotator',
  classify_status: 'granted',
  localize_status: 'locked',
  can_classify: true,
  can_localize: false,
  is_system: false,
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

  it('is true when the API says the user can localize', () => {
    useAuthStore.setState({ user: { ...baseUser, can_localize: true } });
    expect(useAuthStore.getState().canLocalize()).toBe(true);
  });
});

describe('useAuthStore roles', () => {
  it('treats an annotator as neither admin nor manager', () => {
    useAuthStore.setState({ user: baseUser });
    expect(useAuthStore.getState().isAdmin()).toBe(false);
    expect(useAuthStore.getState().isManager()).toBe(false);
  });

  it('treats an annotation manager as manager but not admin', () => {
    useAuthStore.setState({ user: { ...baseUser, role: 'annotation_manager' } });
    expect(useAuthStore.getState().isAdmin()).toBe(false);
    expect(useAuthStore.getState().isManager()).toBe(true);
  });

  it('treats an admin as admin and manager', () => {
    useAuthStore.setState({ user: { ...baseUser, role: 'admin' } });
    expect(useAuthStore.getState().isAdmin()).toBe(true);
    expect(useAuthStore.getState().isManager()).toBe(true);
  });
});
