import { describe, expect, it } from 'vitest';
import type { JiraInboxItem } from '../../shared/state';
import { session } from '../sessions/fixtures';
import { jiraIssueUrl, primaryAction, splitInbox } from './inboxModel';

const item = (over: Partial<JiraInboxItem>): JiraInboxItem => ({
  key: 'FA-561',
  title: 'Order filters in member center',
  status: 'To Do',
  assignee: 'Anna Yang',
  bucket: 'action',
  kind: 'assigned',
  reason: 'Assigned to you, not started yet',
  lastRelevantAt: '2026-10-23T10:00:00+08:00',
  ...over,
});

describe('splitInbox', () => {
  it('splits by bucket, newest lastRelevantAt first, comparing instants across zones', () => {
    const a = item({ key: 'A-1', lastRelevantAt: '2026-10-23T09:00:00+08:00' });
    // 02:30Z is 10:30 in +08:00: newer than A-1 although its clock reads earlier.
    const b = item({ key: 'B-1', lastRelevantAt: '2026-10-23T02:30:00Z' });
    const c = item({ key: 'C-1', lastRelevantAt: '2026-10-22T18:00:00+08:00' });
    const f1 = item({ key: 'F-1', bucket: 'fyi', lastRelevantAt: '2026-10-21T10:00:00+08:00' });
    const f2 = item({ key: 'F-2', bucket: 'fyi', lastRelevantAt: '2026-10-23T11:00:00+08:00' });
    const { action, fyi } = splitInbox([c, f1, a, f2, b]);
    expect(action.map((i) => i.key)).toEqual(['B-1', 'A-1', 'C-1']);
    expect(fyi.map((i) => i.key)).toEqual(['F-2', 'F-1']);
  });

  it('gives two empty lists for no items', () => {
    expect(splitInbox([])).toEqual({ action: [], fyi: [] });
  });
});

describe('primaryAction', () => {
  it('is New session when no session has the key', () => {
    const other = session({ ticketKey: 'FA-540', at: [10, 23, 9, 0] });
    const scratch = session({ at: [10, 23, 10, 0] });
    expect(primaryAction('FA-561', [other, scratch])).toEqual({ kind: 'new' });
    expect(primaryAction('FA-561', [])).toEqual({ kind: 'new' });
  });

  it('resumes the most recent To do session, even when a Done one is newer', () => {
    const oldTodo = session({ ticketKey: 'FA-554', at: [10, 19, 11, 20] });
    const newTodo = session({ ticketKey: 'FA-554', at: [10, 22, 18, 30] });
    const newestDone = session({ ticketKey: 'FA-554', at: [10, 23, 9, 0], status: 'done' });
    const newerOtherKey = session({ ticketKey: 'FA-540', at: [10, 23, 11, 0] });
    expect(primaryAction('FA-554', [oldTodo, newestDone, newerOtherKey, newTodo])).toEqual({
      kind: 'resume',
      session: newTodo,
    });
  });

  it('resumes the most recent session when every one is Done', () => {
    const older = session({ ticketKey: 'FA-540', at: [10, 15, 11, 30], status: 'done' });
    const newer = session({ ticketKey: 'FA-540', at: [10, 22, 15, 2], status: 'done' });
    expect(primaryAction('FA-540', [older, newer])).toEqual({ kind: 'resume', session: newer });
  });

  it('matches the key exactly, not as a prefix', () => {
    const longer = session({ ticketKey: 'FA-5610', at: [10, 23, 9, 0] });
    expect(primaryAction('FA-561', [longer])).toEqual({ kind: 'new' });
  });
});

describe('jiraIssueUrl', () => {
  it('links to the browse page of the key', () => {
    expect(jiraIssueUrl('https://example.atlassian.net', 'ACME-786')).toBe(
      'https://example.atlassian.net/browse/ACME-786',
    );
  });
});
