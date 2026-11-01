import { useCallback, useState } from 'react';

/** Ids of groups the user collapsed; every group starts expanded. */
export function useCollapsed(): { has: (id: string) => boolean; toggle: (id: string) => void } {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  return { has: (id) => ids.has(id), toggle };
}
