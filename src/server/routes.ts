import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  BulkIdsBody,
  NewSessionBody,
  SESSIONS_CHANGED,
  SessionPatchBody,
  type EnvsResponse,
  SessionsQuery,
  type AutoArchiveResponse,
  type BulkTrashResponse,
  type ConfigResponse,
  type ErrorResponse,
  type JiraInboxResponse,
  type JiraTitlesResponse,
  type NewSessionResponse,
  type PurgeResponse,
  type ResumeResponse,
  type RetentionResponse,
  type SessionsResponse,
  type TrashError,
  type TrashResponse,
} from '../shared/api';
import { SessionId, TicketKey } from '../shared/session';
import type { EventHub } from './events';
import type { JiraInbox } from './jobs/jiraInbox';
import type { JiraTitles } from './jobs/jiraTitles';
import { newSessionArgv, resumeArgv, type Launcher } from './launch';
import type { SessionService } from './sessions';
import type { StateStore } from './state';
import type { Trash, TrashOutcome } from './trash';

export interface ApiDeps {
  sessions: SessionService;
  events: EventHub;
  launcher: Launcher;
  trash: Trash;
  state: Pick<StateStore, 'autoArchive' | 'all'>;
  jiraTitles: JiraTitles;
  jiraInbox: JiraInbox;
  /** The page's part of the config, read once at start (ADR 0060). */
  config: ConfigResponse;
  /** The config's jiraBaseUrl; null when unset. */
  jiraBaseUrl: string | null;
  /** Claude Code's cleanupPeriodDays, read on each call; null when its cleanup is off. */
  retention: () => Promise<number | null>;
  /** Comment line sent this often so dead streams are noticed. */
  keepAliveMs?: number;
}

const bad = (error: string): ErrorResponse => ({ error });

const TRASH_ERRORS: Record<TrashError, [status: 404 | 409 | 410 | 500, message: string]> = {
  'not-found': [404, 'no such session'],
  conflict: [409, 'a file is already in the way'],
  gone: [410, 'the trashed files are gone'],
  failed: [500, 'could not move the files'],
};

type TrashAction = 'trash' | 'restore';

