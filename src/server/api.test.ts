import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SESSIONS_CHANGED,
  SessionsResponse,
  ApiSession,
  NewSessionResponse,
  AutoArchiveResponse,
  BulkTrashResponse,
  RetentionResponse,
  EnvsResponse,
  JiraInboxResponse,
  JiraTitlesResponse,
} from '../shared/api';
import { parse as parseToml } from 'smol-toml';
import { readHacEnvs } from './hac';
import { DEFAULT_PAGE_CONFIG, TOKEN_HEADER } from '../shared/config';
import { allowLists, createApp } from './app';
import { createEventHub } from './events';
import { createIndexer } from './indexer';
import { PROMPT_PATH, createJiraInbox, parsePromptFile } from './jobs/jiraInbox';
import { createJiraTitles } from './jobs/jiraTitles';
import type { Runner } from './jobs/runner';
import type { Launcher } from './launch';
import { createSessionService } from './sessions';
import { openStateStore, type StateStore } from './state';
import { readCleanupPeriodDays } from './retention';
import { createTrash } from './trash';
import { runnerProjectFolder, watchProjects, type ProjectsWatcher } from './watch';

const FIXTURES = fileURLToPath(new URL('../../fixtures/projects', import.meta.url));
const HAC_FIXTURES = fileURLToPath(new URL('../../fixtures/hac-cli', import.meta.url));
const hacId = 'aaaaaaaa-1111-4111-8111-000000000001';
// Fixture cwds were recorded under this home folder; nothing is read from it.
const HOME = '/Users/annayang';
const PORT = 4317;
const TOKEN = 'test-token-0123456789abcdefghijklmnop';
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ids = {
  custom: 'd4a1e24c-0df7-402e-bc9a-e61cf8aa9430',
  outside: '0328999a-b8be-4c87-bbd8-3ed22bf1a42d',
  noBranch: '506e8f56-0f29-42df-bb2d-509897b85cf3',
  sidechain: '55e4d22f-af40-4a4d-a574-195e5c9a227a',
  ticket: 'da917231-5cde-47ba-b5ab-6904b3ceb8c4',
  multiBranch: 'dd025063-4c86-4d33-a339-1e858b458e39',
};
const orphanId = '11111111-2222-4333-8444-555555555555';
const trashedId = '66666666-7777-4888-9999-aaaaaaaaaaaa';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

interface Setup {
  root: string;
  statePath: string;
  trashDir: string;
  /** Stand-in for ~/.claude/settings.json; absent unless a test writes it. */
  settingsPath: string;
  request: (
    method: string,
    path: string,
    init?: { body?: unknown; headers?: object },
  ) => Response | Promise<Response>;
  watcher?: ProjectsWatcher;
  /** Every launcher.open call, as [cwd, argv]. */
  launches: [string, readonly string[]][];
  state: StateStore;
  /** Every prompt the fake runner was given. */
  prompts: string[];
}

async function setup(
  opts: {
    watch?: boolean;
    state?: object;
    root?: string;
    launchFails?: boolean;
    /** Adds the hac transcript fixture and serves envs from the hac toml fixture. */
    hac?: boolean;
    /** What the fake runner answers; defaults to a failed run. */
    run?: Runner['run'];
    /** config.json's jiraBaseUrl; unset by default. */
    jiraBaseUrl?: string;
  } = {},
): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), 'api-test-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const root = opts.root ?? join(dir, 'projects');
  if (!opts.root) cpSync(FIXTURES, root, { recursive: true });
  if (opts.hac) {
    const file = `${hacId}.jsonl`;
    cpSync(join(HAC_FIXTURES, file), join(root, '-Users-annayang-y-acme-shop', file));
  }
  const statePath = join(dir, 'state.json');
  if (opts.state) writeFileSync(statePath, JSON.stringify(opts.state));

  const state = await openStateStore({ path: statePath, log: () => {} });
  const sessions = createSessionService({
    indexer: createIndexer({ projectsRoot: root, home: HOME, findRepoRoot: () => null }),
    state,
    projectsRoot: root,
    workRoot: `${HOME}/y`,
    workIds: ['work'],
    ...(opts.hac && {
      envs: async () => ({ envs: await readHacEnvs(HAC_FIXTURES, () => {}) }),
    }),
    log: () => {},
  });
  const trashDir = join(dir, 'trash');
  const trash = createTrash({
    state,
    projectsRoot: root,
    trashDir,
    locate: async (id) => (await sessions.resumable(id))?.filePath ?? null,
    log: () => {},
  });
  const settingsPath = join(dir, 'settings.json');
  const events = createEventHub();
  const launches: Setup['launches'] = [];
  const launcher: Launcher = {
    async open(cwd, argv) {
      if (opts.launchFails) throw new Error('spawn osascript ENOENT');
      launches.push([cwd, argv]);
    },
  };
  await sessions.rescan();
  const prompts: string[] = [];
  const runner: Runner = {
    run: (req) => {
      prompts.push(req.prompt);
      return opts.run ? opts.run(req) : Promise.resolve({ ok: false, reason: 'failed' });
    },
  };
  const jiraInbox = createJiraInbox({ runner, state });
  const jiraTitles = createJiraTitles({
    runner,
    state,
    keys: async () =>
      (await sessions.list('work')).flatMap((s) => (s.ticketKey ? [s.ticketKey] : [])),
  });

  let watcher: ProjectsWatcher | undefined;
  if (opts.watch) {
    let lastChange = Date.now();
    watcher = watchProjects({
      projectsRoot: root,
      ignore: [runnerProjectFolder(root, HOME)],
      onChange: () => {
        lastChange = Date.now();
        void sessions.rescan().then(() => events.emit());
      },
    });
    cleanups.push(() => watcher!.close());
    await watcher.ready;
    // macOS can deliver late `add` events for the fixture copy after `ready`; let them flush
    // before a test opens /api/events, so it only sees changes it makes itself.
    await waitFor(() => Date.now() - lastChange > 1000, 5000);
  }

  const app = createApp({
    ...allowLists(PORT, undefined),
    token: TOKEN,
    api: {
      sessions,
      events,
      launcher,
      trash,
      state,
      jiraTitles,
      jiraInbox,
      config: DEFAULT_PAGE_CONFIG,
      jiraBaseUrl: opts.jiraBaseUrl ?? null,
      retention: () => readCleanupPeriodDays(settingsPath, () => {}),
      keepAliveMs: 50,
    },
  });
  const request: Setup['request'] = (method, path, init = {}) =>
    app.request(`${ORIGIN}${path}`, {
      method,
      headers: {
        host: `127.0.0.1:${PORT}`,
        origin: ORIGIN,
        [TOKEN_HEADER]: TOKEN,
        ...(init.body !== undefined && { 'content-type': 'application/json' }),
        ...init.headers,
      },
      body:
        init.body === undefined
          ? undefined
          : typeof init.body === 'string'
            ? init.body
            : JSON.stringify(init.body),
    });
  return { root, statePath, trashDir, settingsPath, request, watcher, launches, state, prompts };
}

