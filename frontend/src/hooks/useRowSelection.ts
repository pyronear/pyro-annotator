import { useState } from 'react';
import { CheckState } from '@/components/ui/CheckMark';

/**
 * Checkbox selection over the rows on screen. Only `selectable` rows count:
 * an id selected earlier that is no longer among them is ignored.
 */
export function useRowSelection<Row extends { id: number }>(selectable: Row[]) {
  const [ids, setIds] = useState<Set<number>>(() => new Set());

  const selected = selectable.filter(row => ids.has(row.id));
  const all = selectable.length > 0 && selected.length === selectable.length;

  return {
    selected,
    isSelected: (id: number) => ids.has(id),
    /** State of a "select all" checkbox. */
    allState: (all ? true : selected.length > 0 ? 'mixed' : false) as CheckState,
    toggle: (id: number) =>
      setIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: () => setIds(all ? new Set() : new Set(selectable.map(row => row.id))),
    clear: () => setIds(new Set()),
  };
}
