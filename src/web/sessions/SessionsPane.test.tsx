// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession, TrashError } from '../../shared/api';
import type { AutoArchiveRecord } from '../../shared/state';
import { accessStore } from '../api';
import { AccessLost } from '../shell/AccessLost';
import { SessionsPane } from './SessionsPane';
import { renderEn, session } from './testing';

afterEach(cleanup);

const gone = session({ title: 'Gone session', ticketKey: 'FA-540', at: [10, 23, 9, 0] });
const kept = session({ title: 'Kept session', ticketKey: 'FA-540', at: [10, 23, 8, 0] });

const DAY_MS = 86_400_000;
/** Bookmarked and idle for 25 days, by the real clock the pane uses: 5 days before Claude Code's
 * 30-day cleanup. */
const nearCleanup = session({
  title: 'Old bookmarked session',
  ticketKey: 'FA-540',
  at: [10, 1, 9, 0],
  bookmarked: true,
  lastActivityAt: new Date(Date.now() - 25 * DAY_MS).toISOString(),
});

/** status per POST path; anything unlisted answers 200. */
let postStatus: Record<string, number>;
let posts: string[];
/** GET /api/retention answer; a number is cleanupPeriodDays, 'fail' a 500. */
let retention: number | null | 'fail';
/** Status of the next GET /api/sessions answers, in order; then 200. */
let listStatus: number[];
/** Listed after the three above. */
let extra: ApiSession[];
/** JSON bodies of POSTs, in order. */
let postBodies: unknown[];
/** Bulk trash and restore: the error for an id; unlisted ids succeed. */
let bulkError: Record<string, TrashError>;
/** GET /api/auto-archive `last`. */
let archived: AutoArchiveRecord | null;
/** PATCH answers wait for this, then use this status. */
let patchGate: Promise<void>;
let patchStatus: number;