async function list(s: Setup, workspace: string) {
  const res = await s.request('GET', `/api/sessions?workspace=${workspace}`);
  expect(res.status).toBe(200);
  return SessionsResponse.parse(await res.json()).sessions;
}

const transcript = (cwd: string, prompt: string) =>
  JSON.stringify({
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    cwd,
    gitBranch: 'main',
    message: { role: 'user', content: prompt },
  }) + '\n';

/** Collects SSE event names from /api/events until `stop()`. */
async function openEvents(s: Setup) {
  const res = await s.request('GET', '/api/events');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const names: string[] = [];
  let text = '';
  let stopped = false;
  void (async () => {
    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      for (let end = text.indexOf('\n\n'); end !== -1; end = text.indexOf('\n\n')) {
        const block = text.slice(0, end);
        text = text.slice(end + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        if (name) names.push(name);
      }
    }
  })().catch(() => {});
  const stop = async () => {
    stopped = true;
    await reader.cancel().catch(() => {});
  };
  cleanups.push(stop);
  return { names, stop };
}

async function waitFor(check: () => boolean, ms: number): Promise<number> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
  return Date.now() - start;
}

describe('GET /api/sessions', () => {
  it('lists each workspace merged with default state', async () => {
    const s = await setup();
    const work = await list(s, 'work');
    expect(work.map((x) => x.id).sort()).toEqual(
      [ids.noBranch, ids.sidechain, ids.ticket, ids.multiBranch].sort(),
    );
    const personal = await list(s, 'personal');
    expect(personal.map((x) => x.id).sort()).toEqual([ids.custom, ids.outside].sort());
    for (const x of [...work, ...personal]) {
      expect(x.state).toEqual({ status: 'todo', bookmarked: false });
      expect(x.category).toBe(x.autoCategory);
    }
  });

  it.each([['workspace=other'], [''], ['workspace=']])('400 for query "%s"', async (q) => {
    const s = await setup();
    const res = await s.request('GET', `/api/sessions?${q}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'workspace must be one of: work, personal' });
  });

  it('still needs the token', async () => {
    const s = await setup();
    const res = await s.request('GET', '/api/sessions?workspace=work', {
      headers: { [TOKEN_HEADER]: 'wrong' },
    });
    expect(res.status).toBe(403);
  });
});

describe('environments', () => {
  it('GET /api/envs lists hac envs with tag text and prod', async () => {
    const s = await setup({ hac: true });
    const res = await s.request('GET', '/api/envs');
    expect(res.status).toBe(200);
    const { envs } = EnvsResponse.parse(await res.json());
    expect(envs.map((e) => [e.name, e.display, e.prod])).toEqual([
      ['d3', 'D3', false],
      ['local', 'LOCAL', false],
      ['p1', 'P1', true],
      ['s1', 'S1', false],
    ]);
  });

  it('lists a session with hac calls as Ops with its env', async () => {
    const s = await setup({ hac: true });
    const row = (await list(s, 'work')).find((x) => x.id === hacId)!;
    expect(row).toMatchObject({
      category: 'ops',
      env: { project: 'acme', name: 's1', display: 'S1', prod: false },
      autoEnv: { project: 'acme', name: 's1' },
    });
  });

  it('PATCH sets and clears envOverride and releaseLabel', async () => {
    const s = await setup({ hac: true });
    let res = await s.request('PATCH', `/api/sessions/${hacId}`, {
      body: { envOverride: 'acme/p1', releaseLabel: '  2026.10 go-live ' },
    });
    let body = ApiSession.parse(await res.json());
    expect(body.env).toMatchObject({ name: 'p1', prod: true });
    expect(body.state).toMatchObject({
      envOverride: 'acme/p1',
      releaseLabel: '2026.10 go-live',
    });

    res = await s.request('PATCH', `/api/sessions/${hacId}`, {
      body: { envOverride: null, releaseLabel: null },
    });
    body = ApiSession.parse(await res.json());
    expect(body.env?.name).toBe('s1');
    expect(body.state).toEqual({ status: 'todo', bookmarked: false });
  });

  it.each([
    ['a bad env ref', { envOverride: 'a/b/c' }],
    ['an empty release label', { releaseLabel: '   ' }],
    ['a long release label', { releaseLabel: 'x'.repeat(81) }],
  ])('400 for %s', async (_label, body) => {
    const s = await setup({ hac: true });
    const res = await s.request('PATCH', `/api/sessions/${hacId}`, { body });
    expect(res.status).toBe(400);
  });

  it('never sends a url, username or password from the hac config', async () => {
    const s = await setup({ hac: true });
    const doc = parseToml(readFileSync(join(HAC_FIXTURES, 'acme.toml'), 'utf8')) as {
      envs: Record<string, Record<string, unknown>>;
    };
    const secrets = Object.values(doc.envs)
      .flatMap((t) => [t.url, t.username, t.password])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    expect(secrets.length).toBeGreaterThanOrEqual(9);
    const bodies = await Promise.all(
      ['/api/envs', '/api/sessions?workspace=work', '/api/sessions?workspace=personal'].map(
        async (path) => (await s.request('GET', path)).text(),
      ),
    );
    const leaked = secrets.filter((v) => bodies.some((b) => b.includes(v))).length;
    expect(leaked, 'a secret value reached an API response').toBe(0);
  });
});

describe('GET /api/retention', () => {
  const get = async (s: Setup) => {
    const res = await s.request('GET', '/api/retention');
    expect(res.status).toBe(200);
    return RetentionResponse.parse(await res.json()).cleanupPeriodDays;
  };

  it('reads cleanupPeriodDays on each call, 30 when unset, null when 0', async () => {
    const s = await setup();
    expect(await get(s)).toBe(30);
    writeFileSync(s.settingsPath, JSON.stringify({ theme: 'dark', cleanupPeriodDays: 365 }));
    expect(await get(s)).toBe(365);
    writeFileSync(s.settingsPath, JSON.stringify({ cleanupPeriodDays: 0 }));
    expect(await get(s)).toBeNull();
  });

  it('still needs the token', async () => {
    const s = await setup();
    const res = await s.request('GET', '/api/retention', { headers: { [TOKEN_HEADER]: 'x' } });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/auto-archive', () => {
  const get = async (s: Setup) => {
    const res = await s.request('GET', '/api/auto-archive');
    expect(res.status).toBe(200);
    return AutoArchiveResponse.parse(await res.json()).last;
  };

  it('is null before any run moved something', async () => {
    expect(await get(await setup())).toBeNull();
  });

  it('lists only the ids still in the trash', async () => {
    const at = '2026-10-24T09:00:00.000Z';
    const s = await setup();
    await s.request('POST', '/api/sessions/trash', {
      body: { ids: [ids.sidechain, ids.noBranch, ids.outside] },
    });
    // Restored since the run: no Undo needed for it.
    await s.request('POST', `/api/sessions/${ids.noBranch}/restore`);
    await s.state.setAutoArchive({
      at,
      moved: { work: [ids.sidechain, ids.noBranch], personal: [ids.outside] },
    });
    expect(await get(s)).toEqual({ at, moved: { work: [ids.sidechain], personal: [ids.outside] } });
  });

  it('still needs the token', async () => {
    const s = await setup();
    const res = await s.request('GET', '/api/auto-archive', { headers: { [TOKEN_HEADER]: 'x' } });
    expect(res.status).toBe(403);
  });
});

describe('Jira title routes', () => {
  const answer = (data: unknown) => async () => ({ ok: true as const, data: data as never });

  it('GET returns the cache without running anything', async () => {
    const at = '2026-10-24T09:00:00.000Z';
    const s = await setup();
    await s.state.setJiraTitles({
      'ACME-608': { title: 'Preorder accordion', status: 'Done', fetchedAt: at },
      'ACME-1': { missing: true, fetchedAt: at },
    });
    const res = await s.request('GET', '/api/jira/titles');
    expect(res.status).toBe(200);
    expect(JiraTitlesResponse.parse(await res.json())).toEqual({
      titles: { 'ACME-608': { title: 'Preorder accordion', status: 'Done' } },
      lastRun: null,
    });
    expect(s.prompts).toEqual([]);
  });

  it('POST refresh looks up the work ticket keys and returns the new cache', async () => {
    const s = await setup({
      run: answer({ issues: [{ key: 'ACME-608', title: 'Preorder accordion', status: 'Done' }] }),
    });
    const res = await s.request('POST', '/api/jira/titles/refresh');
    expect(res.status).toBe(200);
    const body = JiraTitlesResponse.parse(await res.json());
    expect(body.titles).toEqual({ 'ACME-608': { title: 'Preorder accordion', status: 'Done' } });
    expect(body.lastRun).toMatchObject({ ok: true });
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]).toContain('ACME-608');
  });

  it('POST refresh reports a needed login and keeps the cache', async () => {
    const at = '2026-10-24T09:00:00.000Z';
    const s = await setup({ run: async () => ({ ok: false, reason: 'auth' }) });
    await s.state.setJiraTitles({
      'ACME-608': { title: 'Preorder accordion', status: 'Done', fetchedAt: at },
    });
    const body = JiraTitlesResponse.parse(
      await (await s.request('POST', '/api/jira/titles/refresh')).json(),
    );
    expect(body.lastRun).toMatchObject({ ok: false, reason: 'auth' });
    expect(body.titles).toEqual({ 'ACME-608': { title: 'Preorder accordion', status: 'Done' } });
  });

  it('still needs the token', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/jira/titles/refresh', {
      headers: { [TOKEN_HEADER]: 'x' },
    });
    expect(res.status).toBe(403);
    expect(s.prompts).toEqual([]);
  });
});

describe('Jira inbox routes', () => {
  const item = {
    key: 'ACME-642',
    title: 'PDP gift card',
    status: '[AM] TO DO',
    assignee: 'Anna Yang',
    bucket: 'action',
    kind: 'mention',
    reason: 'Two replies after your last comment',
    lastRelevantAt: '2026-10-23T09:40:00+08:00',
  } as const;

  it('GET returns nothing before the first sync, without running anything', async () => {
    const s = await setup();
    const res = await s.request('GET', '/api/jira/inbox');
    expect(res.status).toBe(200);
    expect(JiraInboxResponse.parse(await res.json())).toEqual({
      result: null,
      lastAttempt: null,
      jiraBaseUrl: null,
    });
    expect(s.prompts).toEqual([]);
  });

  it('GET and POST sync carry the Jira base URL from config', async () => {
    const s = await setup({ jiraBaseUrl: 'https://example.atlassian.net' });
    for (const [method, path] of [
      ['GET', '/api/jira/inbox'],
      ['POST', '/api/jira/inbox/sync'],
    ] as const) {
      const body = JiraInboxResponse.parse(await (await s.request(method, path)).json());
      expect(body.jiraBaseUrl).toBe('https://example.atlassian.net');
    }
  });

  it('POST sync runs the inbox job and returns the stored result', async () => {
    const s = await setup({
      run: async (req) => ({
        ok: true,
        data: req.schema.parse({ syncedAt: '2026-10-23T10:12:00+08:00', items: [item] }),
      }),
    });
    const body = JiraInboxResponse.parse(
      await (await s.request('POST', '/api/jira/inbox/sync')).json(),
    );
    expect(body.result?.items).toEqual([item]);
    // The shipped prompt's version, so tuning the prompt does not break this test.
    const { version } = parsePromptFile(readFileSync(PROMPT_PATH, 'utf8'));
    expect(body.lastAttempt).toMatchObject({ ok: true, promptVersion: version });
    expect(
      JiraInboxResponse.parse(await (await s.request('GET', '/api/jira/inbox')).json()),
    ).toEqual(body);
  });

  it('POST sync keeps the last good result after an invalid run and says why', async () => {
    const result = { syncedAt: '2026-10-23T02:12:00.000Z', items: [item] };
    const s = await setup({
      state: { version: 1, sessions: {}, sync: { jira: { result } } },
      run: async () => ({ ok: false, reason: 'invalid', detail: 'answer does not match' }),
    });
    const body = JiraInboxResponse.parse(
      await (await s.request('POST', '/api/jira/inbox/sync')).json(),
    );
    expect(body.result).toEqual(result);
    expect(body.lastAttempt).toMatchObject({
      ok: false,
      reason: 'invalid',
      detail: 'answer does not match',
    });
  });

  it('still needs the token', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/jira/inbox/sync', {
      headers: { [TOKEN_HEADER]: 'x' },
    });
    expect(res.status).toBe(403);
    expect(s.prompts).toEqual([]);
  });
});

describe('PATCH /api/sessions/:id', () => {
  it('updates status and bookmark, persists them and shows them in the list', async () => {
    const s = await setup();
    const res = await s.request('PATCH', `/api/sessions/${ids.ticket}`, {
      body: { status: 'done', bookmarked: true },
    });
    expect(res.status).toBe(200);
    const body = ApiSession.parse(await res.json());
    expect(body.state).toEqual({ status: 'done', bookmarked: true });

    const row = (await list(s, 'work')).find((x) => x.id === ids.ticket)!;
    expect(row.state).toEqual({ status: 'done', bookmarked: true });
    const onDisk = JSON.parse(readFileSync(s.statePath, 'utf8'));
    expect(onDisk.sessions[ids.ticket]).toEqual({ status: 'done', bookmarked: true });
  });

  it('applies a category override, keeps autoCategory, and clears it with null', async () => {
    const s = await setup();
    const before = (await list(s, 'work')).find((x) => x.id === ids.ticket)!;
    expect(before.autoCategory).toBe('ticket');

    let res = await s.request('PATCH', `/api/sessions/${ids.ticket}`, {
      body: { categoryOverride: 'ops' },
    });
    let body = ApiSession.parse(await res.json());
    expect(body).toMatchObject({ category: 'ops', autoCategory: 'ticket' });
    expect(body.state.categoryOverride).toBe('ops');

    res = await s.request('PATCH', `/api/sessions/${ids.ticket}`, {
      body: { categoryOverride: null },
    });
    body = ApiSession.parse(await res.json());
    expect(body).toMatchObject({ category: 'ticket', autoCategory: 'ticket' });
    expect(body.state).toEqual({ status: 'todo', bookmarked: false });
  });

  it('moves a session to a ticket with ticketOverride, keeps autoTicketKey, and clears it with null', async () => {
    const s = await setup();
    const before = (await list(s, 'work')).find((x) => x.id === ids.ticket)!;
    const branchKey = before.ticketKey;

    let res = await s.request('PATCH', `/api/sessions/${ids.ticket}`, {
      body: { ticketOverride: 'ACME-555' },
    });
    let body = ApiSession.parse(await res.json());
    expect(body).toMatchObject({
      ticketKey: 'ACME-555',
      autoTicketKey: branchKey,
      category: 'ticket',
    });
    expect(body.state.ticketOverride).toBe('ACME-555');

    res = await s.request('PATCH', `/api/sessions/${ids.ticket}`, {
      body: { ticketOverride: null },
    });
    body = ApiSession.parse(await res.json());
    expect(body.ticketKey).toBe(branchKey);
    expect(body.state).toEqual({ status: 'todo', bookmarked: false });
  });

  it.each([
    ['a non-UUID id', 'not-a-uuid', { status: 'done' }, 'session id must be a UUID'],
    ['an unknown field', ids.ticket, { status: 'done', trashed: {} }, 'invalid patch'],
    ['a bad status', ids.ticket, { status: 'later' }, 'invalid patch'],
    ['a bad category', ids.ticket, { categoryOverride: 'misc' }, 'invalid patch'],
    ['a bad ticket key', ids.ticket, { ticketOverride: 'acme 555' }, 'invalid patch'],
    ['an empty patch', ids.ticket, {}, 'invalid patch'],
    ['a non-object body', ids.ticket, [], 'invalid patch'],
    ['broken JSON', ids.ticket, '{"status":', 'body must be JSON'],
  ])('400 for %s', async (_label, id, body, error) => {
    const s = await setup();
    const res = await s.request('PATCH', `/api/sessions/${id}`, { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });

  describe('title (ADR 0056)', () => {
    const ticketFile = (s: Setup) =>
      join(s.root, '-Users-annayang-y-acme-shop', `${ids.ticket}.jsonl`);
    const append = (s: Setup, line: object) =>
      writeFileSync(ticketFile(s), JSON.stringify(line) + '\n', { flag: 'a' });
    const rename = async (s: Setup, title: unknown, id = ids.ticket) => {
      const res = await s.request('PATCH', `/api/sessions/${id}`, { body: { title } });
      expect(res.status).toBe(200);
      return ApiSession.parse(await res.json());
    };
    const row = async (s: Setup, workspace = 'work', id = ids.ticket) =>
      (await list(s, workspace)).find((x) => x.id === id)!;

    it('shows the automatic title in both fields until a rename', async () => {
      const s = await setup();
      // Fixture precedence: custom title, then ai-title (the ticket session has no custom one).
      expect(await row(s, 'personal', ids.custom)).toMatchObject({
        title: 'lorem ipsum dolor s',
        autoTitle: 'lorem ipsum dolor s',
        customTitle: 'lorem ipsum dolor s',
      });
      expect(await row(s)).toMatchObject({
        title: 'lorem ipsum dolor si',
        autoTitle: 'lorem ipsum dolor si',
        customTitle: null,
      });
    });

    it('a trimmed rename wins and snapshots the custom title; a later /rename wins back', async () => {
      const s = await setup();
      const body = await rename(s, '  Preorder accordion  ');
      expect(body).toMatchObject({
        title: 'Preorder accordion',
        autoTitle: 'lorem ipsum dolor si',
      });
      expect(body.state).toEqual({
        status: 'todo',
        bookmarked: false,
        title: 'Preorder accordion',
      });
      const onDisk = () => JSON.parse(readFileSync(s.statePath, 'utf8')).sessions[ids.ticket];
      expect(onDisk()).toMatchObject({ title: 'Preorder accordion', titleSnapshot: null });
      expect((await row(s)).title).toBe('Preorder accordion');

      append(s, { type: 'custom-title', customTitle: 'from claude', sessionId: ids.ticket });
      append(s, { type: 'agent-name', agentName: 'from claude', sessionId: ids.ticket });
      const after = await row(s);
      expect(after).toMatchObject({ title: 'from claude', autoTitle: 'from claude' });
      expect(after.state).toEqual({ status: 'todo', bookmarked: false });
      expect(onDisk()).toEqual({ status: 'todo', bookmarked: false });
    });

    it('a rename over an existing custom title survives rescans until the custom title changes', async () => {
      const s = await setup();
      await rename(s, 'mine', ids.custom);
      // Each list rescans, so this is a second rescan with the same custom title.
      await list(s, 'personal');
      expect((await row(s, 'personal', ids.custom)).title).toBe('mine');
      expect(s.state.get(ids.custom).titleSnapshot).toBe('lorem ipsum dolor s');
    });

    it('a new ai-title after a rename keeps the dashboard title', async () => {
      const s = await setup();
      await rename(s, 'mine');
      append(s, { type: 'ai-title', aiTitle: 'a newer ai title', sessionId: ids.ticket });
      expect(await row(s)).toMatchObject({ title: 'mine', autoTitle: 'a newer ai title' });
    });

    it.each([
      ['null', null],
      ['an empty string', ''],
      ['whitespace only', '   '],
    ])('clearing with %s restores the automatic title', async (_label, value) => {
      const s = await setup();
      await rename(s, 'mine');
      const body = await rename(s, value);
      expect(body).toMatchObject({
        title: 'lorem ipsum dolor si',
        autoTitle: 'lorem ipsum dolor si',
      });
      expect(body.state).toEqual({ status: 'todo', bookmarked: false });
      expect(JSON.parse(readFileSync(s.statePath, 'utf8')).sessions[ids.ticket]).toEqual({
        status: 'todo',
        bookmarked: false,
      });
    });

    it('accepts 120 characters after trimming', async () => {
      const s = await setup();
      expect((await rename(s, ` ${'é'.repeat(120)} `)).title).toBe('é'.repeat(120));
    });

    it.each([
      ['121 characters', ids.ticket, { title: 'x'.repeat(121) }, 'invalid patch'],
      ['a non-string title', ids.ticket, { title: 42 }, 'invalid patch'],
      ['a titleSnapshot from the client', ids.ticket, { titleSnapshot: 'x' }, 'invalid patch'],
      ['a non-UUID id', 'not-a-uuid', { title: 'mine' }, 'session id must be a UUID'],
    ])('400 for %s', async (_label, id, body, error) => {
      const s = await setup();
      const res = await s.request('PATCH', `/api/sessions/${id}`, { body });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(() => readFileSync(s.statePath)).toThrow();
    });
  });

  it('404 for a UUID with no live session, and writes nothing', async () => {
    const s = await setup();
    const res = await s.request('PATCH', `/api/sessions/${orphanId}`, { body: { status: 'done' } });
    expect(res.status).toBe(404);
    expect(() => readFileSync(s.statePath)).toThrow();
  });

  it('403 without an Origin (CSRF check still applies)', async () => {
    const s = await setup();
    const res = await s.request('PATCH', `/api/sessions/${ids.ticket}`, {
      body: { status: 'done' },
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/sessions/:id/resume', () => {
  it('opens claude --resume in the first cwd', async () => {
    const s = await setup();
    const res = await s.request('POST', `/api/sessions/${ids.ticket}/resume`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = (await list(s, 'work')).find((x) => x.id === ids.ticket)!;
    expect(s.launches).toEqual([[row.cwd, ['claude', '--resume', ids.ticket]]]);
  });

  it('410 when the transcript is gone, without launching', async () => {
    const s = await setup();
    rmSync(join(s.root, '-Users-annayang-y-acme-shop', `${ids.ticket}.jsonl`));
    const res = await s.request('POST', `/api/sessions/${ids.ticket}/resume`);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'session file is gone' });
    expect(s.launches).toEqual([]);
  });

  it('410 for a UUID that was never a session', async () => {
    const s = await setup();
    expect((await s.request('POST', `/api/sessions/${orphanId}/resume`)).status).toBe(410);
  });

  it('400 for a non-UUID id', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/sessions/..%2F..%2Fetc/resume');
    expect(res.status).toBe(400);
    expect(s.launches).toEqual([]);
  });

  it('500 when the terminal cannot be opened', async () => {
    const s = await setup({ launchFails: true });
    const res = await s.request('POST', `/api/sessions/${ids.ticket}/resume`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'could not open the terminal' });
  });

  it('403 without an allowed Origin', async () => {
    const s = await setup();
    const res = await s.request('POST', `/api/sessions/${ids.ticket}/resume`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(s.launches).toEqual([]);
  });
});

describe('POST /api/tickets/:key/new-session', () => {
  const stored = (path: string) => JSON.parse(readFileSync(path, 'utf8')).sessions;

  it("pre-assigns an id, starts claude in the ticket's repo, and records it as pending", async () => {
    const s = await setup();
    const ticket = (await list(s, 'work')).find((x) => x.id === ids.ticket)!;
    expect(ticket.ticketKey).not.toBeNull();
    const res = await s.request('POST', `/api/tickets/${ticket.ticketKey}/new-session`);
    expect(res.status).toBe(200);
    const { sessionId } = NewSessionResponse.parse(await res.json());

    expect(s.launches).toEqual([
      [
        ticket.repo,
        ['claude', '--session-id', sessionId, `Let's work on Jira ticket ${ticket.ticketKey}.`],
      ],
    ]);
    expect(stored(s.statePath)[sessionId]).toMatchObject({
      ticketOverride: ticket.ticketKey,
      pendingSince: expect.any(String),
    });
  });

  it('starts in ~/y when the ticket has no session yet', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session');
    expect(res.status).toBe(200);
    expect(s.launches[0]![0]).toBe(`${HOME}/y`);
  });

  it('survives pruning until the transcript appears, then lands in the ticket group', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session');
    const { sessionId } = NewSessionResponse.parse(await res.json());
    await list(s, 'work'); // rescan + prune
    expect(stored(s.statePath)[sessionId]).toBeDefined();

    // The transcript claude writes: a branch with no ticket key in it.
    const dir = join(s.root, '-Users-annayang-y-acme-shop');
    writeFileSync(
      join(dir, `${sessionId}.jsonl`),
      transcript(`${HOME}/y/acme-shop`, "Let's work on Jira ticket NEW-1."),
    );
    const row = (await list(s, 'work')).find((x) => x.id === sessionId)!;
    expect(row).toMatchObject({ ticketKey: 'NEW-1', category: 'ticket', autoCategory: 'ticket' });
    expect(row.state).toEqual({ status: 'todo', bookmarked: false, ticketOverride: 'NEW-1' });
    expect(stored(s.statePath)[sessionId]).toEqual({
      status: 'todo',
      bookmarked: false,
      ticketOverride: 'NEW-1',
    });
  });

  it('500 and no state entry when the terminal cannot be opened', async () => {
    const s = await setup({ launchFails: true });
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session');
    expect(res.status).toBe(500);
    expect(stored(s.statePath)).toEqual({});
  });

  it('passes a trimmed name to claude --name', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session', {
      body: { name: `  NEW-1 it's $(a) "test" 🚀  ` },
    });
    expect(res.status).toBe(200);
    const { sessionId } = NewSessionResponse.parse(await res.json());
    expect(s.launches[0]![1]).toEqual([
      'claude',
      '--session-id',
      sessionId,
      '--name',
      `NEW-1 it's $(a) "test" 🚀`,
      "Let's work on Jira ticket NEW-1.",
    ]);
  });

  it.each([[{}], [undefined]])('starts without a name for body %j', async (body) => {
    const s = await setup();
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session', { body });
    expect(res.status).toBe(200);
    expect(s.launches[0]![1]).not.toContain('--name');
  });

  it.each([
    ['empty', { name: '' }],
    ['whitespace only', { name: '   ' }],
    ['121 characters', { name: 'x'.repeat(121) }],
    ['a newline', { name: 'NEW-1\nrm -rf ~' }],
    ['a trailing newline', { name: 'NEW-1\n' }],
    ['a carriage return', { name: 'NEW-1\r' }],
    ['a tab', { name: 'a\tb' }],
    ['an escape', { name: 'a\u001b[2Jb' }],
    ['not a string', { name: 42 }],
    ['an unknown field', { name: 'ok', prompt: 'x' }],
  ])('400 and no launch or state for a name with %s', async (_, body) => {
    const s = await setup();
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session', { body });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid session name' });
    expect(s.launches).toEqual([]);
    expect(existsSync(s.statePath)).toBe(false);
  });

  it('accepts 120 characters', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/tickets/NEW-1/new-session', {
      body: { name: 'x'.repeat(120) },
    });
    expect(res.status).toBe(200);
  });

  it.each([['fa-554'], ['FA554'], ['FA-'], ['A B-1'], ['FA-1;rm']])(
    '400 for key "%s"',
    async (key) => {
      const s = await setup();
      const res = await s.request('POST', `/api/tickets/${encodeURIComponent(key)}/new-session`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'ticket key must look like ABC-123' });
      expect(s.launches).toEqual([]);
    },
  );
});

