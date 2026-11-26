/**
 * PROTOTYPE — in-memory stand-in for the tag API.
 *
 * The `/tags` CRUD exists on the backend (PR #432) but not the alert side:
 * no filter is stored on a tag, nothing counts the alerts a filter matches,
 * nothing applies a tag from a filter. This module fakes those three so the
 * Tag Management screen can be reviewed before the data model is settled.
 * Replace it with `apiClient` calls once the alert-side endpoints land.
 */

export interface TagFilters {
  /** organisation names; empty = every organisation */
  organisations: string[];
  /** YYYY-MM-DD, inclusive; empty = open bound */
  dateFrom: string;
  dateTo: string;
}

export interface PrototypeTag {
  id: number;
  name: string;
  description: string | null;
  /**
   * Mock-only: lets the prototype fake which alerts carry the tag. The real
   * `tags` table does not store the filter — the tag is a snapshot.
   */
  filters: TagFilters;
  alertCount: number;
  userCount: number;
  /** users for whom this is the only tag: they see no alert once it is deleted */
  usersOnlyThisTag: string[];
  createdBy: string;
  createdAt: string;
}

export interface TagCreatePayload {
  name: string;
  description: string | null;
  filters: TagFilters;
}

export const TAGS_QUERY_KEY = ['tags-prototype'];

/** What deleting a tag takes away — the future `GET /tags/{id}/impact`. */
export interface TagDeleteImpact {
  alertCount: number;
  userCount: number;
  /** users left with no tag (and no full_access): they see no alert at all */
  usersLosingAllAccess: string[];
}

/**
 * The calendar day of an instant in Europe/Paris, as YYYY-MM-DD: periods are
 * read as the admin's days, not UTC ones (23:30 UTC on 31/07 is 01/08).
 */
export function parisDay(instant: Date | string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const LATENCY_MS = 250;
const wait = () => new Promise(resolve => setTimeout(resolve, LATENCY_MS));

let nextId = 4;
let tags: PrototypeTag[] = [
  {
    id: 1,
    name: 'org-alpha',
    description: 'Every alert of org-alpha',
    filters: { organisations: ['org-alpha'], dateFrom: '', dateTo: '' },
    alertCount: 42,
    userCount: 1,
    usersOnlyThisTag: ['annotator-alpha'],
    createdBy: 'admin',
    createdAt: '2026-11-26T10:00:00Z',
  },
  {
    id: 2,
    name: 'org-bravo',
    description: 'Every alert of org-bravo',
    filters: { organisations: ['org-bravo'], dateFrom: '', dateTo: '' },
    alertCount: 31,
    userCount: 1,
    usersOnlyThisTag: [],
    createdBy: 'admin',
    createdAt: '2026-11-26T10:00:00Z',
  },
  {
    id: 3,
    name: 'org-charlie',
    description: 'Every alert of org-charlie',
    filters: { organisations: ['org-charlie'], dateFrom: '', dateTo: '' },
    alertCount: 27,
    userCount: 1,
    usersOnlyThisTag: [],
    createdBy: 'admin',
    createdAt: '2026-11-26T10:00:00Z',
  },
];

/** Deterministic fake count so the preview moves as the filters change. */
export function estimateMatchingAlerts(filters: TagFilters, totalOrganisations: number): number {
  const orgs = filters.organisations.length || Math.max(totalOrganisations, 1);
  const from = filters.dateFrom ? Date.parse(filters.dateFrom) : Date.parse('2026-06-01');
  const to = filters.dateTo ? Date.parse(filters.dateTo) : Date.now();
  const days = Math.max(0, Math.round((to - from) / 86_400_000) + 1);
  return Math.round(orgs * days * 0.6);
}

export const tagsPrototypeApi = {
  async list(): Promise<PrototypeTag[]> {
    await wait();
    return [...tags].sort((a, b) => a.name.localeCompare(b.name));
  },

  async create(payload: TagCreatePayload, totalOrganisations: number): Promise<PrototypeTag> {
    await wait();
    if (tags.some(t => t.name.toLowerCase() === payload.name.toLowerCase())) {
      throw { detail: 'Tag name already exists' };
    }
    const tag: PrototypeTag = {
      id: nextId++,
      name: payload.name,
      description: payload.description,
      filters: payload.filters,
      alertCount: estimateMatchingAlerts(payload.filters, totalOrganisations),
      userCount: 0,
      usersOnlyThisTag: [],
      createdBy: 'admin',
      createdAt: new Date().toISOString(),
    };
    tags = [...tags, tag];
    return tag;
  },

  async impact(id: number): Promise<TagDeleteImpact> {
    await wait();
    const tag = tags.find(t => t.id === id);
    if (!tag) throw { detail: 'Tag not found' };
    return {
      alertCount: tag.alertCount,
      userCount: tag.userCount,
      usersLosingAllAccess: tag.usersOnlyThisTag,
    };
  },

  async remove(id: number): Promise<void> {
    await wait();
    tags = tags.filter(t => t.id !== id);
  },
};

/**
 * Tags an alert carries. Faked by matching the alert against each tag's
 * filter; the real API will read alert_tags (a snapshot taken at tag time).
 */
export function tagsForAlert(
  allTags: PrototypeTag[],
  alert: { organisation_name: string; recorded_at: string }
): PrototypeTag[] {
  const day = parisDay(alert.recorded_at);
  return allTags.filter(({ filters }) => {
    if (filters.organisations.length && !filters.organisations.includes(alert.organisation_name))
      return false;
    if (filters.dateFrom && day < filters.dateFrom) return false;
    if (filters.dateTo && day > filters.dateTo) return false;
    return true;
  });
}
