import { describe, expect, it } from 'vitest';
import { parseSse } from '../sse';
import { MESSAGES } from '../i18n/core';
import {
  compareRows,
  groupPersonal,
  groupWork,
  matchesQuery,
  repoLabel,
  statusCounts,
  typeCounts,
} from './model';
import { NOW, session } from './fixtures';
import { agoLabel, bucketOf, claudeCleanupWarning, daysUntilTrash, whenLabels } from './time';

const at = (month: number, day: number, hour = 10, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute).toISOString();

describe('whenLabels (Friday 23 Oct, en)', () => {
  const label = (iso: string) => whenLabels(iso, NOW, MESSAGES.en);

  it('writes today, yesterday, this week, last week and older like the prototype', () => {
    expect(label(at(10, 23, 10, 12))).toEqual({
      time: 'Today 10:12',
      clock: '10:12',
      day: 'today',
    });
    expect(label(at(10, 22, 15, 2))).toEqual({
      time: 'Yesterday 15:02',
      clock: '15:02',
      day: 'yesterday',
    });
    expect(label(at(10, 20, 16, 5))).toEqual({ time: 'Tue 16:05', clock: 'Tue', day: 'Tue' });
    expect(label(at(10, 15, 11, 30))).toEqual({
      time: 'Last Thu 11:30',
      clock: 'Last Thu',
      day: 'Last Thu',
    });
    expect(label(at(10, 5, 10, 20))).toEqual({ time: '10/05 10:20', clock: '10/05', day: '10/05' });
  });

  it('names the weekday for the last 6 days even across a Monday', () => {
    expect(label(at(10, 18, 15, 10)).time).toBe('Sun 15:10');
    expect(label(at(10, 17, 9, 0)).time).toBe('Sat 09:00');
    expect(label(at(10, 16, 9, 0)).time).toBe('Last Fri 09:00');
    expect(label(at(10, 10, 9, 0)).time).toBe('Last Sat 09:00');
    expect(label(at(10, 9, 9, 0)).time).toBe('10/09 09:00');
  });

  it('uses the zh-TW table', () => {
    expect(whenLabels(at(10, 15, 11, 30), NOW, MESSAGES['zh-TW']).time).toBe('上週四 11:30');
    expect(whenLabels(at(10, 20, 16, 5), NOW, MESSAGES['zh-TW']).time).toBe('週二 16:05');
  });
});

describe('agoLabel', () => {
  const ago = (minutes: number, lang: 'en' | 'zh-TW' = 'en') =>
    agoLabel(new Date(NOW.getTime() - minutes * 60_000).toISOString(), NOW, MESSAGES[lang]);
  it.each([
    [0, 'just now'],
    [0.9, 'just now'],
    [1, '1 min ago'],
    [59, '59 min ago'],
    [60, '1h ago'],
    [23 * 60 + 59, '23h ago'],
    [24 * 60, '1d ago'],
    [-5, 'just now'], // a clock a little ahead of the server's
  ])('%s min → %s', (minutes, label) => {
    expect(ago(minutes)).toBe(label);
  });

  it('speaks zh-TW', () => {
    expect(ago(2, 'zh-TW')).toBe('2 分鐘前');
    expect(ago(0, 'zh-TW')).toBe('剛剛');
  });
});

describe('bucketOf', () => {
  it('splits Today / Yesterday / Earlier this week (from Monday) / Older', () => {
    expect(bucketOf(new Date(at(10, 23, 0, 1)), NOW)).toBe('today');
    expect(bucketOf(new Date(at(10, 22, 23, 59)), NOW)).toBe('yesterday');
    expect(bucketOf(new Date(at(10, 19, 0, 0)), NOW)).toBe('thisWeek');
    expect(bucketOf(new Date(at(10, 18, 23, 59)), NOW)).toBe('older');
  });

  it('keeps Sunday as Yesterday when today is Monday', () => {
    expect(bucketOf(new Date(at(10, 25, 20)), new Date(2026, 9, 26, 9))).toBe('yesterday');
  });
});

describe('daysUntilTrash', () => {
  it('counts calendar days down from the idle limit', () => {
    expect(daysUntilTrash(at(10, 23, 0, 5), NOW, 7)).toBe(7);
    expect(daysUntilTrash(at(10, 22, 23, 50), NOW, 7)).toBe(6);
    expect(daysUntilTrash(at(10, 17, 9), NOW, 7)).toBe(1);
    expect(daysUntilTrash(at(10, 16, 12), NOW, 7)).toBe(0);
    expect(daysUntilTrash(at(10, 16, 12), NOW, 14)).toBe(7);
  });
});

describe('claudeCleanupWarning (7-day warning)', () => {
  const warn = (
    day: [month: number, day: number],
    bookmarked: boolean,
    limit: number | null | undefined,
  ) => claudeCleanupWarning(session({ at: [...day, 9, 0], bookmarked }), NOW, limit, 7);

  it('warns bookmarked sessions from 7 days before the limit', () => {
    expect(warn([10, 1], true, 30)).toBeNull(); // 22 days idle: 8 left
    expect(warn([9, 30], true, 30)).toBe(7);
    expect(warn([10, 22], true, 8)).toBe(7); // the limit comes from settings, not 30
    expect(warn([9, 24], true, 30)).toBe(1);
    expect(warn([9, 23], true, 30)).toBe(0); // due: Claude Code deletes it at its next start
  });

  it('never warns unbookmarked sessions: they are not meant to be kept', () => {
    expect(warn([9, 24], false, 30)).toBeNull();
  });

  it('never warns when Claude Code cleanup is off (null) or not loaded yet', () => {
    expect(warn([9, 24], true, null)).toBeNull();
    expect(warn([9, 24], true, undefined)).toBeNull();
  });
});