beforeEach(() => {
  postStatus = {};
  posts = [];
  retention = 30;
  listStatus = [];
  extra = [];
  postBodies = [];
  bulkError = {};
  archived = null;
  patchGate = Promise.resolve();
  patchStatus = 200;
  localStorage.clear();
  accessStore.reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      if (path === '/api/events') return new Response(new ReadableStream());
      if (path.startsWith('/api/sessions?')) {
        const status = listStatus.shift() ?? 200;
        if (status !== 200) return Response.json({ error: 'x' }, { status });
        return Response.json({ sessions: [gone, kept, nearCleanup, ...extra] });
      }
      if (path === '/api/auto-archive') return Response.json({ last: archived });
      if (path === '/api/retention') {
        if (retention === 'fail') return Response.json({ error: 'x' }, { status: 500 });
        return Response.json({ cleanupPeriodDays: retention });
      }
      if (init.method === 'PATCH') {
        await patchGate;
        if (patchStatus !== 200) return Response.json({ error: 'x' }, { status: patchStatus });
        const s = [gone, kept, nearCleanup].find((x) => path.endsWith(x.id))!;
        const body = JSON.parse(init.body as string) as object;
        return Response.json({ ...s, state: { ...s.state, ...body } });
      }
      if (init.method === 'POST') {
        posts.push(path);
        if (init.body) postBodies.push(JSON.parse(init.body as string));
        if (path === '/api/sessions/trash' || path === '/api/sessions/restore') {
          const { ids } = JSON.parse(init.body as string) as { ids: string[] };
          return Response.json({
            results: ids.map((id) =>
              bulkError[id] ? { id, ok: false, error: bulkError[id] } : { id, ok: true },
            ),
          });
        }
        const status = postStatus[path] ?? 200;
        if (status !== 200) return Response.json({ error: 'x' }, { status });
        return Response.json(
          path.includes('/tickets/') ? { sessionId: crypto.randomUUID() } : { ok: true },
        );
      }
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function setup({
  fakeTimers = false,
  workspace = 'work',
}: { fakeTimers?: boolean; workspace?: 'work' | 'personal' } = {}) {
  if (fakeTimers) vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup(
    fakeTimers ? { advanceTimers: vi.advanceTimersByTime.bind(vi) } : {},
  );
  renderEn(<SessionsPane workspace={workspace} query="" />);
  await screen.findByText(gone.title);
  const click = (title: string, name: string) => {
    const row = screen.getByText(title).closest('[data-testid="session-row"]') as HTMLElement;
    return user.click(within(row).getByRole('button', { name }));
  };
  return { user, resume: (title: string) => click(title, 'Resume'), click };
}

const stubClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

describe('rename', () => {
  it('shows the new title at once; a 500 rolls it back with an error toast', async () => {
    let release = () => {};
    patchGate = new Promise((r) => (release = r));
    patchStatus = 500;
    const { user } = await setup();
    await user.dblClick(screen.getByText('Kept session'));
    const input = screen.getByRole('textbox', { name: 'Session title' });
    await user.clear(input);
    await user.type(input, 'Cart fix{Enter}');
    expect(screen.getByText('Cart fix')).toBeTruthy();
    expect(screen.queryByText('Kept session')).toBeNull();

    release();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Couldn\'t rename "Kept session"',
    );
    expect(screen.getByText('Kept session')).toBeTruthy();
    expect(screen.queryByText('Cart fix')).toBeNull();
  });

  it('Copy resume command writes the command and says so', async () => {
    const writeText = vi.fn(async () => {});
    const { user, click } = await setup();
    // After setup: user-event puts its own clipboard on navigator.
    stubClipboard({ writeText });
    await click('Kept session', 'More actions');
    await user.click(screen.getByRole('menuitem', { name: 'Copy resume command' }));
    expect(writeText).toHaveBeenCalledWith(`claude --resume ${kept.id}`);
    await screen.findByText(`Copied claude --resume ${kept.id}`);
  });

  it('Copy resume command shows an error toast with no clipboard', async () => {
    const { user, click } = await setup();
    stubClipboard(undefined);
    await click('Kept session', 'More actions');
    await user.click(screen.getByRole('menuitem', { name: 'Copy resume command' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't copy to the clipboard",
    );
  });
});

describe('SessionsPane launch actions', () => {
  it('Resume POSTs and shows no toast on success', async () => {
    const { resume } = await setup();
    await resume(kept.title);
    await waitFor(() => expect(posts).toEqual([`/api/sessions/${kept.id}/resume`]));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('410 drops the row and shows an error toast', async () => {
    postStatus[`/api/sessions/${gone.id}/resume`] = 410;
    const { resume } = await setup();
    await resume(gone.title);
    expect((await screen.findByRole('alert')).textContent).toBe('"Gone session" no longer exists');
    expect(screen.queryByText(gone.title)).toBeNull();
    expect(screen.getByText(kept.title)).toBeTruthy();
  });

  it('other failures keep the row and say the terminal did not open', async () => {
    postStatus[`/api/sessions/${kept.id}/resume`] = 500;
    const { resume } = await setup();
    await resume(kept.title);
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't open the terminal");
    expect(screen.getByText(kept.title)).toBeTruthy();
  });

  it('New session POSTs the name for the ticket, and toasts when it fails', async () => {
    postStatus['/api/tickets/FA-540/new-session'] = 500;
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'New session for this ticket' }));
    await user.keyboard('{End} cart{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't open the terminal");
    expect(posts).toEqual(['/api/tickets/FA-540/new-session']);
    expect(postBodies).toEqual([{ name: 'FA-540 cart' }]);
  });

  it('New session with an empty name POSTs no body', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'New session for this ticket' }));
    await user.clear(screen.getByRole('textbox', { name: 'Session name' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(posts).toEqual(['/api/tickets/FA-540/new-session']));
    expect(postBodies).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Session name' })).toBeNull());
  });
});

describe('SessionsPane delete', () => {
  afterEach(() => vi.useRealTimers());

  it('hides the row, offers Undo for 8 s, and Undo restores it', async () => {
    const { user, click } = await setup({ fakeTimers: true });
    await click(kept.title, 'Delete');
    expect(screen.queryByText(kept.title)).toBeNull();
    const toast = (await screen.findByText('Deleted "Kept session"')).parentElement!;
    expect(toast.getAttribute('role')).toBe('status');
    expect(posts).toEqual([`/api/sessions/${kept.id}/trash`]);

    vi.advanceTimersByTime(7900);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByText(kept.title)).toBeTruthy());
    expect(posts).toEqual([`/api/sessions/${kept.id}/trash`, `/api/sessions/${kept.id}/restore`]);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('the Undo toast goes away after 8 s', async () => {
    const { click } = await setup({ fakeTimers: true });
    await click(kept.title, 'Delete');
    await screen.findByRole('button', { name: 'Undo' });
    vi.advanceTimersByTime(8000);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    expect(screen.queryByText(kept.title)).toBeNull();
  });

  it('a failed delete brings the row back with an error toast', async () => {
    postStatus[`/api/sessions/${kept.id}/trash`] = 500;
    const { click } = await setup();
    await click(kept.title, 'Delete');
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn\'t delete "Kept session"');
    expect(screen.getByText(kept.title)).toBeTruthy();
  });

  it('a failed Undo says so and leaves the row hidden', async () => {
    postStatus[`/api/sessions/${kept.id}/restore`] = 409;
    const { user, click } = await setup();
    await click(kept.title, 'Delete');
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn\'t restore "Kept session"');
    expect(screen.queryByText(kept.title)).toBeNull();
  });
});

