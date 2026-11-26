import { useQuery } from '@tanstack/react-query';
import {
  PrototypeTag,
  tagsForAlert,
  tagsPrototypeApi,
  TAGS_QUERY_KEY,
} from '@/services/tagsPrototype';

type AlertKey = { organisation_name: string; recorded_at: string };

export interface AlertTagsLookup {
  tagsFor: (alert: AlertKey) => PrototypeTag[];
}

/**
 * The tags each alert carries, for the tag pills.
 * Shown to everyone for now; an admin role will gate tags later.
 * PROTOTYPE — tags are matched from the in-memory store; the real queues
 * will return `tags: string[]` on each alert.
 */
export function useAlertTags(): AlertTagsLookup {
  const { data: allTags = [] } = useQuery({
    queryKey: TAGS_QUERY_KEY,
    queryFn: () => tagsPrototypeApi.list(),
  });
  return { tagsFor: alert => tagsForAlert(allTags, alert) };
}
