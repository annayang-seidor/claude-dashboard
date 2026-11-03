import { z } from 'zod';
import { adfText, isoDate } from '../jira/adf';
import type { JiraIssue, JiraMyself } from '../jira/client';

/** What both inbox searches ask Jira for. */
export const INBOX_FIELDS = ['summary', 'status', 'assignee', 'updated', 'comment'] as const;
/** Issues per search, newest first. */
export const SEARCH_MAX = 50;
/** Issues in the digest, newest first; the inbox shows at most this many. */
export const MAX_ISSUES = 30;
/** The newest comments in the window, per issue. */
const COMMENTS_PER_ISSUE = 10;
const COMMENT_CHARS = 500;

/** Issues I own or follow, changed in the last `minutes`. */
export const changedJql = (minutes: number) =>
  `(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -${minutes}m ORDER BY updated DESC`;
/** Issues whose comments may mention me. Also matches comments I wrote (spike § 11). */
export const mentionJql = (days: number) =>
  `comment ~ currentUser() AND updated >= -${days}d ORDER BY updated DESC`;

const User = z.looseObject({ accountId: z.string(), displayName: z.string().default('') });
const Comment = z.looseObject({
  author: User.optional(),
  body: z.unknown(),
  created: z.string(),
  updated: z.string().optional(),
});
const InboxFields = z.looseObject({
  summary: z.string().max(500),
  status: z.looseObject({ name: z.string().max(100) }),
  assignee: User.nullish(),
  updated: z.string(),
  comment: z.looseObject({ comments: z.array(Comment) }).optional(),
});

export interface DigestComment {
  at: string;
  author: string;
  byMe: boolean;
  mentionsMe: boolean;
  text: string;
}

/** One issue as Claude sees it. Title, status, assignee and kind are copied into the inbox from
 * here, never from Claude's answer. */
export interface DigestIssue {
  key: string;
  title: string;
  status: string;
  /** Display name; empty when unassigned. */
  assignee: string;
  kind: 'assigned' | 'mention';
  updated: string;
  /** My latest comment on the issue, in or out of the window. */
  myLastCommentAt: string | null;
  /** Comments in the window, oldest first. */
  comments: DigestComment[];
}

export interface DigestInput {
  changed: readonly JiraIssue[];
  mentioned: readonly JiraIssue[];
  me: JiraMyself;
  changedSince: Date;
  mentionSince: Date;
}

const cut = (text: string) =>
  text.length > COMMENT_CHARS ? `${text.slice(0, COMMENT_CHARS - 1)}…` : text;

/**
 * Both searches merged into one entry per key (ADR 0063). An issue found only by the mention
 * search stays only when a comment in the window by someone else mentions me: an ADF mention of
 * my account id, or the id in the text.
 */
export function buildDigest(input: DigestInput): DigestIssue[] {
  const me = input.me.accountId;
  const found = new Map<string, { issue: JiraIssue; since: number; mentionOnly: boolean }>();
  for (const issue of input.changed) {
    if (!found.has(issue.key)) {
      found.set(issue.key, { issue, since: input.changedSince.getTime(), mentionOnly: false });
    }
  }
  for (const issue of input.mentioned) {
    const seen = found.get(issue.key);
    if (seen) seen.since = Math.min(seen.since, input.mentionSince.getTime());
    else found.set(issue.key, { issue, since: input.mentionSince.getTime(), mentionOnly: true });
  }

  const digest: DigestIssue[] = [];
  for (const { issue, since, mentionOnly } of found.values()) {
    const fields = InboxFields.safeParse(issue.fields);
    if (!fields.success) continue;
    const f = fields.data;
    const comments: DigestComment[] = [];
    let myLastCommentAt: string | null = null;
    for (const raw of f.comment?.comments ?? []) {
      const at = isoDate(raw.updated ?? raw.created);
      const byMe = raw.author?.accountId === me;
      if (byMe && (!myLastCommentAt || Date.parse(at) > Date.parse(myLastCommentAt))) {
        myLastCommentAt = at;
      }
      if (!(Date.parse(at) >= since)) continue;
      const { text, mentions } = adfText(raw.body);
      comments.push({
        at,
        author: raw.author?.displayName ?? 'unknown',
        byMe,
        mentionsMe: mentions.includes(me) || text.includes(me),
        text: cut(text),
      });
    }
    if (mentionOnly && !comments.some((c) => !c.byMe && c.mentionsMe)) continue;
    comments.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    digest.push({
      key: issue.key,
      title: f.summary,
      status: f.status.name,
      assignee: f.assignee?.displayName ?? '',
      kind: f.assignee?.accountId === me ? 'assigned' : 'mention',
      updated: isoDate(f.updated),
      myLastCommentAt,
      comments: comments.slice(-COMMENTS_PER_ISSUE),
    });
  }
  return digest.sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, MAX_ISSUES);
}
