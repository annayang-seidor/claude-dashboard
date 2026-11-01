import { useEffect, useState } from 'react';

/** Current time, refreshed every minute so "Today 10:12", buckets and "synced N min ago" roll
 * over. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
