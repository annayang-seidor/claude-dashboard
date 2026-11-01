import type { z } from 'zod';
import { TokenRefreshResponse } from '../shared/api';
import { TOKEN_HEADER, TOKEN_QUERY_PARAM, TOKEN_REFRESH_PATH } from '../shared/config';
import { parseSse } from './sse';

// Read once at load and kept in memory only (no localStorage). It stays in the URL so a reload works.
const token = new URLSearchParams(window.location.search).get(TOKEN_QUERY_PARAM) ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Set by the first 403: the server no longer accepts this tab's token (it was rotated, or the tab
// was opened from an old link). Nothing retries after that; the page asks for the new link.
let accessLost = false;
const accessListeners = new Set<() => void>();

function noteStatus(status: number): void {
  if (status !== 403 || accessLost) return;
  accessLost = true;
  accessListeners.forEach((l) => l());
}

/** External store for useSyncExternalStore: whether the server has refused this tab's token. */
export const accessStore = {
  get: () => accessLost,
  subscribe(listener: () => void): () => void {
    accessListeners.add(listener);
    return () => accessListeners.delete(listener);
  },
  /** Tests only: start the next test with access. */
  reset: () => void (accessLost = false),
};

/** Trades this tab's token for the current one after a rotation (ADR 0048). `refused`: the token
 * is older than the last rotation, or was revoked; `down`: nothing answered. */
export async function refreshToken(): Promise<string | 'refused' | 'down'> {
  let res: Response;
  try {
    res = await fetch(TOKEN_REFRESH_PATH, { method: 'POST', headers: { [TOKEN_HEADER]: token } });
  } catch {
    return 'down';
  }
  if (!res.ok) return 'refused';
  const body = TokenRefreshResponse.safeParse(await res.json().catch(() => null));
  return body.success ? body.data.token : 'refused';
}

/** Reloads the page on the same route with `next` as its token. */
export function reopenWithToken(next: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(TOKEN_QUERY_PARAM, next);
  window.location.replace(url);
}

/** Fetch an /api path with the dashboard token and validate the JSON body with `schema`. */
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set(TOKEN_HEADER, token);
  const res = await fetch(path, { ...init, headers });
  noteStatus(res.status);
  if (!res.ok) throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status}`);
  return schema.parse(await res.json());
}

/** Read an SSE stream with fetch so the token goes in a header (ADR 0013). Resolves when the
 * stream ends; `followEvents` reconnects. `onOpen` runs once the server has accepted it. */
export async function streamEvents(
  path: string,
  onEvent: (name: string) => void,
  signal: AbortSignal,
  onOpen: () => void = () => {},
): Promise<void> {
  const res = await fetch(path, { headers: { [TOKEN_HEADER]: token }, signal });
  noteStatus(res.status);
  if (!res.ok || !res.body) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
  onOpen();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const parsed = parseSse(buffer + value);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
  }
}

/** Wait before reconnect attempt `n` (0-based) after the stream drops: 1 s, 2 s, 4 s … 30 s. */
export function reconnectDelay(n: number): number {
  return Math.min(30_000, 1000 * 2 ** n);
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Keeps an SSE stream open until `signal` aborts: when it ends or fails (server restart, sleep),
 * reconnects with backoff, and calls `onReconnect` once it is back, since events sent while away
 * are lost (ADR 0013). The backoff resets on every successful connect. Stops for good once any
 * call got a 403: retrying with a refused token cannot succeed (ADR 0032). */
export async function followEvents(
  path: string,
  onEvent: (name: string) => void,
  signal: AbortSignal,
  onReconnect: () => void,
): Promise<void> {
  let attempt = 0;
  let connected = false;
  while (!signal.aborted && !accessLost) {
    try {
      await streamEvents(path, onEvent, signal, () => {
        if (connected) onReconnect();
        connected = true;
        attempt = 0;
      });
    } catch {
      // Dropped or refused; retried below.
    }
    if (signal.aborted || accessLost) return;
    await sleep(reconnectDelay(attempt++), signal);
  }
}

interface EventListener {
  onEvent: (name: string) => void;
  onReconnect: () => void;
}

const eventListeners = new Set<EventListener>();
let eventsAbort: AbortController | null = null;

/** Listens to /api/events on the page's one shared stream (ADR 0041): the first subscriber opens
 * it, the last to leave closes it. A stream per hook would take one of the browser's ~6
 * connections per host each, so a few open tabs could stall every request. Returns unsubscribe. */
export function subscribeEvents(
  onEvent: (name: string) => void,
  onReconnect: () => void,
): () => void {
  const listener = { onEvent, onReconnect };
  eventListeners.add(listener);
  if (!eventsAbort) {
    const abort = new AbortController();
    eventsAbort = abort;
    void followEvents(
      '/api/events',
      (name) => eventListeners.forEach((l) => l.onEvent(name)),
      abort.signal,
      () => eventListeners.forEach((l) => l.onReconnect()),
    ).finally(() => {
      // Stopped for good (403). A later subscriber starts a new follow, which returns at once.
      if (eventsAbort === abort && !abort.signal.aborted) eventsAbort = null;
    });
  }
  return () => {
    if (!eventListeners.delete(listener) || eventListeners.size) return;
    eventsAbort?.abort();
    eventsAbort = null;
  };
}