describe('orphan pruning', () => {
  const state = {
    version: 1,
    sessions: {
      [ids.ticket]: { status: 'done', bookmarked: false },
      [orphanId]: { status: 'done', bookmarked: true },
      [trashedId]: {
        status: 'todo',
        bookmarked: true,
        trashed: {
          originalPath: '/x.jsonl',
          hadFolder: false,
          trashedAt: '2026-10-24T00:00:00.000Z',
        },
      },
    },
    sync: {},
  };
  const storedIds = (path: string) =>
    Object.keys(JSON.parse(readFileSync(path, 'utf8')).sessions).sort();

  it('drops orphans on startup and keeps trashed entries', async () => {
    const s = await setup({ state });
    expect(storedIds(s.statePath)).toEqual([ids.ticket, trashedId].sort());
  });

  it('drops a session that disappears on the next rescan', async () => {
    const s = await setup();
    await s.request('PATCH', `/api/sessions/${ids.custom}`, { body: { bookmarked: true } });
    rmSync(join(s.root, '-private-tmp-cc-spike', `${ids.custom}.jsonl`));
    expect((await list(s, 'personal')).map((x) => x.id)).toEqual([ids.outside]);
    expect(storedIds(s.statePath)).toEqual([]);
  });

  it('keeps all state when the projects root cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-test-missing-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const s = await setup({ state, root: join(dir, 'does-not-exist') });
    expect(storedIds(s.statePath)).toEqual([ids.ticket, orphanId, trashedId].sort());
  });
});

