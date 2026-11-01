import { describe, expect, it } from 'vitest';
import { daysUntilTrash } from '../web/sessions/time';
import {
  autoArchiveRule,
  cutoffForDate,
  cutoffForDays,
  idleSince,
  localDate,
  selectCleanup,
  type CleanupCandidate,
  type CleanupRule,
} from './cleanup';
import { DEFAULT_WORKSPACES, type WorkspaceConfig } from './config';

const [WORK, PERSONAL] = DEFAULT_WORKSPACES as [WorkspaceConfig, WorkspaceConfig];

// Local times throughout, so the calendar-day rules hold in any time zone.
const NOW = new Date(2026, 9, 24, 12, 0);
const at = (month: number, day: number, h = 12, m = 0) =>
  new Date(2026, month - 1, day, h, m).toISOString();

let seq = 0;
function session(
  last: string,
  over: Partial<Omit<CleanupCandidate, 'state'>> & Partial<CleanupCandidate['state']> = {},
): CleanupCandidate {
  const { status = 'todo', bookmarked = false, restoredAt, ...rest } = over;
  return {
    id: `s${++seq}`,
    workspace: 'work',
    category: 'scratch',
    lastActivityAt: last,
    ...rest,
    state: { status, bookmarked, ...(restoredAt && { restoredAt }) },
  };
}

/** The modal's defaults: 2 weeks, keep bookmarked and To do. */
const modal = (over: Partial<CleanupRule> = {}): CleanupRule => ({
  workspace: 'work',
  scratchOnly: false,
  before: cutoffForDays(NOW, 14),
  keepBookmarked: true,
  keepTodo: true,
  sinceRestore: false,
  ...over,
});
const done = { status: 'done' } as const;
const ids = (r: { selected: CleanupCandidate[] }) => r.selected.map((s) => s.id);

describe('cutoffForDays', () => {
  it('is local midnight N calendar days back', () => {
    expect(cutoffForDays(NOW, 14)).toEqual(new Date(2026, 9, 10));
    expect(cutoffForDays(NOW, 0)).toEqual(new Date(2026, 9, 24));
  });

  it('rolls over months and years', () => {
    expect(cutoffForDays(new Date(2026, 2, 3, 9), 14)).toEqual(new Date(2026, 1, 17));
    expect(cutoffForDays(new Date(2027, 0, 5, 9), 90)).toEqual(new Date(2026, 9, 7));
  });
});

describe('cutoffForDate', () => {
  it('is local midnight of the picked day; today is allowed', () => {
    expect(cutoffForDate('2026-10-01', NOW)).toEqual(new Date(2026, 9, 1));
    expect(cutoffForDate('2026-10-24', NOW)).toEqual(new Date(2026, 9, 24));
  });

  it('rejects future dates', () => {
    expect(cutoffForDate('2026-10-25', NOW)).toBeNull();
    expect(cutoffForDate('2027-01-01', NOW)).toBeNull();
  });

  it('rejects malformed and impossible dates', () => {
    for (const bad of ['', '2026-1-5', '2026/10/01', 'yesterday', '2026-02-31', '2026-13-01']) {
      expect(cutoffForDate(bad, NOW), bad).toBeNull();
    }
  });
});

