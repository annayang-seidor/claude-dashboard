import { z } from 'zod';
import { DetectedEnv } from './env';

/** Claude Code session ids are the transcript file names and are always UUIDs. */
export const SessionId = z.uuid();
export type SessionId = z.infer<typeof SessionId>;

/** A Jira key such as FA-554. */
export const TicketKey = z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/);
export type TicketKey = z.infer<typeof TicketKey>;

/** A configured workspace's id (`workspaces[].id` in the config, ADR 0061), e.g. `work`. It is
 * also the page's path: `/work`. */
export const Workspace = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, 'expected a lowercase id such as "work" (a–z, 0–9, -)');
export type Workspace = z.infer<typeof Workspace>;

/** Which of the two page and job behaviours a workspace has (ADR 0061). `work`: Jira, hac envs,
 * tickets, Scratch auto-archive. `personal`: grouped by repo, every idle session auto-archived. */
export const WorkspaceKind = z.enum(['work', 'personal']);
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;

export const Category = z.enum(['ticket', 'ops', 'scratch']);
export type Category = z.infer<typeof Category>;

export const Session = z.object({
  id: SessionId,
  /** Absolute path of `<projects>/<folder>/<id>.jsonl`. */
  filePath: z.string(),
  /** First cwd in the transcript: the launch folder, used for workspace, repo and Resume. */
  cwd: z.string(),
  workspace: Workspace,
  /** Absolute path of the repo folder; null outside every workspace root or when none is found. */
  repo: z.string().nullable(),
  /** Last gitBranch that isn't "HEAD"; null when detached or not a git repo. */
  branch: z.string().nullable(),
  /** Distinct branches in first-seen order, excluding "HEAD". */
  branchesSeen: z.array(z.string()),
  ticketKey: z.string().nullable(),
  /** Most used hac env in a Work session's Bash calls and their replies (ADR 0036). */
  env: DetectedEnv.nullable(),
  category: Category,
  /** custom → ai → summary → first prompt, as `claude --resume` shows it. */
  title: z.string(),
  /** Claude Code's last custom-title record (/rename or --name), anywhere in the file (ADR 0055). */
  customTitle: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
});
export type Session = z.infer<typeof Session>;
