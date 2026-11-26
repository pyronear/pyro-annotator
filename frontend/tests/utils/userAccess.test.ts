import { Tag, User } from '@/types/api';
import {
  bulkTagChange,
  canTakeTags,
  searchTags,
  tagCoverage,
  userAccess,
} from '@/utils/userAccess';

const tag = (id: number, name: string, description: string | null = null): Tag => ({
  id,
  name,
  description,
  created_by: null,
  created_at: '2026-11-26T00:00:00Z',
});

const fires = tag(1, 'fires-2026', 'Wildfires of the 2026 season');
const chile = tag(2, 'cenia', 'Chilean cameras');

const user = (id: number, overrides: Partial<User> = {}): User => ({
  id,
  username: `user${id}`,
  is_active: true,
  role: 'annotator',
  classify_status: 'granted',
  localize_status: 'locked',
  can_classify: true,
  can_localize: false,
  full_access: false,
  tags: [],
  is_system: false,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('userAccess', () => {
  it('tells what alerts a user sees', () => {
    expect(userAccess(user(1, { is_system: true }))).toBe('system');
    expect(userAccess(user(1, { role: 'admin' }))).toBe('admin');
    expect(userAccess(user(1, { full_access: true, tags: [fires] }))).toBe('full');
    expect(userAccess(user(1, { tags: [fires] }))).toBe('tagged');
    expect(userAccess(user(1))).toBe('none');
  });

  it('keeps tags off admins and the worker', () => {
    expect(canTakeTags(user(1))).toBe(true);
    expect(canTakeTags(user(1, { role: 'annotation_manager' }))).toBe(true);
    expect(canTakeTags(user(1, { role: 'admin' }))).toBe(false);
    expect(canTakeTags(user(1, { is_system: true }))).toBe(false);
  });
});

describe('searchTags', () => {
  it('matches the name or the description, ignoring case', () => {
    expect(searchTags([fires, chile], 'FIRE')).toEqual([fires]);
    expect(searchTags([fires, chile], 'chilean')).toEqual([chile]);
    expect(searchTags([fires, chile], '  ')).toEqual([fires, chile]);
  });
});

describe('bulk tagging', () => {
  const holder = user(1, { tags: [fires] });
  const other = user(2);

  it('counts the users holding a tag', () => {
    expect(tagCoverage([holder, other], fires.id)).toBe(1);
  });

  it('gives the tag to the users missing it', () => {
    expect(bulkTagChange([holder, other], fires.id)).toEqual({ add: [2] });
  });

  it('removes the tag from everyone when all hold it', () => {
    expect(bulkTagChange([holder, user(3, { tags: [fires] })], fires.id)).toEqual({
      remove: [1, 3],
    });
  });
});
