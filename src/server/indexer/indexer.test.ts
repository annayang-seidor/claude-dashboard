import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../shared/session';
import { DEFAULT_WORKSPACES } from '../../shared/config';
import { resolveWorkspaces } from '../config';
import { findGitRoot, repoOf, ticketKeyOf, titleOf, workspaceOf } from './derive';
import { createIndexer, type IndexerOptions } from './index';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/projects', import.meta.url));
// Fixture cwds were recorded under this home folder.
const HOME = '/Users/annayang';
const TOYS = `${HOME}/y/acme-shop`;

// Never touch the real disk for git lookups: these are the repos that "exist".
const fakeRepos = [TOYS, `${TOYS}/shop`, `${HOME}/o/claude-dashboard`];
const findRepoRoot: IndexerOptions['findRepoRoot'] = (cwd) =>
  fakeRepos
    .filter((r) => cwd === r || cwd.startsWith(r + '/'))
    .sort((a, b) => b.length - a.length)[0] ?? null;

const ids = {
  custom: 'd4a1e24c-0df7-402e-bc9a-e61cf8aa9430',
  outside: '0328999a-b8be-4c87-bbd8-3ed22bf1a42d',
  noBranch: '506e8f56-0f29-42df-bb2d-509897b85cf3',
  sidechain: '55e4d22f-af40-4a4d-a574-195e5c9a227a',
  ticket: 'da917231-5cde-47ba-b5ab-6904b3ceb8c4',
  multiBranch: 'dd025063-4c86-4d33-a339-1e858b458e39',
};

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'indexer-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
const user = (content: unknown, extra: object = {}) => ({
  type: 'user',
  uuid: crypto.randomUUID(),
  timestamp: '2026-10-20T08:00:00.000Z',
  cwd: `${HOME}/o/claude-dashboard`,
  gitBranch: 'main',
  message: { role: 'user', content },
  ...extra,
});