describe('row order and grouping', () => {
  const todoOld = session({ ticketKey: 'FA-1', at: [10, 1, 9, 0] });
  const todoNew = session({ ticketKey: 'FA-1', at: [10, 20, 9, 0], branch: 'feature/FA-1-x' });
  const doneNewest = session({ ticketKey: 'FA-1', at: [10, 23, 9, 0], status: 'done' });

  it('orders rows newest first, Done or not', () => {
    expect([todoOld, doneNewest, todoNew].sort(compareRows)).toEqual([
      doneNewest,
      todoNew,
      todoOld,
    ]);
  });

  it('orders Work groups Ops, tickets (newest first), Scratch', () => {
    const scratch = session({ at: [10, 23, 11, 0] });
    const ops = session({ category: 'ops', at: [10, 1, 9, 0] });
    const other = session({ ticketKey: 'FA-2', at: [10, 22, 9, 0], branch: 'feature/FA-2-y' });
    const groups = groupWork([scratch, todoOld, other, ops, todoNew, doneNewest]);
    expect(groups.map((g) => g.id)).toEqual(['ops', 'ticket:FA-1', 'ticket:FA-2', 'scratch']);
    expect(groups[1]!.branch).toBe('feature/FA-1-x');
  });

  it('groups Personal by repo with sessions outside a repo last', () => {
    const a = session({ workspace: 'personal', repo: '/Users/me/o/a', at: [10, 1, 9, 0] });
    const b = session({ workspace: 'personal', repo: '/Users/me/o/b', at: [10, 20, 9, 0] });
    const loose = session({ workspace: 'personal', repo: null, at: [10, 23, 9, 0] });
    expect(groupPersonal([a, loose, b]).map((g) => g.id)).toEqual([
      'repo:/Users/me/o/b',
      'repo:/Users/me/o/a',
      'no-repo',
    ]);
  });
});

describe('counts', () => {
  const list = [
    session({ ticketKey: 'FA-1', at: [10, 23, 9, 0] }),
    session({ ticketKey: 'FA-1', at: [10, 23, 9, 0], status: 'done', bookmarked: true }),
    session({ category: 'ops', at: [10, 23, 9, 0], bookmarked: true }),
    session({ at: [10, 23, 9, 0] }),
  ];

  it('type counts cover everything', () => {
    expect(typeCounts(list)).toEqual({ all: 4, ops: 1, ticket: 2, scratch: 1 });
  });

  it('status counts follow the type filter', () => {
    expect(statusCounts(list, 'all')).toEqual({ all: 4, todo: 3, bookmarked: 2, done: 1 });
    expect(statusCounts(list, 'ticket')).toEqual({ all: 2, todo: 1, bookmarked: 1, done: 1 });
  });
});

describe('search', () => {
  it('matches key and title case-insensitively; Personal also repo and branch', () => {
    const work = session({ ticketKey: 'FA-554', title: 'Promotion rules', at: [10, 23, 9, 0] });
    expect(matchesQuery(work, 'fa-554')).toBe(true);
    expect(matchesQuery(work, 'promotion')).toBe(true);
    expect(matchesQuery(work, 'acme-shop')).toBe(false);
    const personal = session({
      workspace: 'personal',
      repo: '/Users/me/o/claude-dashboard',
      branch: 'feat/list',
      at: [10, 23, 9, 0],
    });
    expect(matchesQuery(personal, 'dashboard', {}, true)).toBe(true);
    expect(matchesQuery(personal, 'feat/', {}, true)).toBe(true);
  });

  it('matches both a dashboard rename and the automatic title it hides', () => {
    const renamed = session({
      title: 'Preorder accordion',
      autoTitle: 'Fix PDP',
      at: [10, 23, 9, 0],
    });
    expect(matchesQuery(renamed, 'preorder')).toBe(true);
    expect(matchesQuery(renamed, 'fix pdp')).toBe(true);
    expect(matchesQuery(renamed, 'checkout')).toBe(false);
  });

  it("matches the Jira title of the session's ticket", () => {
    const work = session({ ticketKey: 'FA-554', title: 'Promotion rules', at: [10, 23, 9, 0] });
    const titles = { 'FA-554': { title: 'Show member discount at checkout', status: 'To Do' } };
    expect(matchesQuery(work, 'member discount', titles)).toBe(true);
    expect(matchesQuery(work, 'member discount')).toBe(false);
    const other = session({ ticketKey: 'FA-540', title: 'Cart', at: [10, 23, 9, 0] });
    expect(matchesQuery(other, 'member discount', titles)).toBe(false);
  });

  it('labels repos under the home folder as ~/o/<repo>', () => {
    expect(repoLabel('/Users/me/o/claude-dashboard')).toBe('~/o/claude-dashboard');
    expect(repoLabel('/opt/x')).toBe('/opt/x');
  });
});

describe('parseSse', () => {
  it('returns complete event names and keeps the partial tail', () => {
    const { events, rest } = parseSse(
      ': keep-alive\n\nevent: sessions-changed\ndata: {}\n\nevent: sessions-ch',
    );
    expect(events).toEqual(['sessions-changed']);
    expect(rest).toBe('event: sessions-ch');
  });

  it('handles CRLF line endings', () => {
    expect(parseSse('event: a\r\ndata: {}\r\n\r\n').events).toEqual(['a']);
  });
});
