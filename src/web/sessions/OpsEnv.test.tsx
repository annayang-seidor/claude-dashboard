// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiEnv, ApiSession } from '../../shared/api';
import { groupWork, matchesQuery } from './model';
import { NOW, renderEn, session } from './testing';
import { WorkList } from './WorkList';

afterEach(cleanup);

const env = (name: string, prod = false): ApiEnv => ({
  project: 'acme',
  name,
  display: name.toUpperCase(),
  prod,
});
const withState = (s: ApiSession, state: Partial<ApiSession['state']>): ApiSession => ({
  ...s,
  state: { ...s.state, ...state },
});

const p1a = withState(
  session({
    category: 'ops',
    env: env('p1', true),
    title: 'Order export failing',
    at: [10, 23, 10, 12],
  }),
  { releaseLabel: '2026.10 go-live' },
);
const p1b = session({
  category: 'ops',
  env: env('p1', true),
  title: 'Cache issue',
  at: [10, 23, 8, 40],
});
const s1 = session({
  category: 'ops',
  env: env('s1'),
  autoEnv: { project: 'acme', name: 's1' },
  title: 'Solr reindex stuck',
  at: [10, 20, 16, 5],
});
const ticket = session({ ticketKey: 'FA-540', title: 'Cart API', at: [10, 22, 9, 0] });

function renderList(sessions = [p1a, p1b, s1, ticket], onEdit = vi.fn()) {
  renderEn(
    <WorkList
      sessions={sessions}
      query=""
      now={NOW}
      onEdit={onEdit}
      onResume={vi.fn()}
      onDelete={vi.fn()}
      onNewSession={vi.fn()}
      onCleanup={vi.fn()}
    />,
  );
  return onEdit;
}

describe('Ops grouping and search', () => {
  it('keys Ops groups by env and titles them with the latest release label', () => {
    const groups = groupWork([s1, ticket, p1b, p1a]);
    expect(groups.map((g) => [g.kind, g.env?.name ?? g.key, g.releaseLabel])).toEqual([
      ['ops', 'p1', '2026.10 go-live'],
      ['ops', 's1', null],
      ['ticket', 'FA-540', null],
    ]);
  });

  it('search matches the env name and the release label', () => {
    expect(matchesQuery(s1, 's1')).toBe(true);
    expect(matchesQuery(p1a, 'go-live')).toBe(true);
    expect(matchesQuery(ticket, 's1')).toBe(false);
  });
});

describe('[ENV] tags', () => {
  it('shows the env tag before Ops group and row titles; prod is marked in text too', () => {
    renderList();
    const [prodGroup, stagingGroup] = screen.getAllByTestId('group');
    const prodHead = within(prodGroup!).getAllByRole('button')[0]!;
    expect(prodHead.textContent).toContain('[P1] (production)2026.10 go-live');
    expect(prodHead.textContent).toContain('Release debug');
    expect(prodGroup!.querySelector('.env-tag')?.getAttribute('data-prod')).toBe('true');

    const stagingHead = within(stagingGroup!).getAllByRole('button')[0]!;
    expect(stagingHead.textContent).toContain('[S1]acme');
    expect(stagingHead.textContent).toContain('Cloud environment debug · no ticket');
    expect(stagingGroup!.querySelector('.env-tag')?.getAttribute('data-prod')).toBe('false');

    const rows = within(prodGroup!).getAllByTestId('session-row');
    expect(rows[0]?.textContent).toContain('[P1] (production)Order export failing');
  });

  it('a [LOCAL] group says local, not cloud', () => {
    const local = session({
      category: 'ops',
      env: env('local'),
      title: 'Server will not start',
      at: [10, 21, 9, 0],
    });
    renderList([local]);
    const head = within(screen.getByTestId('group')).getAllByRole('button')[0]!;
    expect(head.textContent).toContain('[LOCAL]');
    expect(head.textContent).toContain('Fix local environment · no ticket');
    expect(head.textContent).not.toContain('Cloud');
  });

  it('the timeline shows the env tag in place of the key chip', async () => {
    renderList();
    await userEvent.click(screen.getByRole('button', { name: /Timeline/ }));
    const row = screen.getAllByTestId('session-row').find((r) => r.textContent?.includes('Solr'))!;
    expect(row.querySelectorAll('.env-tag')).toHaveLength(2); // title and group
  });
});

