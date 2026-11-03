import { useCallback, useEffect, useState } from 'react';

/** How tightly the session lists are spaced; set on <html data-density> for the CSS. */
export type Density = 'loose' | 'compact';

export const DENSITY_STORAGE_KEY = 'claude-dashboard.density';

// localStorage can throw (privacy mode, blocked storage); the choice is a convenience only.
function readStored(): Density {
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'loose';
  } catch {
    return 'loose';
  }
}

function writeStored(density: Density): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Kept for this page load only.
  }
}

/** The list density, remembered per browser like the language. */
export function useDensity(): [Density, (next: Density) => void] {
  const [density, setState] = useState<Density>(readStored);
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
  const setDensity = useCallback((next: Density) => {
    writeStored(next);
    setState(next);
  }, []);
  return [density, setDensity];
}
