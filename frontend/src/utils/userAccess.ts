import { Tag, User, UserTagsChange } from '@/types/api';

/**
 * Which alerts a user sees (#401):
 * - `admin`: every alert, by role;
 * - `full`: every alert, through the full-access flag;
 * - `tagged`: only the alerts carrying one of their tags;
 * - `none`: nothing (no full access, no tag);
 * - `system`: the worker account, which is not a person.
 */
export type UserAccess = 'system' | 'admin' | 'full' | 'tagged' | 'none';

export function userAccess(user: User): UserAccess {
  if (user.is_system) return 'system';
  if (user.role === 'admin') return 'admin';
  if (user.full_access) return 'full';
  return user.tags.length > 0 ? 'tagged' : 'none';
}

/** Admins see everything by role and the worker is not a person: neither takes tags. */
export function canTakeTags(user: User): boolean {
  return !user.is_system && user.role !== 'admin';
}

export function hasTag(user: User, tagId: number): boolean {
  return user.tags.some(tag => tag.id === tagId);
}

/** Tags whose name or description contains the query (case-insensitive). */
export function searchTags(tags: Tag[], query: string): Tag[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return tags;
  return tags.filter(
    tag =>
      tag.name.toLowerCase().includes(needle) ||
      (tag.description ?? '').toLowerCase().includes(needle)
  );
}

/** How many of the users hold the tag. */
export function tagCoverage(users: User[], tagId: number): number {
  return users.filter(user => hasTag(user, tagId)).length;
}

/**
 * The change a bulk click on a tag makes: when every user already holds it,
 * it is removed from all of them; otherwise it is given to those missing it.
 */
export function bulkTagChange(users: User[], tagId: number): UserTagsChange {
  const missing = users.filter(user => !hasTag(user, tagId));
  return missing.length === 0
    ? { remove: users.map(user => user.id) }
    : { add: missing.map(user => user.id) };
}