describe('trash routes', () => {
  const TOYS = '-Users-annayang-y-acme-shop';

  it('trash hides the session and keeps its state; restore brings both back', async () => {
    const s = await setup();
    await s.request('PATCH', `/api/sessions/${ids.sidechain}`, { body: { bookmarked: true } });
    const res = await s.request('POST', `/api/sessions/${ids.sidechain}/trash`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(existsSync(join(s.trashDir, ids.sidechain, 'subagents'))).toBe(true);
    expect((await list(s, 'work')).map((x) => x.id)).not.toContain(ids.sidechain);

    expect((await s.request('POST', `/api/sessions/${ids.sidechain}/restore`)).status).toBe(200);
    expect(existsSync(join(s.root, TOYS, ids.sidechain, 'subagents'))).toBe(true);
    const back = (await list(s, 'work')).find((x) => x.id === ids.sidechain);
    expect(back?.state).toEqual({
      status: 'todo',
      bookmarked: true,
      restoredAt: expect.any(String),
    });
  });

  it('maps outcomes to 404, 409 and 400', async () => {
    const s = await setup();
    expect((await s.request('POST', `/api/sessions/${orphanId}/trash`)).status).toBe(404);
    expect((await s.request('POST', `/api/sessions/${ids.ticket}/restore`)).status).toBe(404);
    await s.request('POST', `/api/sessions/${ids.ticket}/trash`);
    writeFileSync(join(s.root, TOYS, `${ids.ticket}.jsonl`), transcript(`${HOME}/y`, 'again'));
    const conflict = await s.request('POST', `/api/sessions/${ids.ticket}/restore`);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'a file is already in the way' });
    expect((await s.request('POST', '/api/sessions/..%2Fx/trash')).status).toBe(400);
  });

  it('bulk runs every id and reports each result', async () => {
    const s = await setup();
    const res = await s.request('POST', '/api/sessions/trash', {
      body: { ids: [ids.ticket, orphanId, ids.multiBranch] },
    });
    expect(res.status).toBe(200);
    expect(BulkTrashResponse.parse(await res.json()).results).toEqual([
      { id: ids.ticket, ok: true },
      { id: orphanId, ok: false, error: 'not-found' },
      { id: ids.multiBranch, ok: true },
    ]);
    const restored = await s.request('POST', '/api/sessions/restore', {
      body: { ids: [ids.ticket, ids.multiBranch] },
    });
    expect((await restored.json()).results.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });

  it.each([
    ['no ids', { ids: [] }],
    ['201 ids', { ids: Array.from({ length: 201 }, () => crypto.randomUUID()) }],
    ['a bad id', { ids: ['nope'] }],
    ['unknown keys', { ids: [orphanId], all: true }],
  ])('bulk: 400 for %s', async (_, body) => {
    const s = await setup();
    expect((await s.request('POST', '/api/sessions/trash', { body })).status).toBe(400);
  });

  it('purge deletes only entries trashed over 7 days ago', async () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const s = await setup({
      state: {
        version: 1,
        sessions: {
          [trashedId]: {
            status: 'todo',
            bookmarked: false,
            trashed: { originalPath: '/x.jsonl', hadFolder: false, trashedAt: old },
          },
        },
        sync: {},
      },
    });
    mkdirSync(s.trashDir, { recursive: true });
    writeFileSync(join(s.trashDir, `${trashedId}.jsonl`), 'x');
    await s.request('POST', `/api/sessions/${ids.ticket}/trash`);

    const res = await s.request('POST', '/api/trash/purge');
    expect(await res.json()).toEqual({ purged: [trashedId] });
    expect(readdirSync(s.trashDir).sort()).toEqual([`${ids.ticket}.jsonl`, ids.ticket].sort());
  });

  it('403 without an allowed Origin, and nothing moves', async () => {
    const s = await setup();
    const res = await s.request('POST', `/api/sessions/${ids.ticket}/trash`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(existsSync(join(s.root, TOYS, `${ids.ticket}.jsonl`))).toBe(true);
  });
});

