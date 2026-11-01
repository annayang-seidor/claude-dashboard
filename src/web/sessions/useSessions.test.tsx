// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '../../shared/api';
import { session } from './fixtures';
import { useSessions } from './useSessions';

afterEach(cleanup);

const a = session({ title: 'A', at: [10, 23, 9, 0] });

/** A controllable /api/events body: `push` sends text, `end` closes it. */
function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const enc = new TextEncoder();
  return {
    body,
    push: (text: string) => controller.enqueue(enc.encode(text)),
    end: () => controller.close(),
  };
}

interface Server {
  sessions: ApiSession[];
  patch: (id: string, body: unknown) => Response;
}

let server: Server;
let events: ReturnType<typeof eventStream>;
let fetchMock: ReturnType<typeof vi.fn>;
let eventsOpened: number;
/** When set, PATCH responses wait for it. */
let patchGate: Promise<void> | null;

beforeEach(() => {
  server = {
    sessions: [a],
    patch: (id, body) => {
      const s = server.sessions.find((x) => x.id === id)!;
      return Response.json({ ...s, state: { ...s.state, ...(body as object) } });
    },
  };
  events = eventStream();
  eventsOpened = 0;
  patchGate = null;
  fetchMock = vi.fn(async (path: string, init: RequestInit = {}) => {
    if (path === '/api/events') {
      eventsOpened++;
      if (eventsOpened > 1) events = eventStream();
      return new Response(events.body);
    }
    if (path.startsWith('/api/sessions?')) return Response.json({ sessions: server.sessions });
    if (init.method === 'PATCH') {
      await patchGate;
      return server.patch(path.split('/').pop()!, JSON.parse(init.body as string));
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function loaded() {
  const hook = renderHook(() => useSessions('work'));
  await waitFor(() => expect(hook.result.current.sessions).not.toBeNull());
  return hook;
}

describe('useSessions', () => {
  it('loads the workspace and sends the token header', async () => {
    const { result } = await loaded();
    expect(result.current.sessions!.map((s) => s.title)).toEqual(['A']);
    const [path, init] = fetchMock.mock.calls.find(([p]) => String(p).startsWith('/api/sessions'))!;
    expect(path).toBe('/api/sessions?workspace=work');
    expect(new Headers(init.headers).has('X-Dashboard-Token')).toBe(true);
  });

  it('refetches on sessions-changed', async () => {
    const { result } = await loaded();
    const b = session({ title: 'B', at: [10, 23, 10, 0] });
    server.sessions = [a, b];
    await act(async () => events.push(': keep-alive\n\nevent: sessions-changed\ndata: {}\n\n'));
    await waitFor(() => expect(result.current.sessions!.map((s) => s.title)).toEqual(['A', 'B']));
  });

  it('applies an edit at once and keeps the server answer', async () => {
    let release!: () => void;
    patchGate = new Promise<void>((r) => (release = r));
    const { result } = await loaded();
    act(() => result.current.edit(a.id, { bookmarked: true }));
    expect(result.current.sessions![0]!.state.bookmarked).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(result.current.sessions![0]).not.toBe(a));
    expect(result.current.sessions![0]!.state.bookmarked).toBe(true);
    expect(result.current.saveFailed).toBe(false);
  });

  it('rolls back a failed edit and reports it', async () => {
    server.patch = () => Response.json({ error: 'nope' }, { status: 500 });
    const { result } = await loaded();
    act(() => result.current.edit(a.id, { status: 'done' }));
    expect(result.current.sessions![0]!.state.status).toBe('done');
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(result.current.sessions![0]!.state.status).toBe('todo');
  });

  it('sends only the changed field in the PATCH body', async () => {
    const { result } = await loaded();
    act(() => result.current.edit(a.id, { status: 'done' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true),
    );
    const [path, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(path).toBe(`/api/sessions/${a.id}`);
    expect(JSON.parse(init.body)).toEqual({ status: 'done' });
  });

  it('reconnects after the stream drops and refetches what it missed', async () => {
    const { result } = await loaded();
    const b = session({ title: 'B', at: [10, 23, 10, 0] });
    server.sessions = [a, b]; // changed while the stream is down: no event for it
    await act(async () => events.end());
    // First retry waits 1 s (reconnectDelay).
    await waitFor(() => expect(eventsOpened).toBe(2), { timeout: 2500 });
    await waitFor(() => expect(result.current.sessions!.map((s) => s.title)).toEqual(['A', 'B']));
  });

  it('reload fetches the list again', async () => {
    const { result } = await loaded();
    server.sessions = [];
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.sessions).toEqual([]));
  });
});
