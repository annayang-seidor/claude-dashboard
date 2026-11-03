import { describe, expect, it } from 'vitest';
import { adfText, isoDate } from '../jira/adf';
import type { JiraIssue } from '../jira/client';
import { MAX_ISSUES, buildDigest, changedJql, mentionJql } from './inboxDigest';

const ME = { accountId: 'acc-me', displayName: 'Anna Yang' };
const NOW = Date.parse('2026-11-03T10:00:00Z');
const H = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString().replace('Z', '+0000');

/** A comment body in ADF, optionally mentioning an account. */
const adf = (text: string, mention?: { id: string; text: string }) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        ...(mention
          ? [
              { type: 'mention', attrs: mention },
              { type: 'text', text: ' ' },
            ]
          : []),
        { type: 'text', text },
      ],
    },
  ],
});

const comment = (hoursAgo: number, author: string, body: unknown) => ({
  author: { accountId: author, displayName: author === 'acc-me' ? 'Anna Yang' : 'Sam Rivera' },
  body,
  created: ago(hoursAgo),
});

const issue = (key: string, comments: object[], extra: object = {}): JiraIssue => ({
  id: key,
  key,
  fields: {
    summary: `About ${key}`,
    status: { name: 'To Do' },
    assignee: null,
    updated: ago(1),
    comment: { comments },
    ...extra,
  },
});

const build = (changed: JiraIssue[], mentioned: JiraIssue[] = []) =>
  buildDigest({
    changed,
    mentioned,
    me: ME,
    changedSince: new Date(NOW - 48 * H),
    mentionSince: new Date(NOW - 72 * H),
  });

describe('adfText', () => {
  it('flattens text, turns mentions into @names and collects their ids', () => {
    expect(adfText(adf('can you check?', { id: 'acc-me', text: '@Anna Yang' }))).toEqual({
      text: '@Anna Yang can you check?',
      mentions: ['acc-me'],
    });
    expect(adfText('plain v2 body ')).toEqual({ text: 'plain v2 body', mentions: [] });
    expect(adfText(null)).toEqual({ text: '', mentions: [] });
  });
});

describe('isoDate', () => {
  it("adds the colon Jira's offsets leave out", () => {
    expect(isoDate('2026-10-30T10:39:15.530+0100')).toBe('2026-10-30T10:39:15.530+01:00');
    expect(isoDate('2026-10-30T10:39:15Z')).toBe('2026-10-30T10:39:15Z');
  });
});

describe('JQL', () => {
  it('searches what I own or follow, and comments that may mention me', () => {
    expect(changedJql(2880)).toBe(
      '(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -2880m ORDER BY updated DESC',
    );
    expect(mentionJql(3)).toBe('comment ~ currentUser() AND updated >= -3d ORDER BY updated DESC');
  });
});

describe('buildDigest', () => {
  it('keeps comments in the window, oldest first, and my last comment from before it', () => {
    const [d] = build([
      issue('FA-1', [
        comment(100, 'acc-me', adf('old, mine')),
        comment(2, 'acc-other', adf('newest')),
        comment(30, 'acc-other', adf('older')),
      ]),
    ]);
    expect(d!.comments.map((c) => c.text)).toEqual(['older', 'newest']);
    expect(d!.myLastCommentAt).toBe(isoDate(ago(100)));
    expect(d!.comments[0]).toMatchObject({ author: 'Sam Rivera', byMe: false, mentionsMe: false });
  });

  it('marks kind from the assignee account id and copies Jira fields', () => {
    const [d] = build([
      issue('FA-1', [], { assignee: { accountId: 'acc-me', displayName: 'Anna Yang' } }),
    ]);
    expect(d).toMatchObject({
      key: 'FA-1',
      title: 'About FA-1',
      status: 'To Do',
      assignee: 'Anna Yang',
      kind: 'assigned',
      updated: isoDate(ago(1)),
    });
    expect(build([issue('FA-2', [])])[0]).toMatchObject({ assignee: '', kind: 'mention' });
  });

  it('keeps a mention-search issue only when someone else mentions me in the window', () => {
    const mentioned = [
      issue('M-1', [comment(5, 'acc-other', adf('please look', { id: 'acc-me', text: 'Anna' }))]),
      issue('M-2', [comment(5, 'acc-me', adf('I wrote acc-me myself'))]),
      issue('M-3', [comment(100, 'acc-other', adf('too old', { id: 'acc-me', text: 'Anna' }))]),
      issue('M-4', [comment(5, 'acc-other', adf('mentions someone else', { id: 'x', text: 'X' }))]),
    ];
    const digest = build([], mentioned);
    expect(digest.map((d) => d.key)).toEqual(['M-1']);
    expect(digest[0]!.comments[0]).toMatchObject({ mentionsMe: true, text: '@Anna please look' });
  });

  it('merges an issue both searches found, widening its window to the mention one', () => {
    const both = issue('FA-1', [comment(60, 'acc-other', adf('in the mention window only'))]);
    const digest = build([both], [both]);
    expect(digest).toHaveLength(1);
    expect(digest[0]!.comments).toHaveLength(1);
  });

  it('skips issues without the fields it needs, cuts long text, and caps the issue count', () => {
    const long = 'x'.repeat(600);
    const bad: JiraIssue = { id: 'B-1', key: 'B-1', fields: { summary: 'no status' } };
    const [d] = build([issue('FA-1', [comment(1, 'acc-other', adf(long))]), bad]);
    expect(d!.comments[0]!.text).toHaveLength(500);
    expect(build([bad])).toEqual([]);
    const many = Array.from({ length: MAX_ISSUES + 5 }, (_, i) => issue(`FA-${i + 1}`, []));
    expect(build(many)).toHaveLength(MAX_ISSUES);
  });
});
