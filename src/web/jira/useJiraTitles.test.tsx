// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraTitlesResponse } from '../../shared/api';
import { useJiraTitles } from './useJiraTitles';

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

const AT = '2026-10-24T09:00:00.000Z';
let cached: JiraTitlesResponse;
let events: ReadableStreamDefaultController<Uint8Array>;
let calls: string[];
let refreshGate: Promise<void>;

beforeEach(() => {
  cached = { titles: { 'FA-1': { title: 'Old', status: 'To Do' } }, lastRun: null };
  calls = [];
  refreshGate = Promise.resolve();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${path}`);
      if (path === '/api/events') {
        return new Response(new ReadableStream({ start: (c) => void (events = c) }));
      }
      if (path === '/api/jira/titles/refresh') {
        await refreshGate;
        cached = {
          titles: { 'FA-1': { title: 'Fresh', status: 'Done' } },
          lastRun: { at: AT, ok: true },
        };
      }
      return Response.json(cached);
    }),
  );
});

describe('useJiraTitles', () => {
  it('loads the cache and refetches on sessions-changed', async () => {
    const { result } = renderHook(() => useJiraTitles(true));
    await waitFor(() => expect(result.current.titles['FA-1']?.title).toBe('Old'));
    cached = { titles: { 'FA-1': { title: 'New', status: 'To Do' } }, lastRun: null };
    await waitFor(() => expect(events).toBeDefined());
    act(() => events.enqueue(new TextEncoder().encode('event: sessions-changed\ndata: {}\n\n')));
    await waitFor(() => expect(result.current.titles['FA-1']?.title).toBe('New'));
  });

  it('refresh POSTs, shows it is busy, then shows the new cache', async () => {
    let open!: () => void;
    refreshGate = new Promise((r) => (open = r));
    const { result } = renderHook(() => useJiraTitles(true));
    await waitFor(() => expect(result.current.titles['FA-1']).toBeDefined());
    act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(true);
    open();
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.titles['FA-1']?.title).toBe('Fresh');
    expect(result.current.lastRun).toEqual({ at: AT, ok: true });
    expect(calls).toContain('POST /api/jira/titles/refresh');
  });

  it('asks for nothing when off (Personal)', async () => {
    const { result } = renderHook(() => useJiraTitles(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    expect(result.current.titles).toEqual({});
  });
});