/** Done and idle 20 days by the real clock: the 2-week Clean up takes them. */
const stale = (title: string) =>
  session({
    title,
    ticketKey: 'FA-600',
    at: [10, 1, 9, 0],
    status: 'done',
    lastActivityAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
  });

describe('SessionsPane Clean up', () => {
  const openCleanup = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Clean up' }));
    return screen.getByRole('dialog', { name: 'Clean up old sessions' });
  };

  it('trashes the previewed sessions in one bulk call, and Undo restores them all', async () => {
    const a = stale('Stale A');
    const b = stale('Stale B');
    extra = [a, b];
    const { user } = await setup();
    const dialog = await openCleanup(user);
    // gone and kept are To do, nearCleanup is bookmarked: only the stale pair goes.
    expect(within(dialog).getByText('Will delete 2 session(s)')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 session(s)' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Deleted 2 session(s)')).toBeTruthy();
    expect(posts).toEqual(['/api/sessions/trash']);
    expect(postBodies).toEqual([{ ids: [a.id, b.id] }]);
    expect(screen.queryByText(a.title)).toBeNull();
    expect(screen.queryByText(b.title)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(posts).toEqual(['/api/sessions/trash', '/api/sessions/restore']));
    expect(postBodies[1]).toEqual({ ids: [a.id, b.id] });
    expect(await screen.findByText(a.title)).toBeTruthy();
    expect(screen.getByText(b.title)).toBeTruthy();
  });

  it('says how many could not be moved, shows those rows again, and Undo restores only the rest', async () => {
    const a = stale('Stale A');
    const b = stale('Stale B');
    extra = [a, b];
    bulkError[b.id] = 'conflict';
    const { user } = await setup();
    await user.click(
      within(await openCleanup(user)).getByRole('button', { name: 'Delete 2 session(s)' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Deleted 1 session(s); 1 couldn't be moved",
    );
    expect(screen.queryByText(a.title)).toBeNull();
    expect(screen.getByText(b.title)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(postBodies[1]).toEqual({ ids: [a.id] }));
  });

  it('opens from the Personal page too', async () => {
    const { user } = await setup({ workspace: 'personal' });
    const dialog = await openCleanup(user);
    expect(within(dialog).getByText('Based on last activity. Only ~/o sessions are affected.'));
  });
});

