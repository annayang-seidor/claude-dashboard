// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '../../shared/api';
import { NOW, renderEn, session } from './testing';
import type { JiraTitleMap } from './model';
import { WorkList } from './WorkList';

afterEach(cleanup);

// The config's autoArchive.enabled, flipped per test to cover both states.
const flags = vi.hoisted(() => ({ autoArchive: false }));
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>();
  return {
    ...actual,
    useConfig: () => ({
      ...actual.useConfig(),
      autoArchive: { enabled: flags.autoArchive },
    }),
  };
});

afterEach(() => (flags.autoArchive = false));

// Shaped after the prototype's Work page (today is Friday 23 Oct).
const ops = session({
  category: 'ops',
  title: 'Prod order export cronjob failing',
  at: [10, 23, 10, 12],
});
const cart1 = session({
  ticketKey: 'FA-540',
  branch: 'feature/FA-540-cart-api',
  title: 'Fix SonarQube: cognitive complexity',
  at: [10, 23, 9, 15],
});
const cart2 = session({
  ticketKey: 'FA-540',
  branch: 'feature/FA-540-cart-api',
  title: 'Reply to PR review: DTO naming',
  at: [10, 22, 15, 2],
  status: 'done',
});
const cart3 = session({
  ticketKey: 'FA-540',
  branch: 'feature/FA-540-cart-api',
  title: 'Split CartFacade',
  at: [10, 15, 11, 30],
  status: 'done',
  bookmarked: true,
});
const promo1 = session({
  ticketKey: 'FA-554',
  branch: 'feature/FA-554-member-discount',
  title: 'Compare mockup, break down promotion rules',
  at: [10, 22, 18, 30],
});
const promo2 = session({
  ticketKey: 'FA-554',
  branch: 'feature/FA-554-member-discount',
  title: 'Query PromotionResult data in hac',
  at: [10, 19, 11, 20],
  bookmarked: true,
});
const groovy = session({ title: 'Check Groovy script syntax', at: [10, 23, 7, 55] });
const impex = session({
  title: 'Explain ImpEx header syntax',
  at: [10, 19, 14, 0],
  bookmarked: true,
});
const ALL = [ops, cart1, cart2, cart3, promo1, promo2, groovy, impex];

function setup(query = '', sessions: ApiSession[] = ALL, titles: JiraTitleMap = {}) {
  const onEdit = vi.fn();
  const onResume = vi.fn();
  const onDelete = vi.fn();
  const onNewSession = vi.fn(async () => true);
  const user = userEvent.setup();
  const list = (q: string) => (
    <WorkList
      sessions={sessions}
      query={q}
      now={NOW}
      titles={titles}
      onEdit={onEdit}
      onResume={onResume}
      onDelete={onDelete}
      onNewSession={onNewSession}
      onCleanup={vi.fn()}
    />
  );
  const utils = renderEn(list(query));
  const rerender = (q: string) => utils.rerender(list(q));
  return { onEdit, onResume, onDelete, onNewSession, user, ...utils, rerenderQuery: rerender };
}

const typeChip = (name: string) =>
  within(screen.getByRole('group', { name: 'Filter by type' })).getByRole('button', {
    name: new RegExp(`^${name} \\d+$`),
  });
const statusChip = (name: string) =>
  within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', {
    name: new RegExp(`^${name} \\d+$`),
  });
const groupHeads = () =>
  screen.getAllByTestId('group').map((g) => within(g).getAllByRole('button')[0]!.textContent);
const rowTitles = () =>
  screen.queryAllByTestId('session-row').map((r) => r.querySelector('.row__title')!.textContent);

const TITLES: JiraTitleMap = {
  'FA-540': { title: 'Cart API refactor', status: 'In Progress' },
  'FA-554': { title: 'Show member discount at checkout', status: 'To Do' },
};

