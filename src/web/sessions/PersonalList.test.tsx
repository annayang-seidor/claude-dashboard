// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalList } from './PersonalList';
import { NOW, renderEn, session } from './testing';

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

const personal = { workspace: 'personal' as const };
const dashA = session({
  ...personal,
  repo: '/Users/me/o/claude-dashboard',
  branch: 'feature/list',
  title: 'Build the session list',
  at: [10, 22, 21, 40],
});
const dashB = session({
  ...personal,
  repo: '/Users/me/o/claude-dashboard',
  branch: 'main',
  title: 'Fix header wrap',
  at: [10, 23, 9, 0],
  status: 'done',
});
const blog = session({
  ...personal,
  repo: '/Users/me/o/blog',
  branch: 'main',
  title: 'Draft post',
  at: [10, 3, 20, 15],
});
const loose = session({
  ...personal,
  repo: null,
  cwd: '/tmp',
  title: 'Regex test',
  at: [10, 21, 23, 5],
});
const ALL = [blog, dashA, loose, dashB];

function setup(query = '') {
  renderEn(
    <PersonalList
      sessions={ALL}
      query={query}
      now={NOW}
      onEdit={vi.fn()}
      onResume={vi.fn()}
      onDelete={vi.fn()}
      onCleanup={vi.fn()}
    />,
  );
}

const groupHeads = () =>
  screen.getAllByTestId('group').map((g) => within(g).getAllByRole('button')[0]!.textContent);
const rowFor = (title: string) =>
  screen
    .getAllByTestId('session-row')
    .find((r) => r.querySelector('.row__title')!.textContent === title)!;
const rowTitles = () =>
  screen.queryAllByTestId('session-row').map((r) => r.querySelector('.row__title')!.textContent);

describe('PersonalList', () => {
  it('shows the intro, repo groups newest first and sessions outside a repo last', () => {
    setup();
    expect(screen.getByText('Personal projects - grouped by repo')).toBeTruthy();
    expect(groupHeads()).toEqual([
      '~/o/claude-dashboard2 sessions · last active today',
      '~/o/blog1 sessions · last active 10/03',
      'Outside a repo1 sessions · last active Wed',
    ]);
    // Newest first within a group; Done keeps its place.
    expect(rowTitles()).toEqual([dashB.title, dashA.title, blog.title, loose.title]);
  });

  it('until auto-archive ships, labels rows with branch and time only', () => {
    setup();
    const row = rowFor(dashA.title);
    expect(row.querySelector('.row__meta')!.textContent).toBe('feature/list · Yesterday 21:40');
    expect(screen.queryByText(/Moves to trash|Bookmarked, kept/)).toBeNull();
  });

  it('with auto-archive on, labels rows with a 14-day trash countdown; never "Scratch"', () => {
    flags.autoArchive = true;
    setup();
    const row = rowFor(dashA.title);
    expect(row.querySelector('.row__meta')!.textContent).toBe(
      'feature/list · Yesterday 21:40Moves to trash in 13 days',
    );
    const outside = screen.getAllByTestId('group')[2]!;
    expect(within(outside).getByText('Moves to trash in 12 days')).toBeTruthy();
    // 20 days idle: due on the next auto-archive run.
    expect(
      within(screen.getAllByTestId('group')[1]!).getByText('Moves to trash soon'),
    ).toBeTruthy();
    expect(screen.queryByText(/Scratch/)).toBeNull();
  });

  it('searches title, repo and branch', () => {
    setup('BLOG');
    expect(rowTitles()).toEqual([blog.title]);
    cleanup();
    setup('main');
    expect(rowTitles()).toEqual([dashB.title, blog.title]);
  });

  it('filters by project chip, one at a time, with counts that ignore search and status', () => {
    setup('main');
    const chips = within(screen.getByRole('group', { name: 'Filter by project' }));
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All projects 4',
      'claude-dashboard 2',
      'blog 1',
      'Outside a repo 1',
    ]);
    expect(chips.getByRole('button', { name: /claude-dashboard/ }).title).toBe(
      '~/o/claude-dashboard',
    );
    fireEvent.click(chips.getByRole('button', { name: /blog/ }));
    expect(rowTitles()).toEqual([blog.title]);
    expect(chips.getByRole('button', { name: /blog/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chips.getByRole('button', { name: /claude-dashboard/ }));
    expect(rowTitles()).toEqual([dashB.title]);
    fireEvent.click(chips.getByRole('button', { name: /All projects/ }));
    expect(rowTitles()).toEqual([dashB.title, blog.title]);
  });

  it('filters by status, with counts that follow the project', () => {
    setup();
    const pills = within(screen.getByRole('group', { name: 'Filter by status' }));
    const counts = () => pills.getAllByRole('button').map((b) => b.textContent);
    expect(counts()).toEqual(['All statuses 4', 'To do 3', 'Done 1', 'Bookmarked 0']);
    fireEvent.click(pills.getByRole('button', { name: /Done/ }));
    expect(rowTitles()).toEqual([dashB.title]);
    const chips = within(screen.getByRole('group', { name: 'Filter by project' }));
    fireEvent.click(chips.getByRole('button', { name: /blog/ }));
    expect(counts()).toEqual(['All statuses 1', 'To do 1', 'Done 0', 'Bookmarked 0']);
    expect(screen.getByText('No sessions here yet.')).toBeTruthy();
  });

  it('shows the empty state for a query with no match', () => {
    setup('nothing-here');
    expect(screen.getByText(/No sessions match "nothing-here"/)).toBeTruthy();
  });
});
