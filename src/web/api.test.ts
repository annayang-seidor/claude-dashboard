// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { accessStore, api, followEvents, reconnectDelay, subscribeEvents } from './api';

/** Each fetch of /api/events takes the next answer: a status code, or an open stream that `end()`
 * closes. */
type Answer = number | { end: () => void; push: (text: string) => void };

function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  const enc = new TextEncoder();
  return {
    body,
    answer: {
      push: (text: string) => controller.enqueue(enc.encode(text)),
      end: () => controller.close(),
    },
  };
}

let calls: number;
let script: (() => Response)[];
const answers: Answer[] = [];

/** Queues the answers for the next fetches, in order. */
function serve(...kinds: ('stream' | number)[]) {
  for (const kind of kinds) {
    if (kind === 'stream') {
      const s = openStream();
      answers.push(s.answer);
      script.push(() => new Response(s.body));
    } else {
      answers.push(kind);
      script.push(() => new Response(null, { status: kind }));
    }
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  accessStore.reset();
  vi.useFakeTimers();
  calls = 0;
  script = [];
  answers.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = script[calls++];
      if (!next) return new Promise<Response>(() => {}); // never answers
      return next();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reconnectDelay', () => {
  it('doubles from 1 s and stops at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});

describe('followEvents', () => {
  it('passes events on, and after a drop reconnects in 1 s and asks for a refetch', async () => {
    serve('stream', 'stream');
    const abort = new AbortController();
    const events: string[] = [];
    const onReconnect = vi.fn();
    void followEvents('/api/events', (e) => events.push(e), abort.signal, onReconnect);
    await flush();
    (answers[0] as Exclude<Answer, number>).push('event: sessions-changed\ndata: {}\n\n');
    await flush();
    expect(events).toEqual(['sessions-changed']);
    expect(onReconnect).not.toHaveBeenCalled(); // the first connect is not a reconnect

    (answers[0] as Exclude<Answer, number>).end();
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect(onReconnect).toHaveBeenCalledOnce();
    abort.abort();
  });

  it('backs off 1, 2, 4 s while the server refuses, and resets after it is back', async () => {
    serve(503, 503, 502, 'stream', 503);
    const abort = new AbortController();
    const onReconnect = vi.fn();
    void followEvents('/api/events', () => {}, abort.signal, onReconnect);
    await flush();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(4);
    // Connected after failures only: still no "re"connect, since nothing was missed before it.
    expect(onReconnect).not.toHaveBeenCalled();

    (answers[3] as Exclude<Answer, number>).end();
    await vi.advanceTimersByTimeAsync(1000); // back to 1 s, not 8 s
    expect(calls).toBe(5);
    abort.abort();
  });

  it('stops for good on abort, also while waiting to reconnect', async () => {
    serve(503);
    const abort = new AbortController();
    const done = followEvents(
      '/api/events',
      () => {},
      abort.signal,
      () => {},
    );
    await flush();
    abort.abort();
    await expect(done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
  });

  it('stops for good on a 403: the token was refused, so retrying cannot help', async () => {
    serve('stream', 403, 'stream');
    const abort = new AbortController();
    const done = followEvents(
      '/api/events',
      () => {},
      abort.signal,
      () => {},
    );
    await flush();
    expect(accessStore.get()).toBe(false);
    (answers[0] as Exclude<Answer, number>).end();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await expect(done).resolves.toBeUndefined();
    expect(accessStore.get()).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(2);
  });

  it('does not reconnect after another call got a 403', async () => {
    serve('stream');
    script.push(() => new Response(null, { status: 403 })); // the api() call below
    const abort = new AbortController();
    void followEvents(
      '/api/events',
      () => {},
      abort.signal,
      () => {},
    );
    await flush();
    await expect(api('/api/sessions?workspace=work', z.unknown())).rejects.toThrow('403');
    (answers[0] as Exclude<Answer, number>).end();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    abort.abort();
  });
});

describe('accessStore', () => {
  it('flips on the first 403 only, and tells subscribers once', async () => {
    const listener = vi.fn();
    const unsubscribe = accessStore.subscribe(listener);
    script.push(
      () => new Response(null, { status: 500 }),
      () => new Response(null, { status: 403 }),
      () => new Response(null, { status: 403 }),
    );
    for (let i = 0; i < 3; i++) await api('/api/health', z.unknown()).catch(() => {});
    expect(accessStore.get()).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});

describe('subscribeEvents', () => {
  it('shares one stream between subscribers and closes it after the last one leaves', async () => {
    serve('stream', 'stream');
    const a: string[] = [];
    const b: string[] = [];
    const offA = subscribeEvents(
      (e) => a.push(e),
      () => {},
    );
    const offB = subscribeEvents(
      (e) => b.push(e),
      () => {},
    );
    await flush();
    expect(calls).toBe(1);
    (answers[0] as Exclude<Answer, number>).push('event: sessions-changed\ndata: {}\n\n');
    await flush();
    expect([a, b]).toEqual([['sessions-changed'], ['sessions-changed']]);

    offA();
    (answers[0] as Exclude<Answer, number>).push('event: sessions-changed\ndata: {}\n\n');
    await flush();
    expect([a.length, b.length]).toEqual([1, 2]);

    offB();
    // Closed: no reconnect follows, and the next subscriber opens a new stream.
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1);
    const offC = subscribeEvents(
      () => {},
      () => {},
    );
    await flush();
    expect(calls).toBe(2);
    offC();
  });

  it('tells every subscriber about a reconnect', async () => {
    serve('stream', 'stream');
    const ra = vi.fn();
    const rb = vi.fn();
    const offA = subscribeEvents(() => {}, ra);
    const offB = subscribeEvents(() => {}, rb);
    await flush();
    (answers[0] as Exclude<Answer, number>).end();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ra).toHaveBeenCalledOnce();
    expect(rb).toHaveBeenCalledOnce();
    offA();
    offB();
  });
});