describe('Jira titles', () => {
  it('follow the key in ticket group headings, and nothing shows before a lookup', () => {
    const { unmount } = setup('', ALL, TITLES);
    expect(groupHeads()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('FA-540Cart API refactor'),
        expect.stringContaining('FA-554Show member discount at checkout'),
      ]),
    );
    unmount();
    setup();
    expect(screen.queryByText('Cart API refactor')).toBeNull();
  });

  it('are searchable: a word from the Jira title finds the ticket group', () => {
    setup('member discount', ALL, TITLES);
    expect(groupHeads()).toEqual([expect.stringContaining('FA-554')]);
    expect(rowTitles()).toEqual([
      'Compare mockup, break down promotion rules',
      'Query PromotionResult data in hac',
    ]);
  });

  it('show beside the key in the timeline', async () => {
    const { user } = setup('', ALL, TITLES);
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    const row = screen
      .getAllByTestId('session-row')
      .find((r) => r.textContent?.includes('Fix SonarQube'))!;
    expect(row.textContent).toContain('Cart API refactor');
  });
});

describe('By ticket view', () => {
  it('orders groups Ops → tickets → Scratch, and rows To do first, then Done, newest first', () => {
    setup();
    expect(groupHeads()).toEqual([
      expect.stringContaining('Ops'),
      expect.stringContaining('FA-540'),
      expect.stringContaining('FA-554'),
      expect.stringContaining('Scratch'),
    ]);
    expect(rowTitles()).toEqual([
      ops.title,
      cart1.title,
      cart2.title,
      cart3.title,
      promo1.title,
      promo2.title,
      groovy.title,
      impex.title,
    ]);
  });

  it('shows branch and n/m done on ticket groups', () => {
    setup();
    const cart = screen.getAllByTestId('group')[1]!;
    expect(within(cart).getByText('~/y · feature/FA-540-cart-api · 2/3 done')).toBeTruthy();
    expect(within(cart).getByText('3 sessions')).toBeTruthy();
    // No done rows → no "done" count.
    expect(within(screen.getAllByTestId('group')[2]!).queryByText(/done/)).toBeNull();
  });

  it('"New session for this ticket" asks for a session named after the ticket and its Jira title', async () => {
    const titles = { 'FA-540': { title: 'Cart API', status: 'In Progress', fetchedAt: '' } };
    const { user, onNewSession } = setup('', ALL, titles);
    const cart = screen.getAllByTestId('group')[1]!;
    await user.click(within(cart).getByRole('button', { name: 'New session for this ticket' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' }).value).toBe(
      'FA-540 Cart API',
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(onNewSession).toHaveBeenCalledExactlyOnceWith('FA-540', 'FA-540 Cart API');
  });

  it('disables "New session for this ticket" on a ticket group with no key', () => {
    setup('', [session({ category: 'ticket', title: 'Overridden to ticket', at: [10, 23, 9, 0] })]);
    const button = screen.getByRole('button', { name: 'New session for this ticket' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['Resume', 'onResume'],
    ['Delete', 'onDelete'],
  ] as const)("%s passes the row's session, in both views", async (button, handler) => {
    const { user, ...handlers } = setup();
    const row = screen.getByText(cart1.title).closest('[data-testid="session-row"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: button }));
    expect(handlers[handler]).toHaveBeenLastCalledWith(cart1);

    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    const timelineRow = screen
      .getByText(promo2.title)
      .closest('[data-testid="session-row"]') as HTMLElement;
    await user.click(within(timelineRow).getByRole('button', { name: button }));
    expect(handlers[handler]).toHaveBeenLastCalledWith(promo2);
  });

  it('until auto-archive ships, promises no move to trash anywhere', () => {
    setup();
    expect(screen.queryByText(/[Mm]oves to trash|Bookmarked, kept/)).toBeNull();
    expect(within(screen.getAllByTestId('group')[3]!).getByText('No ticket')).toBeTruthy();
    expect(screen.getByText('Scratch: no ticket')).toBeTruthy();
  });

  it('with auto-archive on, shows Scratch trash notes, and "Bookmarked, kept" when bookmarked', () => {
    flags.autoArchive = true;
    setup();
    expect(
      screen.getByText('No ticket · moves to trash after 7 idle days; bookmark to keep'),
    ).toBeTruthy();
    expect(
      screen.getByText('Scratch: moves to trash after 7 idle days (unless bookmarked)'),
    ).toBeTruthy();
    const scratch = screen.getAllByTestId('group')[3]!;
    expect(within(scratch).getByText('Moves to trash in 7 days')).toBeTruthy();
    expect(within(scratch).getByText('Bookmarked, kept')).toBeTruthy();
  });

  it('collapses and expands a group', async () => {
    const { user } = setup();
    const head = within(screen.getAllByTestId('group')[1]!).getAllByRole('button')[0]!;
    expect(head.getAttribute('aria-expanded')).toBe('true');
    await user.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(rowTitles()).not.toContain(cart1.title);
    await user.click(head);
    expect(rowTitles()).toContain(cart1.title);
  });
});

describe('type and status filters', () => {
  it('counts every type, and status counts follow the type filter', async () => {
    const { user } = setup();
    expect(typeChip('All').textContent).toBe('All 8');
    expect(typeChip('Ops').textContent).toBe('Ops 1');
    expect(typeChip('Ticket').textContent).toBe('Ticket 5');
    expect(typeChip('Scratch').textContent).toBe('Scratch 2');
    expect(statusChip('All statuses').textContent).toBe('All statuses 8');
    expect(statusChip('To do').textContent).toBe('To do 6');
    expect(statusChip('Bookmarked').textContent).toBe('Bookmarked 3');
    expect(statusChip('Done').textContent).toBe('Done 2');

    await user.click(typeChip('Ticket'));
    expect(typeChip('Ticket').getAttribute('aria-pressed')).toBe('true');
    expect(typeChip('All').textContent).toBe('All 8');
    expect(statusChip('All statuses').textContent).toBe('All statuses 5');
    expect(statusChip('To do').textContent).toBe('To do 3');
    expect(statusChip('Bookmarked').textContent).toBe('Bookmarked 2');
    expect(statusChip('Done').textContent).toBe('Done 2');
  });

  it('Ticket + To do', async () => {
    const { user } = setup();
    await user.click(typeChip('Ticket'));
    await user.click(statusChip('To do'));
    expect(rowTitles()).toEqual([cart1.title, promo1.title, promo2.title]);
  });

  it('Scratch + Bookmarked', async () => {
    const { user } = setup();
    await user.click(typeChip('Scratch'));
    await user.click(statusChip('Bookmarked'));
    expect(groupHeads()).toEqual([expect.stringContaining('Scratch')]);
    expect(rowTitles()).toEqual([impex.title]);
  });

  it('All + Done hides groups with no done rows, but n/m done still counts the whole group', async () => {
    const { user } = setup();
    await user.click(statusChip('Done'));
    expect(groupHeads()).toHaveLength(1);
    expect(screen.getByText('~/y · feature/FA-540-cart-api · 2/3 done')).toBeTruthy();
    expect(screen.getByText('2 sessions')).toBeTruthy();
  });

  it('Ops + Done is empty without a query: shows the empty note', async () => {
    const { user } = setup();
    await user.click(typeChip('Ops'));
    await user.click(statusChip('Done'));
    expect(rowTitles()).toEqual([]);
    expect(screen.getByText('No sessions here yet.')).toBeTruthy();
  });
});

describe('search', () => {
  it('matches ticket keys case-insensitively and expands collapsed groups', async () => {
    const { user, rerenderQuery } = setup();
    await user.click(within(screen.getAllByTestId('group')[2]!).getAllByRole('button')[0]!);
    expect(rowTitles()).not.toContain(promo1.title);
    rerenderQuery('fa-554');
    expect(rowTitles()).toEqual([promo1.title, promo2.title]);
    expect(
      within(screen.getByTestId('group')).getAllByRole('button')[0]!.getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('matches a word from the title as you type', () => {
    const { rerenderQuery } = setup('S');
    rerenderQuery('SY');
    rerenderQuery('Syntax');
    expect(rowTitles()).toEqual([groovy.title, impex.title]);
  });

  it('combines with type and status filters', async () => {
    const { user, rerenderQuery } = setup();
    rerenderQuery('cart');
    expect(rowTitles()).toEqual([cart3.title]);
    rerenderQuery('fa-540');
    await user.click(typeChip('Ticket'));
    await user.click(statusChip('Done'));
    expect(rowTitles()).toEqual([cart2.title, cart3.title]);
    await user.click(statusChip('Bookmarked'));
    expect(rowTitles()).toEqual([cart3.title]);
  });

  it('shows the prototype empty state with the query', async () => {
    const { user } = setup('  FA-999 ');
    expect(
      screen.getByText('No sessions match "FA-999". Try a ticket number or a word from the title.'),
    ).toBeTruthy();
    expect(rowTitles()).toEqual([]);
    // Still empty under the timeline view.
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
  });

  it('a query that matches only outside the type filter shows the empty state', async () => {
    const { user } = setup('groovy');
    await user.click(typeChip('Ticket'));
    expect(screen.getByText(/No sessions match "groovy"/)).toBeTruthy();
  });
});

describe('Timeline view', () => {
  it('buckets rows by day with the group key tag', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByRole('button', { name: 'Timeline' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const buckets = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(buckets).toEqual(['Today', 'Yesterday', 'Earlier this week', 'Older']);

    const today = screen.getByRole('heading', { name: 'Today' }).parentElement!;
    const rows = within(today).getAllByTestId('session-row');
    expect(rows.map((r) => r.querySelector('.row__title')!.textContent)).toEqual([
      ops.title,
      cart1.title,
      groovy.title,
    ]);
    expect(rows.map((r) => r.querySelector('.key-chip')!.textContent)).toEqual([
      'ops',
      'FA-540',
      'scratch',
    ]);
    expect(rows[0]!.querySelector('.row__clock')!.textContent).toBe('10:12');

    const older = screen.getByRole('heading', { name: 'Older' }).parentElement!;
    expect(within(older).getByText('Last Thu')).toBeTruthy();
  });

  it('applies filters and search too', async () => {
    const { user, rerenderQuery } = setup();
    await user.click(screen.getByRole('button', { name: 'Timeline' }));
    await user.click(statusChip('Bookmarked'));
    rerenderQuery('hac');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Earlier this week',
    ]);
    expect(rowTitles()).toEqual([promo2.title]);
  });
});

describe('row controls', () => {
  it('status select and bookmark call onEdit; bookmark exposes aria-pressed', async () => {
    const { user, onEdit } = setup('Split CartFacade');
    const row = screen.getByTestId('session-row');
    const select = within(row).getByLabelText('Status') as HTMLSelectElement;
    expect(select.value).toBe('done');
    await user.selectOptions(select, 'todo');
    expect(onEdit).toHaveBeenCalledWith(cart3.id, { status: 'todo' });

    const bookmark = within(row).getByRole('button', { name: 'Bookmark' });
    expect(bookmark.getAttribute('aria-pressed')).toBe('true');
    expect(bookmark.getAttribute('title')).toBe('Bookmarked, click to remove');
    await user.click(bookmark);
    expect(onEdit).toHaveBeenCalledWith(cart3.id, { bookmarked: false });
  });

  it('greys Done titles; Resume and Delete are labelled and enabled', () => {
    setup('fa-540');
    const [todo, done] = screen.getAllByTestId('session-row');
    expect(todo!.querySelector('.row__title')!.getAttribute('data-done')).toBe('false');
    expect(done!.querySelector('.row__title')!.getAttribute('data-done')).toBe('true');
    for (const name of ['Resume', 'Delete']) {
      const btn = within(todo!).getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.title).toBe(name);
      expect(btn.disabled).toBe(false);
    }
  });
});