describe('localDate', () => {
  it('pads month and day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('idleSince', () => {
  it('is the later of last activity and restore', () => {
    expect(idleSince(session(at(10, 1)))).toBe(at(10, 1));
    expect(idleSince(session(at(10, 1), { restoredAt: at(10, 20) }))).toBe(at(10, 20));
    expect(idleSince(session(at(10, 20), { restoredAt: at(10, 1) }))).toBe(at(10, 20));
  });
});

describe('selectCleanup', () => {
  it('"older than 2 weeks" means last active 15 or more calendar days ago', () => {
    const lateDay14 = session(at(10, 10, 23, 59), done);
    const earlyDay14 = session(at(10, 10, 0, 0), done);
    const lateDay15 = session(at(10, 9, 23, 59), done);
    const r = selectCleanup([lateDay14, earlyDay14, lateDay15], modal());
    expect(ids(r)).toEqual([lateDay15.id]);
  });

  it('90 days reaches back across months', () => {
    const old = session(at(7, 25), done);
    const notYet = session(at(7, 26), done);
    const r = selectCleanup([old, notYet], modal({ before: cutoffForDays(NOW, 90) }));
    expect(ids(r)).toEqual([old.id]);
  });

  it('a custom date picks sessions last active before that day', () => {
    const before = session(at(9, 30, 23, 59), done);
    const onDay = session(at(10, 1, 0, 0), done);
    const r = selectCleanup([before, onDay], modal({ before: cutoffForDate('2026-10-01', NOW) }));
    expect(ids(r)).toEqual([before.id]);
  });

  it('picks nothing and counts nothing without a valid cutoff', () => {
    const r = selectCleanup([session(at(1, 1), { bookmarked: true })], modal({ before: null }));
    expect(r).toEqual({ selected: [], keptBookmarked: 0, keptTodo: 0 });
  });

  it('stays in its workspace: other sessions are neither picked nor counted', () => {
    const work = session(at(9, 1), done);
    const personal = session(at(9, 1), { ...done, workspace: 'personal' });
    const keptPersonal = session(at(9, 1), { workspace: 'personal', bookmarked: true });
    expect(selectCleanup([work, personal, keptPersonal], modal())).toEqual({
      selected: [work],
      keptBookmarked: 0,
      keptTodo: 0,
    });
    expect(ids(selectCleanup([work, personal], modal({ workspace: 'personal' })))).toEqual([
      personal.id,
    ]);
  });

  it('takes every category unless scratchOnly', () => {
    const list = (['ops', 'ticket', 'scratch'] as const).map((category) =>
      session(at(9, 1), { ...done, category }),
    );
    expect(selectCleanup(list, modal()).selected).toHaveLength(3);
    expect(selectCleanup(list, modal({ scratchOnly: true })).selected).toEqual([list[2]]);
  });

  describe('keep checkboxes', () => {
    const oldTodo = session(at(9, 1));
    const oldDone = session(at(9, 1), done);
    const oldBookmarkedDone = session(at(9, 1), { ...done, bookmarked: true });
    const oldBookmarkedTodo = session(at(9, 1), { bookmarked: true });
    const freshBookmarked = session(at(10, 23), { bookmarked: true });
    const freshTodo = session(at(10, 23));
    const all = [
      oldTodo,
      oldDone,
      oldBookmarkedDone,
      oldBookmarkedTodo,
      freshBookmarked,
      freshTodo,
    ];

    it('both on (default): only old, Done, unbookmarked sessions go', () => {
      expect(selectCleanup(all, modal())).toEqual({
        selected: [oldDone],
        // A bookmarked To do session counts once, as bookmarked; fresh ones are not counted.
        keptBookmarked: 2,
        keptTodo: 1,
      });
    });

    it('Keep bookmarked off: bookmarked To do is kept as To do instead', () => {
      expect(selectCleanup(all, modal({ keepBookmarked: false }))).toEqual({
        selected: [oldDone, oldBookmarkedDone],
        keptBookmarked: 0,
        keptTodo: 2,
      });
    });

    it('Keep To do off: To do goes unless bookmarked', () => {
      expect(selectCleanup(all, modal({ keepTodo: false }))).toEqual({
        selected: [oldTodo, oldDone],
        keptBookmarked: 2,
        keptTodo: 0,
      });
    });

    it('both off: every old session goes', () => {
      expect(selectCleanup(all, modal({ keepBookmarked: false, keepTodo: false }))).toEqual({
        selected: [oldTodo, oldDone, oldBookmarkedDone, oldBookmarkedTodo],
        keptBookmarked: 0,
        keptTodo: 0,
      });
    });
  });

  it('counts from a restore only when sinceRestore is set', () => {
    const restored = session(at(9, 1), { ...done, restoredAt: at(10, 20) });
    expect(ids(selectCleanup([restored], modal()))).toEqual([restored.id]);
    expect(selectCleanup([restored], modal({ sinceRestore: true })).selected).toEqual([]);
  });

  it('keeps input order and objects, and leaves the input alone', () => {
    const list = [session(at(9, 3), done), session(at(9, 1), done), session(at(9, 2), done)];
    const copy = structuredClone(list);
    const r = selectCleanup(list, modal());
    expect(r.selected).toEqual(list);
    expect(r.selected[0]).toBe(list[0]);
    expect(list).toEqual(copy);
  });
});

describe('autoArchiveRule', () => {
  it('Work: Scratch idle over 7 days, bookmarked kept, To do not kept', () => {
    const list = [
      session(at(10, 16, 23, 59)), // 8 days: goes, although To do
      session(at(10, 17, 0, 0)), // 7 days: stays
      session(at(10, 1), { bookmarked: true }),
      session(at(10, 1), { category: 'ticket' }),
      session(at(10, 1), { category: 'ops' }),
      session(at(10, 1), { workspace: 'personal' }),
    ];
    expect(selectCleanup(list, autoArchiveRule(WORK, NOW))).toEqual({
      selected: [list[0]],
      keptBookmarked: 1,
      keptTodo: 0,
    });
  });

  it('Personal: every category idle over 14 days, bookmarked kept (ADR 0024)', () => {
    const p = { workspace: 'personal' } as const;
    const list = [
      session(at(10, 9), { ...p, category: 'ticket' }), // 15 days
      session(at(10, 9), { ...p, category: 'scratch' }),
      session(at(10, 10), p), // 14 days: stays
      session(at(10, 1), { ...p, bookmarked: true }),
      session(at(10, 1)), // Work
    ];
    expect(selectCleanup(list, autoArchiveRule(PERSONAL, NOW))).toEqual({
      selected: [list[0], list[1]],
      keptBookmarked: 1,
      keptTodo: 0,
    });
  });

  it('spares a session restored within the limit (ADR 0037)', () => {
    const restored = session(at(9, 1), { restoredAt: at(10, 20) });
    expect(selectCleanup([restored], autoArchiveRule(WORK, NOW)).selected).toEqual([]);
    // Restored Oct 20: Oct 28 is 8 calendar days on.
    const later = new Date(2026, 9, 28, 9);
    expect(selectCleanup([restored], autoArchiveRule(WORK, later)).selected).toEqual([restored]);
  });

  it("agrees with the row's countdown: picked exactly once it is past due", () => {
    for (const ws of [WORK, PERSONAL]) {
      const workspace = ws.id;
      for (let back = 0; back <= 20; back++) {
        for (const hour of [0, 12, 23]) {
          const s = session(at(10, 24 - back, hour), { workspace });
          const picked = selectCleanup([s], autoArchiveRule(ws, NOW)).selected.length === 1;
          const n = daysUntilTrash(s.lastActivityAt, NOW, ws.autoArchiveDays);
          expect(picked, `${workspace} ${back}d ${hour}h`).toBe(n < 0);
        }
      }
    }
  });
});