describe('SessionsPane auto-archive note', () => {
  const at = '2026-10-24T01:00:00.000Z';
  const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];

  it('shows "N scratch sessions moved to trash" once per run, with Undo restoring them all', async () => {
    archived = { at, moved: { work: ids, personal: [] } };
    const { user } = await setup();
    expect(await screen.findByText('2 scratch sessions moved to trash')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(posts).toEqual(['/api/sessions/restore']));
    expect(postBodies).toEqual([{ ids }]);

    // The next load of the same run says nothing.
    cleanup();
    await setup();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('2 scratch sessions moved to trash')).toBeNull();
  });

  it('a later run shows again', async () => {
    archived = { at, moved: { work: ids.slice(0, 1), personal: [] } };
    await setup();
    expect(await screen.findByText('1 scratch session moved to trash')).toBeTruthy();
    cleanup();
    archived = { at: '2026-10-25T01:00:00.000Z', moved: { work: ids, personal: [] } };
    await setup();
    expect(await screen.findByText('2 scratch sessions moved to trash')).toBeTruthy();
  });

  it('each page tells only its own workspace', async () => {
    archived = { at, moved: { work: ids, personal: ids.slice(0, 1) } };
    await setup({ workspace: 'personal' });
    expect(await screen.findByText('1 idle session moved to trash')).toBeTruthy();
    expect(screen.queryByText(/scratch sessions moved/)).toBeNull();
  });

  it('says nothing when the run moved nothing from this workspace', async () => {
    archived = { at, moved: { work: [], personal: ids } };
    await setup();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/moved to trash/)).toBeNull();
  });
});

describe('SessionsPane retention', () => {
  const rowOf = (title: string) =>
    screen.getByText(title).closest('[data-testid="session-row"]') as HTMLElement;

  it('warns on a bookmarked row 5 days before Claude Code removes it', async () => {
    await setup();
    const row = rowOf(nearCleanup.title);
    expect(await within(row).findByText('Claude Code removes this in 5 days')).toBeTruthy();
    expect(within(rowOf(kept.title)).queryByText(/Claude Code removes/)).toBeNull();
  });

  it('follows cleanupPeriodDays from settings, and shows nothing when cleanup is off', async () => {
    retention = 27;
    await setup();
    expect(await screen.findByText('Claude Code removes this in 2 days')).toBeTruthy();
    cleanup();
    retention = null;
    await setup();
    expect(screen.queryByText(/Claude Code removes/)).toBeNull();
  });

  it('shows no warning when settings cannot be loaded', async () => {
    retention = 'fail';
    await setup();
    expect(screen.queryByText(/Claude Code removes/)).toBeNull();
  });

  it('explains what a bookmark does not protect, on the first bookmark only', async () => {
    const { click } = await setup();
    await screen.findByText('Claude Code removes this in 5 days'); // retention loaded
    await click(kept.title, 'Bookmark');
    const note = await screen.findByText(
      "Bookmarks only protect sessions from this dashboard's own cleanup. Claude Code still deletes sessions idle for 30 days.",
    );
    expect(note.parentElement!.getAttribute('role')).toBe('status');

    cleanup();
    await setup().then(({ click: again }) => again(gone.title, 'Bookmark'));
    expect(screen.queryByText(/Bookmarks only protect/)).toBeNull();
  });

  it('removing a bookmark never shows the note', async () => {
    const { click } = await setup();
    await click(nearCleanup.title, 'Bookmark');
    expect(screen.queryByText(/Bookmarks only protect/)).toBeNull();
  });
});

describe('SessionsPane load failure', () => {
  it('says the list could not load and Try again loads it', async () => {
    listStatus = [500];
    const user = userEvent.setup();
    renderEn(<SessionsPane workspace="work" query="" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load sessions.");
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(kept.title)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SessionsPane after a 403', () => {
  it('shows the new-link banner instead of the load error', async () => {
    listStatus = [403];
    renderEn(
      <>
        <AccessLost />
        <SessionsPane workspace="work" query="" />
      </>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Server restarted — open the new linkRun open "$(cat ~/.claude-dashboard/url)" in a terminal to open it.Reconnect',
    );
    expect(screen.queryByText("Couldn't load sessions.")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