describe('indexer over fixtures/projects', () => {
  let sessions: Session[];
  const byId = (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error(`missing ${id}`);
    return s;
  };

  beforeAll(async () => {
    sessions = await createIndexer({ projectsRoot: FIXTURES, home: HOME, findRepoRoot }).index();
  });

  it('lists one row per top-level transcript and never sub-agent files', () => {
    expect(sessions.map((s) => s.id).sort()).toEqual(Object.values(ids).sort());
  });

  it('sorts by last activity, newest first', () => {
    const times = sessions.map((s) => s.lastActivityAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('ticket branch → ticket key and category', () => {
    expect(byId(ids.ticket)).toMatchObject({
      cwd: `${TOYS}/shop`,
      workspace: 'work',
      repo: `${TOYS}/shop`,
      branch: 'bugfix/ACME-608_dynamic-preorder-accordion',
      branchesSeen: ['bugfix/ACME-608_dynamic-preorder-accordion'],
      ticketKey: 'ACME-608',
      category: 'ticket',
      title: 'lorem ipsum dolor si',
      createdAt: '2026-10-07T10:07:47.326Z',
      lastActivityAt: '2026-10-07T10:09:07.341Z',
    });
  });

  it('multi-branch → last branch wins, both seen', () => {
    expect(byId(ids.multiBranch)).toMatchObject({
      branch: 'bugfix/ACME-623-621_pdp-fixes',
      branchesSeen: ['develop', 'bugfix/ACME-623-621_pdp-fixes'],
      ticketKey: 'ACME-623',
      category: 'ticket',
      title: 'lorem ipsum dolor sit amet',
      lastActivityAt: '2026-10-20T09:51:48.429Z',
    });
  });

  it('"HEAD" means no branch; AI title beats the legacy summary', () => {
    expect(byId(ids.noBranch)).toMatchObject({
      workspace: 'work',
      repo: TOYS,
      branch: null,
      branchesSeen: [],
      ticketKey: null,
      category: 'scratch',
      title: 'lorem ipsum dolor sit ame',
    });
  });

  it('uses the first cwd even when it changes mid-session', () => {
    expect(byId(ids.sidechain)).toMatchObject({ cwd: TOYS, repo: TOYS });
  });

  it('last activity ignores later system lines and untimestamped tail lines', () => {
    // File ends with system lines at 10:38 and then last-prompt / cost-state.
    expect(byId(ids.sidechain).lastActivityAt).toBe('2026-10-16T10:35:12.692Z');
    // File ends with timestamped queue-operation lines, which are not messages.
    expect(byId(ids.outside).lastActivityAt).toBe('2026-10-03T07:43:34.033Z');
  });

  it('custom title wins; folders outside ~/y and ~/o are personal with no repo', () => {
    expect(byId(ids.custom)).toMatchObject({
      cwd: '/private/tmp/cc-spike',
      workspace: 'personal',
      repo: null,
      branch: null,
      title: 'lorem ipsum dolor s',
    });
    expect(byId(ids.outside)).toMatchObject({
      cwd: `${HOME}/Downloads/community-mcp`,
      workspace: 'personal',
      repo: null,
      branch: 'dev',
      category: 'scratch',
    });
  });

  it('records the absolute file path', () => {
    expect(byId(ids.ticket).filePath).toBe(
      join(FIXTURES, '-Users-annayang-y-acme-shop', `${ids.ticket}.jsonl`),
    );
  });
});

describe('title fallbacks', () => {
  it('falls back to the summary for this file when ai-title lines are dropped', async () => {
    const root = tmp();
    const dir = join(root, '-Users-annayang-y-acme-shop');
    mkdirSync(dir);
    const src = join(FIXTURES, '-Users-annayang-y-acme-shop', `${ids.noBranch}.jsonl`);
    const kept = readFileSync(src, 'utf8')
      .split('\n')
      .filter((l) => !l.includes('"type":"ai-title"'));
    writeFileSync(join(dir, `${ids.noBranch}.jsonl`), kept.join('\n'));
    const [s] = await createIndexer({ projectsRoot: root, home: HOME, findRepoRoot }).index();
    expect(s?.title).toBe('lorem ipsum dolor sit amet');
  });

  it('ignores a summary whose leaf is in another session, then uses the prompt cut to 80', async () => {
    const root = tmp();
    mkdirSync(join(root, 'p'));
    const prompt = `  fix   the\nlogin ${'x'.repeat(100)}`;
    writeFileSync(
      join(root, 'p', `${ids.custom}.jsonl`),
      jsonl([
        { type: 'summary', summary: 'other session', leafUuid: crypto.randomUUID() },
        user(prompt),
      ]),
    );
    const [s] = await createIndexer({ projectsRoot: root, home: HOME, findRepoRoot }).index();
    expect(s?.title).toBe(`fix the login ${'x'.repeat(66)}`);
    expect(s?.title).toHaveLength(80);
  });

  it('titleOf precedence', () => {
    const none = { customTitle: null, aiTitle: null, summary: null, firstPrompt: null };
    expect(
      titleOf({ ...none, customTitle: 'c', aiTitle: 'a', summary: 's', firstPrompt: 'p' }),
    ).toBe('c');
    expect(titleOf({ ...none, aiTitle: 'a', summary: 's', firstPrompt: 'p' })).toBe('a');
    expect(titleOf({ ...none, summary: 's', firstPrompt: 'p' })).toBe('s');
    expect(titleOf({ ...none, firstPrompt: 'p' })).toBe('p');
  });
});

describe('skipping and tolerance', () => {
  it('skips metadata-only stubs, tool-result-only and meta-only files, runner sessions and non-UUID names', async () => {
    const root = tmp();
    const dir = join(root, 'p');
    mkdirSync(dir);
    const write = (name: string, lines: unknown[]) => writeFileSync(join(dir, name), jsonl(lines));
    // Shape of the real ec78c11b stub from the spike.
    write('ec78c11b-0000-4000-8000-000000000001.jsonl', [
      { type: 'ai-title', aiTitle: 'x', sessionId: 'ec78c11b-0000-4000-8000-000000000001' },
      { type: 'mode', mode: 'default' },
      { type: 'permission-mode', permissionMode: 'default' },
      { type: 'atis-latch' },
      { type: 'cost-state' },
    ]);
    write('ec78c11b-0000-4000-8000-000000000002.jsonl', [
      user([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }]),
      user('caveat', { isMeta: true }),
    ]);
    write('ec78c11b-0000-4000-8000-000000000003.jsonl', [
      user('sync jira', { cwd: `${HOME}/.claude-dashboard/runner` }),
    ]);
    write('not-a-uuid.jsonl', [user('hello')]);
    write('ec78c11b-0000-4000-8000-000000000004.jsonl', [
      { type: 'some-future-type', weird: [1, 2] },
      'not an object',
      user([{ type: 'text', text: 'real prompt' }]),
    ]);
    // Truncated last line (mid-write) is tolerated.
    writeFileSync(join(dir, 'ec78c11b-0000-4000-8000-000000000004.jsonl'), '{"type":"assist', {
      flag: 'a',
    });

    const sessions = await createIndexer({ projectsRoot: root, home: HOME, findRepoRoot }).index();
    expect(sessions.map((s) => [s.id, s.title])).toEqual([
      ['ec78c11b-0000-4000-8000-000000000004', 'real prompt'],
    ]);
  });

  it('returns [] when the projects root does not exist', async () => {
    const sessions = await createIndexer({ projectsRoot: join(tmp(), 'nope'), home: HOME }).index();
    expect(sessions).toEqual([]);
  });

  it('falls back to mtime when no message has a timestamp', async () => {
    const root = tmp();
    mkdirSync(join(root, 'p'));
    const file = join(root, 'p', `${ids.custom}.jsonl`);
    writeFileSync(file, jsonl([user('hi', { timestamp: undefined })]));
    const mtime = new Date('2026-10-01T00:00:00.000Z');
    utimesSync(file, mtime, mtime);
    const [s] = await createIndexer({ projectsRoot: root, home: HOME, findRepoRoot }).index();
    expect(s?.lastActivityAt).toBe(mtime.toISOString());
    expect(s?.createdAt).toBe(mtime.toISOString());
  });
});

describe('tail read', () => {
  it('reads back past many KB of untimestamped lines and keeps the last titles and branch', async () => {
    const root = tmp();
    mkdirSync(join(root, 'p'));
    const lines: object[] = [user('first prompt', { gitBranch: 'feature/ABC-1-x' })];
    // A middle large enough that head and tail never meet.
    for (let i = 0; i < 400; i++) lines.push({ type: 'api-request-blob', blob: 'z'.repeat(1000) });
    lines.push(
      { type: 'ai-title', aiTitle: 'late ai title' },
      user('later', { timestamp: '2026-10-21T12:00:00.000Z', gitBranch: 'feature/ABC-2-y' }),
      {
        type: 'assistant',
        uuid: crypto.randomUUID(),
        timestamp: '2026-10-21T12:00:05.000Z',
        gitBranch: 'HEAD',
      },
    );
    // ~200 KB of untimestamped trailing lines, more than several tail chunks.
    for (let i = 0; i < 200; i++)
      lines.push({ type: 'file-history-snapshot', snap: 'q'.repeat(1000) });
    lines.push({ type: 'cost-state' });
    writeFileSync(join(root, 'p', `${ids.custom}.jsonl`), jsonl(lines));

    const [s] = await createIndexer({ projectsRoot: root, home: HOME, findRepoRoot }).index();
    expect(s).toMatchObject({
      title: 'late ai title',
      branch: 'feature/ABC-2-y',
      branchesSeen: ['feature/ABC-1-x', 'feature/ABC-2-y'],
      ticketKey: 'ABC-2',
      createdAt: '2026-10-20T08:00:00.000Z',
      lastActivityAt: '2026-10-21T12:00:05.000Z',
    });
  });
});

describe('custom titles anywhere in the file (ADR 0055)', () => {
  const blob = (chars: number) => ({ type: 'api-request-blob', blob: 'z'.repeat(chars) });
  /** Bytes of a blob line, newline included, per character of payload. */
  const BLOB_OVERHEAD = JSON.stringify(blob(0)).length + 1;
  const tailLines = [
    { type: 'ai-title', aiTitle: 'late ai title' },
    user('later', { timestamp: '2026-10-21T12:00:00.000Z' }),
    { type: 'cost-state' },
  ];

  async function indexText(text: string): Promise<Session> {
    const root = tmp();
    mkdirSync(join(root, 'p'));
    writeFileSync(join(root, 'p', `${ids.custom}.jsonl`), text);
    const [s] = await createIndexer({ projectsRoot: root, home: HOME, findRepoRoot }).index();
    if (!s) throw new Error('not indexed');
    return s;
  }

  it('finds a /rename in the middle of a large file, and it beats a later ai-title', async () => {
    const lines: object[] = [user('first prompt')];
    for (let i = 0; i < 2000; i++) lines.push(blob(1000));
    lines.push({ type: 'custom-title', customTitle: 'renamed mid-session' });
    lines.push({ type: 'agent-name', agentName: 'renamed mid-session' });
    for (let i = 0; i < 2000; i++) lines.push(blob(1000));
    const s = await indexText(jsonl([...lines, ...tailLines]));
    expect(s).toMatchObject({ title: 'renamed mid-session', customTitle: 'renamed mid-session' });
  });

  it('keeps the last custom title in file order: head, then middle, then tail', async () => {
    const middle = (title: string) => [
      ...Array.from({ length: 300 }, () => blob(1000)),
      { type: 'custom-title', customTitle: title },
      ...Array.from({ length: 300 }, () => blob(1000)),
    ];
    const head = { type: 'custom-title', customTitle: 'head' };
    expect(
      (await indexText(jsonl([head, user('p'), ...middle('m1'), ...middle('m2'), ...tailLines])))
        .customTitle,
    ).toBe('m2');
    const tail = { type: 'custom-title', customTitle: 'tail' };
    expect(
      (await indexText(jsonl([head, user('p'), ...middle('m1'), tail, ...tailLines]))).customTitle,
    ).toBe('tail');
  });

  it('reads a custom-title line that straddles the 1 MB read boundary', async () => {
    let text = jsonl([user('first prompt')]);
    while (text.length < 70 * 1024) text += jsonl([blob(1000)]);
    // The head read stops at the last complete line of its first 64 KB chunk.
    const headEnd = text.lastIndexOf('\n', 64 * 1024 - 1) + 1;
    const target = headEnd + 1024 * 1024 - 20;
    while (target - text.length > 2000 + BLOB_OVERHEAD) text += jsonl([blob(1000)]);
    text += jsonl([blob(target - text.length - BLOB_OVERHEAD)]);
    expect(text.length).toBe(target);
    text += jsonl([{ type: 'custom-title', customTitle: 'across the boundary' }]);
    for (let i = 0; i < 300; i++) text += jsonl([blob(1000)]);
    const s = await indexText(text + jsonl(tailLines));
    expect(s.customTitle).toBe('across the boundary');
  });

  it('skips a line longer than any title record and still finds the one after it', async () => {
    const lines: object[] = [user('first prompt'), ...Array.from({ length: 70 }, () => blob(1000))];
    // 2.5 MB in one line, spanning several reads, with the marker unescaped inside it.
    lines.push({ type: 'api-request-blob', 'custom-title': 'no', blob: 'y'.repeat(2.5 * 2 ** 20) });
    lines.push({ type: 'custom-title', customTitle: 'after the big line' });
    for (let i = 0; i < 300; i++) lines.push(blob(1000));
    const s = await indexText(jsonl([...lines, ...tailLines]));
    expect(s.customTitle).toBe('after the big line');
  });

  it('has no custom title when none was recorded', async () => {
    const lines: object[] = [user('first prompt')];
    for (let i = 0; i < 300; i++) lines.push(blob(1000));
    const s = await indexText(jsonl([...lines, ...tailLines]));
    expect(s).toMatchObject({ title: 'late ai title', customTitle: null });
  });
});

describe('cache', () => {
  it('re-reads a file only when its size or mtime changes, and drops removed files', async () => {
    const root = tmp();
    cpSync(join(FIXTURES, '-private-tmp-cc-spike'), join(root, 'p'), { recursive: true });
    const file = join(root, 'p', `${ids.custom}.jsonl`);
    const indexer = createIndexer({ projectsRoot: root, home: HOME, findRepoRoot });

    const [first] = await indexer.index();
    const [again] = await indexer.index();
    expect(again).toBe(first); // same object: served from cache

    writeFileSync(file, jsonl([{ type: 'custom-title', customTitle: 'renamed' }]), { flag: 'a' });
    const [changed] = await indexer.index();
    expect(changed?.title).toBe('renamed');

    rmSync(file);
    expect(await indexer.index()).toEqual([]);
  });
});

describe('derive rules', () => {
  const roots = resolveWorkspaces(DEFAULT_WORKSPACES, HOME);

  it('ticketKeyOf', () => {
    expect(ticketKeyOf('bugfix/ACME-623-621_pdp-fixes')).toBe('ACME-623');
    expect(ticketKeyOf('feature/AB2-9')).toBe('AB2-9');
    expect(ticketKeyOf('ACME-1-no-prefix')).toBeNull();
    expect(ticketKeyOf('feature/lower-1')).toBeNull();
    expect(ticketKeyOf('develop')).toBeNull();
    expect(ticketKeyOf(null)).toBeNull();
  });

  it('repoOf: git top-level, else first folder under its workspace root, else null', () => {
    const none = () => null;
    expect(repoOf(`${HOME}/o/notes/sub/dir`, roots, none)).toBe(`${HOME}/o/notes`);
    expect(repoOf(`${HOME}/o`, roots, none)).toBeNull();
    expect(repoOf(`${HOME}/y/acme/x`, roots, none)).toBe(`${HOME}/y/acme`);
    expect(repoOf(`${HOME}/y`, roots, none)).toBeNull();
    expect(repoOf(`${HOME}/oo/x`, roots, () => `${HOME}/oo`)).toBeNull(); // not under ~/o
    expect(repoOf(`${HOME}/o/a/b`, roots, () => `${HOME}/o/a/b`)).toBe(`${HOME}/o/a/b`);
  });

  it('workspaceOf: the deepest root holding cwd, else the fallback workspace (ADR 0061)', () => {
    const three = resolveWorkspaces(
      [
        ...DEFAULT_WORKSPACES,
        {
          id: 'client',
          label: 'Client',
          root: '~/y/client',
          kind: 'work',
          fallback: false,
          autoArchiveDays: 7,
        },
      ],
      HOME,
    );
    expect(workspaceOf(`${HOME}/y/acme`, three).id).toBe('work');
    expect(workspaceOf(`${HOME}/y/client/app`, three).id).toBe('client');
    expect(workspaceOf(`${HOME}/y/clientele`, three).id).toBe('work');
    expect(workspaceOf(`${HOME}/o/notes`, three).id).toBe('personal');
    expect(workspaceOf('/private/tmp/x', three).id).toBe('personal'); // the fallback
    expect(repoOf(`${HOME}/y/client/app/src`, three, () => null)).toBe(`${HOME}/y/client/app`);
  });

  it('findGitRoot walks up to the nearest .git folder or file, not above the ceiling', () => {
    const home = tmp();
    const ceiling = join(home, 'o');
    mkdirSync(join(ceiling, 'repo', '.git'), { recursive: true });
    mkdirSync(join(ceiling, 'repo', 'wt', 'src'), { recursive: true });
    writeFileSync(join(ceiling, 'repo', 'wt', '.git'), 'gitdir: ../.git/worktrees/wt');
    mkdirSync(join(ceiling, 'plain', 'deep'), { recursive: true });
    mkdirSync(join(home, '.git'));

    expect(findGitRoot(join(ceiling, 'repo', 'a', 'b'), ceiling)).toBe(join(ceiling, 'repo'));
    expect(findGitRoot(join(ceiling, 'repo', 'wt', 'src'), ceiling)).toBe(
      join(ceiling, 'repo', 'wt'),
    );
    expect(findGitRoot(join(ceiling, 'plain', 'deep'), ceiling)).toBeNull();
  });
});
