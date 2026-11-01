/** In-process fan-out from the watcher to open /api/events streams. */
export interface EventHub {
  /** Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  emit(): void;
}

export function createEventHub(): EventHub {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit() {
      for (const l of listeners) l();
    },
  };
}