describe('row ⋯ menu', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path === '/api/envs'
          ? Response.json({ envs: [env('d3'), env('p1', true), env('s1')] })
          : new Response(null, { status: 404 }),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const openMenu = async (title: string) => {
    const row = screen.getAllByTestId('session-row').find((r) => r.textContent?.includes(title))!;
    const button = within(row).getByRole('button', { name: 'More actions' });
    expect(button?.getAttribute('title')).toBe('More actions');
    await userEvent.click(button);
    return { row, button };
  };

  it('lists the five Work actions and moves with the arrow keys', async () => {
    renderList();
    await openMenu('Solr');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Rename',
      'Copy resume command',
      'Change ticket',
      'Set environment',
      'Set release label',
    ]);
    expect(document.activeElement).toBe(items[0]);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(items[4]);
  });

  it('hides Set environment and Set release label when the session has a ticket', async () => {
    renderList([{ ...s1, branch: 'main', ticketKey: 'FA-540' }]);
    await openMenu('Solr');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Rename',
      'Copy resume command',
      'Change ticket',
    ]);
  });

  it('Change ticket saves an upper-cased key, and empty clears it', async () => {
    const onEdit = renderList();
    await openMenu('Solr');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change ticket' }));
    const input = screen.getByRole('textbox', { name: 'Change ticket' });
    expect(screen.getByText('Leave empty to go back to no ticket.')).toBeTruthy();
    await userEvent.type(input, ' acme-555 ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenLastCalledWith(s1.id, { ticketOverride: 'ACME-555' });

    await openMenu('Solr');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change ticket' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenLastCalledWith(s1.id, { ticketOverride: null });
  });

  it('Change ticket keeps the form open on a bad key', async () => {
    const onEdit = renderList();
    await openMenu('Solr');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change ticket' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Change ticket' }), 'not a key');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('Use a ticket key like ACME-555.')).toBeTruthy();
  });

  it('Change ticket shows the branch key and drops an old category override', async () => {
    const overridden = withState(
      session({ ticketKey: 'FA-1', category: 'scratch', title: 'Moved', at: [10, 21, 9, 0] }),
      { categoryOverride: 'scratch' },
    );
    const onEdit = renderList([overridden]);
    await openMenu('Moved');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change ticket' }));
    expect(screen.getByText("Leave empty to use the branch's ticket (FA-1).")).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Change ticket' }), 'FA-2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenLastCalledWith(overridden.id, {
      ticketOverride: 'FA-2',
      categoryOverride: null,
    });
  });

  it('Set environment lists hac envs and saves a project/name ref', async () => {
    const onEdit = renderList();
    await openMenu('Solr');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set environment' }));
    const select = screen.getByRole('combobox', { name: 'Set environment' });
    expect((select as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('Detected (S1)');
    await screen.findByRole('option', { name: '[P1] acme (production)' });
    await userEvent.selectOptions(select, 'acme/p1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenLastCalledWith(s1.id, { envOverride: 'acme/p1' });
  });

  it('Set release label trims, and an empty label clears it', async () => {
    const onEdit = renderList();
    await openMenu('Order export');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set release label' }));
    const input = screen.getByRole('textbox', { name: 'Set release label' });
    expect((input as HTMLInputElement).value).toBe('2026.10 go-live');
    await userEvent.clear(input);
    await userEvent.type(input, '  2026.11 hotfix {Enter}');
    expect(onEdit).toHaveBeenLastCalledWith(p1a.id, { releaseLabel: '2026.11 hotfix' });

    await openMenu('Order export');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set release label' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Set release label' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenLastCalledWith(p1a.id, { releaseLabel: null });
  });

  it('Escape closes without saving and returns focus to ⋯', async () => {
    const onEdit = renderList();
    const { button } = await openMenu('Solr');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set release label' }));
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('form')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
