import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { envsFromCommand, envsFromResult, newTally, tallyLine, topEnv } from './hac';
import { createIndexer } from './index';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/hac-cli');
const HAC_ID = 'aaaaaaaa-1111-4111-8111-000000000001';
const HOME = '/Users/annayang';

describe('envsFromCommand', () => {
  it.each([
    ['hac sql "SELECT 1" -p acme -e d3', [{ project: 'acme', name: 'd3' }], true],
    ["hac groovy 'x' --env=s1", [{ project: null, name: 's1' }], true],
    ['hac ping --project "acme" --env "p1"', [{ project: 'acme', name: 'p1' }], true],
    [
      'cd x && hac ping -e s1; hac ping -e p1',
      [
        { project: null, name: 's1' },
        { project: null, name: 'p1' },
      ],
      true,
    ],
    ['for e in p1 s1; do hac ping -e "$e"; done', [], false],
    ['hac flexible-search "SELECT 1"', [], false],
  ])('%s', (command, envs, complete) => {
    expect(envsFromCommand(command)).toEqual({ envs, complete });
  });

  it.each([
    'gh search repos hac --owner sap',
    'which hac',
    'hac --version',
    'hac projects -e p1',
    'hac session -e s1; hac logout --all',
    'echo shack -e p1',
  ])('ignores %s', (command) => {
    expect(envsFromCommand(command)).toEqual({ envs: [], complete: true });
  });
});

describe('envsFromResult', () => {
  const envelope = (command: string, env: string) =>
    JSON.stringify({ tool: 'hac/0.3.0', command, project: 'acme', env, params: {}, ok: true });

  it('reads every envelope and skips non-operations', () => {
    const text = `== p1\n${envelope('ping', 'p1')}\n${envelope('projects', 'd3')}\n${envelope('sql', 's1')}`;
    expect(envsFromResult(text)).toEqual([
      { project: 'acme', name: 'p1' },
      { project: 'acme', name: 's1' },
    ]);
  });

  it('ignores env-looking text outside a hac envelope', () => {
    expect(envsFromResult('{"tool":"other","command":"sql","env":"p1"}')).toEqual([]);
  });
});

describe('topEnv', () => {
  const bash = (id: string, command: string) => ({
    message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
  });

  it('most used wins, ties go to the latest, and project-less uses join their project', () => {
    const tally = newTally();
    tallyLine(tally, bash('a', 'hac ping -p acme -e p1'));
    tallyLine(tally, bash('b', 'hac ping -p acme -e s1'));
    expect(topEnv(tally)).toEqual({ project: 'acme', name: 's1' });
    tallyLine(tally, bash('c', 'hac ping -e p1'));
    expect(topEnv(tally)).toEqual({ project: 'acme', name: 'p1' });
  });

  it('reads the reply only for calls whose command names no env', () => {
    const tally = newTally();
    const reply = (id: string, env: string) => ({
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: [
              {
                type: 'text',
                text: `{"tool":"hac/0.3.0","command":"sql","project":"acme","env":"${env}"}`,
              },
            ],
          },
        ],
      },
    });
    tallyLine(tally, bash('a', 'hac sql "x" -e d3'));
    tallyLine(tally, reply('a', 'p1')); // literal env already counted
    tallyLine(tally, bash('b', 'hac sql "x"'));
    tallyLine(tally, reply('b', 'd3'));
    expect([...tally.uses.values()].map((u) => [u.env.name, u.count])).toEqual([
      ['d3', 1],
      ['d3', 1],
    ]);
    expect(topEnv(tally)).toEqual({ project: 'acme', name: 'd3' });
  });

  it('is null with no hac calls', () => {
    expect(topEnv(newTally())).toBeNull();
  });
});

describe('indexer over fixtures/hac-cli', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  function projects(folder: string): string {
    const root = mkdtempSync(join(tmpdir(), 'hac-index-'));
    dirs.push(root);
    mkdirSync(join(root, folder));
    copyFileSync(join(FIXTURE, `${HAC_ID}.jsonl`), join(root, folder, `${HAC_ID}.jsonl`));
    return root;
  }

  it('finds hac calls in the middle of the file and makes the session Ops', async () => {
    const root = projects('-Users-annayang-y-acme-shop');
    const [s] = await createIndexer({
      projectsRoot: root,
      home: HOME,
      findRepoRoot: () => null,
    }).index();
    expect(s).toMatchObject({
      id: HAC_ID,
      env: { project: 'acme', name: 's1' },
      category: 'ops',
    });
  });

  it('reads only appended bytes when the file grows, and keeps counting', async () => {
    const root = projects('-Users-annayang-y-acme-shop');
    const indexer = createIndexer({ projectsRoot: root, home: HOME, findRepoRoot: () => null });
    expect((await indexer.index())[0]!.env?.name).toBe('s1');
    const call = (i: number) =>
      JSON.stringify({
        type: 'assistant',
        uuid: crypto.randomUUID(),
        timestamp: `2026-10-20T09:0${i}:00.000Z`,
        cwd: `${HOME}/y/acme-shop`,
        message: {
          content: [
            {
              type: 'tool_use',
              id: `g${i}`,
              name: 'Bash',
              input: { command: 'hac sql "x" -p acme -e p1' },
            },
          ],
        },
      }) + '\n';
    // s1 has 3 uses, p1 has 1: one more p1 call is not enough; at a tie the latest wins.
    appendFileSync(join(root, '-Users-annayang-y-acme-shop', `${HAC_ID}.jsonl`), call(1));
    expect((await indexer.index())[0]!.env?.name).toBe('s1');
    appendFileSync(join(root, '-Users-annayang-y-acme-shop', `${HAC_ID}.jsonl`), call(2) + call(3));
    expect((await indexer.index())[0]!.env?.name).toBe('p1');
  });

  it('Personal sessions get no hac pass', async () => {
    const root = projects('-Users-annayang-o-x');
    const file = join(root, '-Users-annayang-o-x', `${HAC_ID}.jsonl`);
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replaceAll(`${HOME}/y/acme-shop`, `${HOME}/o/x`),
    );
    const [s] = await createIndexer({
      projectsRoot: root,
      home: HOME,
      findRepoRoot: () => null,
    }).index();
    expect(s).toMatchObject({ workspace: 'personal', env: null, category: 'scratch' });
  });

  it('a ticket branch keeps the session in its ticket; the env is still reported', async () => {
    const root = projects('-Users-annayang-y-acme-shop');
    const file = join(root, '-Users-annayang-y-acme-shop', `${HAC_ID}.jsonl`);
    appendFileSync(
      file,
      JSON.stringify({
        type: 'user',
        uuid: crypto.randomUUID(),
        timestamp: '2026-10-21T08:00:00.000Z',
        cwd: `${HOME}/y/acme-shop`,
        gitBranch: 'feature/ACME-592-cron',
        message: { role: 'user', content: 'next' },
      }) + '\n',
    );
    const [s] = await createIndexer({
      projectsRoot: root,
      home: HOME,
      findRepoRoot: () => null,
    }).index();
    expect(s).toMatchObject({ ticketKey: 'ACME-592', category: 'ticket', env: { name: 's1' } });
  });
});
