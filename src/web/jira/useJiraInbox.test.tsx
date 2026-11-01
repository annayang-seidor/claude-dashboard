// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraInboxResponse } from '../../shared/api';
import { useJiraInbox } from './useJiraInbox';

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

const AT = '2026-10-26T02:00:00.000Z';
const result = (syncedAt: string) => ({ syncedAt, items: [] });
let stored: JiraInboxResponse;
let events: ReadableStreamDefaultController<Uint8Array>;
let calls: string[];
let syncGate: Promise<void>;

beforeEach(() => {
  stored = {
    result: result(AT),
    lastAttempt: { at: AT, ok: true, promptVersion: 3 },
    jiraBaseUrl: null,
  };
  calls = [];
  syncGate = Promise.resolve();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${path}`);
      if (path === '/api/events') {
        return new Response(new ReadableStream({ start: (c) => void (events = c) }));
      }
      if (path === '/api/jira/inbox/sync') {
        await syncGate;
        stored = {
          ...stored,
          lastAttempt: { at: '2026-10-26T02:45:00.000Z', ok: false, reason: 'timeout' },
        };
      }
      return Response.json(stored);
    }),
  );
});

describe('useJiraInbox', () => {
  it('loads the stored result and refetches on sessions-changed', async () => {
    const { result: hook } = renderHook(() => useJiraInbox(true));
    expect(hook.current.loaded).toBe(false);
    await waitFor(() => expect(hook.current.result?.syncedAt).toBe(AT));
    expect(hook.current.loaded).toBe(true);
    stored = { ...stored, result: result('2026-10-26T02:45:00.000Z') };
    await waitFor(() => expect(events).toBeDefined());
    act(() => events.enqueue(new TextEncoder().encode('event: sessions-changed\ndata: {}\n\n')));
    await waitFor(() => expect(hook.current.result?.syncedAt).toBe('2026-10-26T02:45:00.000Z'));
  });

  it('sync POSTs, shows it is busy, then shows how it went', async () => {
    let open!: () => void;
    syncGate = new Promise((r) => (open = r));
    const { result: hook } = renderHook(() => useJiraInbox(true));
    await waitFor(() => expect(hook.current.result).not.toBeNull());
    act(() => hook.current.sync());
    expect(hook.current.syncing).toBe(true);
    open();
    await waitFor(() => expect(hook.current.syncing).toBe(false));
    expect(hook.current.lastAttempt).toMatchObject({ ok: false, reason: 'timeout' });
    expect(hook.current.result?.syncedAt).toBe(AT);
    expect(calls).toContain('POST /api/jira/inbox/sync');
  });

  it('asks for nothing when off (Personal)', async () => {
    const { result: hook } = renderHook(() => useJiraInbox(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    expect(hook.current.result).toBeNull();
    expect(hook.current.loaded).toBe(false);
  });
});