export function registerApi(app: Hono, deps: ApiDeps): void {
  app.get('/api/config', (c) => c.json(deps.config satisfies ConfigResponse));

  app.get('/api/sessions', async (c) => {
    const query = SessionsQuery.safeParse(c.req.query());
    const known = deps.config.workspaces.map((w) => w.id);
    if (!query.success || !known.includes(query.data.workspace)) {
      return c.json(bad(`workspace must be one of: ${known.join(', ')}`), 400);
    }
    const sessions = await deps.sessions.list(query.data.workspace);
    return c.json({ sessions } satisfies SessionsResponse);
  });

  app.get('/api/envs', async (c) =>
    c.json({ envs: await deps.sessions.envs() } satisfies EnvsResponse),
  );

  app.get('/api/retention', async (c) =>
    c.json({ cleanupPeriodDays: await deps.retention() } satisfies RetentionResponse),
  );

  // Only ids still in the trash: one restored or purged since needs no Undo.
  app.get('/api/auto-archive', (c) => {
    const record = deps.state.autoArchive();
    if (!record) return c.json({ last: null } satisfies AutoArchiveResponse);
    const entries = deps.state.all();
    const inTrash = (ids: string[]) => ids.filter((id) => entries[id]?.trashed);
    const moved = Object.fromEntries(
      Object.entries(record.moved).map(([workspace, ids]) => [workspace, inTrash(ids)]),
    );
    const last = { at: record.at, moved };
    return c.json({ last } satisfies AutoArchiveResponse);
  });

  app.get('/api/jira/titles', (c) =>
    c.json(deps.jiraTitles.snapshot() satisfies JiraTitlesResponse),
  );

  // On demand: fetches every key again, even fresh ones. Waits for the run (up to 120 s per batch).
  app.post('/api/jira/titles/refresh', async (c) =>
    c.json((await deps.jiraTitles.refresh({ force: true })) satisfies JiraTitlesResponse),
  );

  app.get('/api/jira/inbox', async (c) =>
    c.json({
      ...deps.jiraInbox.snapshot(),
      jiraBaseUrl: deps.jiraBaseUrl,
    } satisfies JiraInboxResponse),
  );

  // The header's Sync button: runs outside the Mon–Fri window too, and waits for the run (up to
  // 120 s). A run already in flight is joined.
  app.post('/api/jira/inbox/sync', async (c) =>
    c.json({
      ...(await deps.jiraInbox.sync()),
      jiraBaseUrl: deps.jiraBaseUrl,
    } satisfies JiraInboxResponse),
  );

  app.patch('/api/sessions/:id', async (c) => {
    const id = SessionId.safeParse(c.req.param('id'));
    if (!id.success) return c.json(bad('session id must be a UUID'), 400);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(bad('body must be JSON'), 400);
    }
    const body = SessionPatchBody.safeParse(raw);
    if (!body.success) return c.json(bad('invalid patch'), 400);
    const session = await deps.sessions.patch(id.data, body.data);
    if (!session) return c.json(bad('no such session'), 404);
    return c.json(session);
  });

  app.post('/api/sessions/:id/resume', async (c) => {
    const id = SessionId.safeParse(c.req.param('id'));
    if (!id.success) return c.json(bad('session id must be a UUID'), 400);
    const session = await deps.sessions.resumable(id.data);
    if (!session) return c.json(bad('session file is gone'), 410);
    try {
      await deps.launcher.open(session.cwd, resumeArgv(session.id));
    } catch (err) {
      console.warn(`[launch] ${(err as Error).message}`);
      return c.json(bad('could not open the terminal'), 500);
    }
    return c.json({ ok: true } satisfies ResumeResponse);
  });

  app.post('/api/tickets/:key/new-session', async (c) => {
    const key = TicketKey.safeParse(c.req.param('key'));
    if (!key.success) return c.json(bad('ticket key must look like ABC-123'), 400);
    // The body is optional: no body, or an empty one, starts a session without a name.
    let raw: unknown = {};
    const text = await c.req.text();
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return c.json(bad('body must be JSON'), 400);
      }
    }
    const body = NewSessionBody.safeParse(raw);
    if (!body.success) return c.json(bad('invalid session name'), 400);
    const { id, cwd } = await deps.sessions.startTicketSession(key.data);
    try {
      await deps.launcher.open(cwd, newSessionArgv(id, key.data, body.data.name));
    } catch (err) {
      console.warn(`[launch] ${(err as Error).message}`);
      await deps.sessions.forget(id);
      return c.json(bad('could not open the terminal'), 500);
    }
    return c.json({ sessionId: id } satisfies NewSessionResponse);
  });

  /** Runs one id; a throw (e.g. state.json could not be written) counts as failed. */
  const runTrash = async (action: TrashAction, id: string): Promise<TrashOutcome> => {
    try {
      return await deps.trash[action](id);
    } catch (err) {
      console.warn(`[trash] ${action} ${id}: ${(err as Error).message}`);
      return { ok: false, error: 'failed' };
    }
  };

  for (const action of ['trash', 'restore'] as const) {
    app.post(`/api/sessions/:id/${action}`, async (c) => {
      const id = SessionId.safeParse(c.req.param('id'));
      if (!id.success) return c.json(bad('session id must be a UUID'), 400);
      const outcome = await runTrash(action, id.data);
      if (!outcome.ok) {
        const [status, message] = TRASH_ERRORS[outcome.error];
        return c.json(bad(message), status);
      }
      deps.events.emit();
      return c.json({ ok: true } satisfies TrashResponse);
    });

    // All-or-report: every id runs; the reply says which ones failed and why.
    app.post(`/api/sessions/${action}`, async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(bad('body must be JSON'), 400);
      }
      const body = BulkIdsBody.safeParse(raw);
      if (!body.success) return c.json(bad('ids must be 1 to 200 UUIDs'), 400);
      const results: BulkTrashResponse['results'] = [];
      for (const id of body.data.ids) {
        const outcome = await runTrash(action, id);
        results.push(outcome.ok ? { id, ok: true } : { id, ok: false, error: outcome.error });
      }
      if (results.some((r) => r.ok)) deps.events.emit();
      return c.json({ results } satisfies BulkTrashResponse);
    });
  }

  app.post('/api/trash/purge', async (c) => {
    const purged = await deps.trash.purge();
    return c.json({ purged } satisfies PurgeResponse);
  });

  // Read with fetch, not EventSource, so the token header is sent like on every call (ADR 0013).
  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = deps.events.subscribe(() => {
        void stream.writeSSE({ event: SESSIONS_CHANGED, data: '{}' });
      });
      stream.onAbort(unsubscribe);
      while (!stream.aborted) {
        await stream.sleep(deps.keepAliveMs ?? 25_000);
        if (!stream.aborted) await stream.write(': keep-alive\n\n');
      }
    }),
  );
}
