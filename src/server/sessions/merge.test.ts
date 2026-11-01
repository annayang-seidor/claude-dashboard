import { describe, expect, it } from 'vitest';
import type { HacEnv } from '../../shared/env';
import type { Session } from '../../shared/session';
import { SessionState } from '../../shared/state';
import { merge, type EnvContext } from './index';

const gates = { allowSqlCommit: false, allowGroovyCommit: false, allowImpexImport: false };
const known = (project: string, name: string, readOnly = false): HacEnv => ({
  project,
  name,
  readOnly,
  ...gates,
});
const ctx: EnvContext = {
  envs: [known('acme', 's1'), known('acme', 'live', true), known('acme', 'd1')],
};

const session = (over: Partial<Session> = {}): Session => ({
  id: 'aaaaaaaa-1111-4111-8111-000000000001',
  filePath: '/p/x.jsonl',
  cwd: '/Users/me/y/acme-shop',
  workspace: 'work',
  repo: null,
  branch: null,
  branchesSeen: [],
  ticketKey: null,
  env: { project: 'acme', name: 's1' },
  category: 'ops',
  title: 't',
  customTitle: null,
  createdAt: '2026-10-20T08:00:00.000Z',
  lastActivityAt: '2026-10-20T08:00:00.000Z',
  ...over,
});
const state = (over: object = {}) => SessionState.parse(over);

describe('merge', () => {
  it('shows the detected env with its tag text', () => {
    const m = merge(session(), state(), ctx);
    expect(m.env).toEqual({ project: 'acme', name: 's1', display: 'S1', prod: false });
    expect(m).toMatchObject({ category: 'ops', autoCategory: 'ops' });
  });

  it('envOverride wins over detection and turns a Scratch session into Ops', () => {
    const m = merge(
      session({ env: null, category: 'scratch' }),
      state({ envOverride: 'acme/live' }),
      ctx,
    );
    expect(m.env).toEqual({ project: 'acme', name: 'live', display: 'LIVE', prod: true });
    expect(m).toMatchObject({ autoEnv: null, category: 'ops', autoCategory: 'ops' });
    expect(m.state.envOverride).toBe('acme/live');
  });

  it('categoryOverride wins over an env', () => {
    const m = merge(session(), state({ categoryOverride: 'scratch' }), ctx);
    expect(m).toMatchObject({ category: 'scratch', autoCategory: 'ops', env: { name: 's1' } });
  });

  it('a ticket (detected or overridden) wins over an env', () => {
    expect(merge(session(), state({ ticketOverride: 'ACME-1' }), ctx).category).toBe('ticket');
    expect(merge(session({ ticketKey: 'ACME-2' }), state(), ctx).category).toBe('ticket');
  });

  it('a dashboard title wins over the automatic one, which stays in autoTitle', () => {
    const auto = session({ title: 'from claude', customTitle: 'from claude' });
    expect(merge(auto, state(), ctx)).toMatchObject({
      title: 'from claude',
      autoTitle: 'from claude',
      state: { status: 'todo', bookmarked: false },
    });
    const renamed = merge(auto, state({ title: 'mine', titleSnapshot: 'from claude' }), ctx);
    expect(renamed).toMatchObject({ title: 'mine', autoTitle: 'from claude' });
    // The snapshot is the server's business only.
    expect(renamed.state).toEqual({ status: 'todo', bookmarked: false, title: 'mine' });
  });

  it('returns the release label', () => {
    expect(
      merge(session(), state({ releaseLabel: '2026.10 go-live' }), ctx).state.releaseLabel,
    ).toBe('2026.10 go-live');
  });

  it.each([
    ['read_only in hac', { project: 'acme', name: 'live' }, true],
    ['the name rule, unknown to hac', { project: null, name: 'p2' }, true],
    ['a plain env', { project: 'acme', name: 'd1' }, false],
  ])('prod from %s', (_label, env, prod) => {
    expect(merge(session({ env }), state(), ctx).env?.prod).toBe(prod);
  });

  it('fills a missing project when one project has that env, and applies its flags', () => {
    expect(
      merge(session({ env: { project: null, name: 'live' } }), state(), ctx).env,
    ).toMatchObject({
      project: 'acme',
      prod: true,
    });
  });
});