describe('GET /api/events', () => {
  it(`sends ${SESSIONS_CHANGED} within 2 s of a new transcript, and lists it`, async () => {
    const s = await setup({ watch: true });
    const events = await openEvents(s);
    const id = crypto.randomUUID();
    const folder = join(s.root, '-Users-annayang-o-new-repo');
    mkdirSync(folder);
    writeFileSync(join(folder, `${id}.jsonl`), transcript(`${HOME}/o/new-repo`, 'hello'));

    const ms = await waitFor(() => events.names.includes(SESSIONS_CHANGED), 2000);
    expect(ms).toBeLessThan(2000);
    expect((await list(s, 'personal')).map((x) => x.id)).toContain(id);
  });

  it('collapses a burst of writes into one event', async () => {
    const s = await setup({ watch: true });
    const events = await openEvents(s);
    const file = join(s.root, '-private-tmp-cc-spike', `${ids.custom}.jsonl`);
    for (let i = 0; i < 5; i++)
      writeFileSync(file, transcript('/private/tmp/cc-spike', `p${i}`), { flag: 'a' });
    await waitFor(() => events.names.includes(SESSIONS_CHANGED), 2000);
    await new Promise((r) => setTimeout(r, 800));
    expect(events.names.filter((n) => n === SESSIONS_CHANGED)).toHaveLength(1);
  });

  it('ignores the runner folder and sub-agent transcripts', async () => {
    const s = await setup({ watch: true });
    const events = await openEvents(s);
    const runner = runnerProjectFolder(s.root, HOME);
    mkdirSync(runner);
    writeFileSync(
      join(runner, `${crypto.randomUUID()}.jsonl`),
      transcript(`${HOME}/.claude-dashboard/runner`, 'sync'),
    );
    const sub = join(s.root, '-Users-annayang-y-acme-shop', ids.sidechain, 'subagents');
    writeFileSync(join(sub, 'agent-new.jsonl'), transcript(`${HOME}/y/acme-shop`, 'sub'));
    await new Promise((r) => setTimeout(r, 1200));
    expect(events.names).toEqual([]);
  });

  it('sends keep-alive comments and stops writing once the client goes away', async () => {
    const s = await setup();
    const res = await s.request('GET', '/api/events');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain(': keep-alive');
    await reader.cancel();
  });
});
