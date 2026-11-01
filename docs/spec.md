# Claude Code Session Dashboard — Spec

Oct 23, 2026 · @Anna

## Overview

A local browser dashboard that lets a developer find, resume and tidy Claude Code sessions in seconds, and see which Jira tickets need them today. It is built for one developer first (the author), working across a work repo (`~/y`, mostly SAP Commerce / hybris) and personal repos (`~/o`).

**Problem.** Sessions pile up with no link to the ticket or environment they belong to. Finding "the session where I debugged the PRD cronjob" means scrolling `claude --resume` lists. Jira notifications mix real asks with noise.

**Goals**

1. Find any session by ticket key, Jira title, environment or keyword in under 10 seconds.
2. Resume or delete a session in one click.
3. Open the dashboard and see only the Jira items that need action, each with a one-line reason.
4. Keep the session list small with safe, previewed cleanup.

**Success measures (self-tracked, first month)**

- Daily use on work days.
- No session lost that was marked bookmarked or To do by the dashboard's own cleanup.
- Inbox items judged "needs me" are correct most of the time; misses are logged as prompt fixes.

The approved prototype is the source of truth for layout and styling: [Claude Code Session Dashboard prototype](https://claude.ai/artifact/Ue19U3GubVnPHXNkNR8EPt).

## Scope

The MVP covers listing, finding, resuming and cleaning up sessions in both workspaces, plus the Jira inbox for `~/y`.

| Area | MVP | Later | Out of scope |
| --- | --- | --- | --- |
| Sessions | List, group by ticket, timeline view, search, filters, resume, delete with undo | Session summaries ("Next ›") | Editing transcripts |
| Status | Manual To do / Done, bookmark | Done micro-animation | Automatic status changes |
| Cleanup | Previewed bulk cleanup per workspace, Scratch 7-day auto-archive | Bookmark expiry warning | Copying transcripts to protect them |
| Jira | Inbox with reasons + FYI section, Jira titles on ticket groups | Reply drafts inside a session | Posting to Jira from the dashboard |
| GitHub | PR review and check status for the stage dots |  | Merging or commenting from the dashboard |
| Environments | `[S1]`, `[P1]` labels from hac-cli config |  | Running ImpEx, Groovy or deploys from the dashboard |
| Workspaces | `~/y` and `~/o` as separate pages | More workspaces via config | Team or multi-user use |
| Language | Traditional Chinese and English UI |  |  |

## Screens and layout

Two pages, one per workspace, share the same header and footer. Each language has its own copy of both pages.

**Header (left to right):** app icon and title, Jira sync status with a sync icon (`~/y` only), empty space, search bar (max 420 px, `⌘K` hint), workspace tabs `工作 ~/y` / `個人 ~/o`. Search sits before the tabs because it is used more often.

**Work page (`~/y`)**

- Left column: "Needs you" inbox, then a collapsible FYI section.
- Main column: view toggle (By ticket / Timeline), type filters (All, Ops, Ticket, Scratch), status filters (All, To do, Bookmarked, Done), Clean up button, then the session list and a colour legend.
- Footer: "Made with passion by annayang", centred under a divider.

**Personal page (`~/o`)**

- No inbox and no environments.
- Intro line plus Clean up button, then sessions grouped by repo (`~/o/<repo>`) and a Scratch group.
- Same footer.

**Session row (both pages):** title (with environment tag for Ops), time and meta line, optional "Next ›" line, then status select, bookmark, Resume and Delete. Icon buttons are 36 px with a light hover background; Resume has no background by default.

## Session model

Each session has one category (assigned automatically), one manual status, an optional bookmark, and for Ops an environment label.

**Category** — decided at discovery, editable if wrong:

| Category | Rule | Colour | Group shown as |
| --- | --- | --- | --- |
| Ticket | Branch matches `<prefix>/<KEY>-<n>…` (for example `feature/FA-554-member-discount`) | Green `#81B29A` | Ticket key + Jira title |
| Ops | Session tagged with an environment, or started from a release/environment context | Terracotta `#E07A5F` | `[ENV]` + release or environment name |
| Scratch | No ticket key and no environment | Sand `#F2CC8F` | One Scratch group per workspace |

In `~/o`, sessions are grouped by repo instead of ticket; the category rules still apply.

**Status** — fully manual, never changed by the system.

- Values: To do (default) and Done, chosen from a select.
- Done greys the title and hides "Next ›". The row keeps its place in its group (newest activity first).
- Ticket groups show "n/m done" in their meta line.
- The ticket-level stage dots (Spec → Branch → Coding → PR → Review) are separate and automatic; they describe the ticket, not the session.

**Bookmark** — a toggle independent of status (a session can be Done and bookmarked).

- Off: outline bookmark icon. On: filled `#F2CC8F` with a `#B07D2B` outline.
- Protects the session from the dashboard's own cleanup only. Claude Code's `cleanupPeriodDays` can still delete it, and the dashboard does not copy transcripts.

**Title** — each session shows one display title, taken from the first source that exists: dashboard rename → Claude Code's last `custom-title` (`/rename` or `--name`) → last `ai-title` → `summary` (old format) → first user prompt (80 chars). Everything after the dashboard rename is the *automatic title*.

- The most recent rename wins, whether made in the dashboard or in Claude Code.
  - On a dashboard rename, the state file stores the new title and a snapshot of Claude Code's current `custom-title` (or empty).
  - On each scan, if Claude Code's latest `custom-title` differs from the snapshot, it was renamed in Claude Code since: show Claude Code's title and remove the dashboard rename.
  - Only `custom-title` changes count; a new `ai-title` never replaces a user's rename.
  - The scan reads the last `custom-title` record anywhere in the file, not only the file's tail.
- A dashboard rename wins until the next `/rename` in Claude Code. Clearing the dashboard rename brings the automatic title back.
- The dashboard never writes to Claude Code's session files; it only reads these records.
- Search matches both the display title and the automatic title. The automatic title is not shown in the row; it appears only in the rename hint.

**Environment label** — shown as a bracket tag before Ops group and session titles, for example `[S1] CCv2 staging environment` and `[P1] 2026.10 go-live`.

- Names come from the project's hac-cli `.toml` (see Data sources).
- A name matching `P` + digits or starting with `Prod` (case-insensitive) is production: bold terracotta text on a light terracotta tag. Other environments use a neutral beige tag.

## Feature specs

### Inbox (`~/y` only)

- Shows items classified as needs-action by the Jira sync job, newest relevant activity first, with a count badge.
- Each item: kind icon (assigned, mention, PR fixes), meta line, ticket key + title, a one-line reason (for example "PM asked after your last comment"), and actions.
- Actions: **New session** (no session yet for the ticket) or **Resume session** (one exists), plus **Open in Jira**. No action posts anything.
- FYI section: collapsed by default, header shows the count, each row shows the ticket keys and why no action is needed.
- Sync status in the header shows the last successful sync time. On a failed or invalid sync, the last good result stays and an error note appears.

### Session list

- **By ticket:** collapsible groups. Ops first, then tickets, then Scratch. Search results expand all groups.
- **Timeline:** rows grouped by Today, Yesterday, Earlier this week, Older; each row shows the group's key or `[ENV]` tag.
- Within a group: To do rows first, then Done.
- Ticket groups show branch name and a "New session for this ticket" action (see New session for this ticket).

### Search and filters

- Search matches ticket key, Jira title, environment name, session title and "Next" text, case-insensitive, as you type.
- Type filter and status filter combine (for example Ticket + To do). Counts on each chip reflect the current type filter.
- Empty result shows a hint to try a ticket number or a title word.

### Resume

- Opens the configured terminal running `claude --resume <session-id>` in the directory the session was started in. Resume keeps the same session ID, so status and bookmark carry over.
- Supported terminals (config key `terminal`, set per machine in the home config; ADR 0058, ADR 0059):
  - **iTerm2** (`iterm`, the default): a new tab in the current window, or a new window if it has none. If it isn't running, it is launched and its first window is used.
  - **Terminal.app** (`terminal`): always a new window, because a tab would need keystrokes (Accessibility). If it isn't running, it is launched and its first window is used, so no extra empty window is left.
  - If the configured app is not installed (in `/Applications`, `~/Applications` or `/System/Applications/Utilities`), nothing is launched and an error shows. Directories with control characters are refused the same way.
- If the session file no longer exists, show an error and remove the row.

### New session for this ticket

- Opens the configured terminal (as for Resume) running `claude --session-id <new uuid> [--name <name>] "Let's work on Jira ticket <KEY>."` in the repo of the ticket's latest session, else the first Work-kind workspace root (ADR 0026, ADR 0061). The session joins the ticket group at once and survives pruning for 24 h until its transcript appears (ADR 0025).
- Clicking the button opens a small form anchored to it (the Change ticket look): **Session name (optional)**, pre-filled with `<KEY> <Jira title>` when the title is cached, else `<KEY>`, with the text selected. Enter or **Start** launches; Esc or **Cancel** closes and returns focus to the button. Start is disabled while the request is in flight; if the terminal cannot be opened, an error toast shows and the form stays open.
- Why a name: every new ticket session starts with the same prompt, so Claude Code's AI title would be the bare key. `--name` writes Claude Code's custom title before the first prompt (spike § 13), so `/resume`, the terminal tab and the dashboard all show it. It is Claude Code's title, not a dashboard rename: `/rename` later replaces it as usual.
- An empty name launches without `--name`. Names are trimmed, at most 120 characters, and may not contain control characters (the line is typed into the terminal, where a newline would run a command).

### Delete

- Single delete: moves the session file, and its `<id>/` folder of sub-agent transcripts and tool output when there is one, to the dashboard trash (`~/.claude-dashboard/trash/`) at once. A toast offers **Undo** for 8 seconds, which moves both back. Trash is purged after 7 days.

### Row menu (⋯)

- Last control in every session row, on both pages, after Delete. Opens a menu anchored to the button.
- Work items: **Rename**, **Copy resume command** (`claude --resume <session-id>`), **Change ticket**, **Set environment**, **Set release label**. Set environment and Set release label are hidden when the session has a ticket key (from its branch or Change ticket).
- Personal items: **Rename**, **Copy resume command**.
- Rare actions go here; frequent ones stay as visible buttons.
- Keyboard: Enter/Space opens, arrow keys move, Esc closes and returns focus to ⋯.

### Rename

- Entry: ⋯ → Rename. Shortcut: double-click the title.
- The title text becomes an input in place, with the text selected. The environment tag stays outside the input and is not editable here.
- Enter or clicking away saves; Esc cancels. Leading and trailing spaces are trimmed; max 120 characters.
- An empty value removes the dashboard rename and shows the automatic title again. A hint under the input says so.
- Saved optimistically. If the state file write fails, revert the title and show an error toast.
- After save or cancel, focus returns to the ⋯ button.
- Accessibility: ⋯ has `aria-label="More actions"`, `aria-haspopup="menu"`, `aria-expanded`; the input has `aria-label="Session title"`.

### Cleanup

- Opened from the Clean up button; scoped to the current workspace.
- Age is measured from last activity, not creation.
- Range options: 1 week, 2 weeks (default), custom date (date picker, no future dates, back to `cleanupPeriodDays` at most; ADR 0038).
- Two checkboxes, both checked by default: keep bookmarked sessions, keep To do sessions.
- Live preview: count and list of sessions to delete, plus how many each checkbox protected.
- Confirm button shows the count; disabled when nothing matches.
- After confirm: same toast + Undo pattern as single delete.
- Scratch auto-archive uses the same routine with fixed settings (7 idle days, bookmarked kept).

## Data sources and integrations

Every UI element reads from one of five sources; the dashboard itself stores only its own state file.

| UI element | Source | How | Refresh |
| --- | --- | --- | --- |
| Session title | Dashboard state file, then `custom-title` / `ai-title` records in the session JSONL | Read locally; renames written to the state file only | On page load + file watch |
| Session list, times, working directory, branch | Claude Code session files under `~/.claude/projects/` | Read locally by the server | On page load + file watch |
| Ticket key | Git branch name | Parse `<prefix>/<KEY>-…` | With session list |
| Jira title, inbox, FYI | Jira via Claude Code (Rovo) in headless mode | Scheduled `claude -p` job returning structured JSON | On open, then every 30–60 min |
| Stage dots, "PR needs fixes" | GitHub (PR state, reviews, checks) | Claude Code or GitHub CLI | With Jira sync |
| Environment labels | hac `~/.hac/projects/*.toml` (ADR 0035) | Read and parse locally | On page load |
| Status, bookmark | Dashboard state file | Local read/write | Instant |

### Jira sync job (structured output is required)

The job asks Claude to find issues assigned to, reported by or watched by the user that changed in the last 2 days, plus issues updated in the past week with a comment mentioning the user, and to classify each one. Output must be a single JSON object:

```json
{
  "syncedAt": "2026-10-23T10:12:00+08:00",
  "items": [
    {
      "key": "ACME-642",
      "title": "PDP gift card",
      "status": "[AM] TO DO",
      "assignee": "…",
      "bucket": "action",
      "kind": "mention",
      "reason": "Two replies after your last comment; likely fixed in PR #876 but not deployed to PRD",
      "lastRelevantAt": "2026-10-23T09:40:00+08:00"
    }
  ]
}
```

- `bucket` is `action` or `fyi`; `kind` is `assigned`, `mention` or `pr`.
- The server validates against a schema. Invalid output → keep the last good result and show a sync error; never render partial data.
- Known limit: the search sees comments, status and the updated timestamp, not description or other field edits.

### Environment config

- Read every hac `~/.hac/projects/<project>.toml` and collect the environment names and gate flags only (for example D1, S1, P1; ADR 0035).
- Production rule: `read_only = true`, or `P` + digits or `Prod…`, case-insensitive. A per-project override in dashboard settings covers other names.

## Local architecture and storage

A small local server does all reading, syncing and file changes; the browser page only renders and sends user actions.

*(Diagram not restored: "local architecture · 4 sources, 1 server, 2 outputs" was lost when this doc was archived.)*

- **State file:** one JSON file in the dashboard's own folder (`~/.claude-dashboard/state.json`), keyed by session ID. It holds status, bookmark, category overrides and the last good Jira/GitHub sync. Nothing is written inside Claude Code's folders. State entries also hold an optional `title` (the dashboard rename).
- **Orphan cleanup:** on startup and after each scan, entries whose session file no longer exists are removed, so the file cannot grow forever.
- **Session deletion:** the server moves the session file (and its `<id>/` folder) to the dashboard trash right away; Undo moves it back; the purge after 7 days deletes it and removes its state entry.
- **Sync jobs:** run in the background on open and on a timer; results replace the cache only after schema validation.

## Safety and permissions

The dashboard reads and opens; it never acts on Jira, GitHub or a cloud environment by itself.

- **No one-click side effects.** Reply, Resume and New session only open a Claude Code session. Posting comments, editing PRs, ImpEx, Groovy and deploys happen inside that session, where each step is confirmed.
- **Production is read-only.** hac-cli enforces this; its maintainer owns the guard (ADR 0033). The dashboard never runs hac commands. The `[P1]` tag is styled to stand out so prod sessions are never mistaken for S1.
- **No stored tokens for Jira.** The Jira sync reuses Claude Code's existing Rovo login. If GitHub needs a token, it lives in the OS keychain, never in the state file or the repo.
- **Local only.** The server binds to `127.0.0.1`, with no remote access.
- **Deletion is reversible for a short time.** Single and bulk deletes both offer Undo before files are removed.
- **Company policy check** before first use at work: running a local server that reads work sessions and Jira data.

## Non-functional requirements

- **Speed:** session list visible within 1 second of opening with cached data; Jira sync runs in the background and never blocks the page.
- **Accessibility:** every icon button has a label and tooltip; status select and bookmark expose their state; colour is never the only signal (tags carry text, Done greys text as well as recolouring the select); visible keyboard focus.
- **Languages:** Traditional Chinese and English, one string table per language; the session and ticket titles stay as written.
- **Design tokens:** palette `#F4F1DE` background, `#3D405B` text and primary actions, `#5E6178` secondary text, `#E07A5F` Ops/prod, `#81B29A` Ticket/done, `#F2CC8F` Scratch/bookmark. Fonts: Noto Sans TC, JetBrains Mono for keys, branches and tags. Icons: Feather.
- **Responsive:** works from a narrow laptop window up; columns stack below about 900 px.

## Release plan

Ship in four thin slices; each one is usable on its own, and the next starts only after a week of daily use.

1. **v0 — Sessions:** both workspaces, list by ticket and timeline, search, filters, status, bookmark, Resume, Delete with Undo, state file with orphan cleanup.
2. **v1 — Context:** Jira titles on ticket groups, environment tags from hac-cli config, previewed Cleanup and Scratch auto-archive.
3. **v2 — Inbox:** scheduled Jira sync with schema validation, Needs you list with reasons, FYI section, sync status in the header.
4. **v3 — PR status:** stage dots and "PR needs fixes" items from GitHub. *(Parked: [ADR 0054](decisions/0054-park-t15-github-pr-status.md).)*

## Amendments (accepted, updated after T0 spike)

Accepted from the review (`CLAUDE.md`). Items marked *spike* were changed or confirmed by `docs/spike.md` on Oct 23.

- **Delete = trash** *(spike)*. Delete moves `<id>.jsonl` and its `<id>/` folder to `~/.claude-dashboard/trash/` at once; Undo moves both back; trash is purged after 7 days. Replaces the 8-second timer.
- **Scratch auto-archive moves to trash too,** keeps bookmarked sessions, and runs at most once a day on server start.
- **Personal has no Scratch** (Oct 24, ADR 0024). Every `~/o` session moves to trash after 14 idle days (bookmarked kept); sessions outside a repo are grouped as "Outside a repo". Work keeps the 7-day Scratch rule.
- **Keep `cleanupPeriodDays` at 30** *(spike: unset, so the default 30 applies)*. The Clean up ranges stay under it: 1 week and 2 weeks, and the custom date stops at the limit (ADR 0038). Bookmarked sessions within 7 days of the limit show a warning.
- **Session title** *(spike)*: custom title → AI title → summary (old format) → first user prompt (80 chars), the same order `claude --resume` uses.
- **Workspace** *(spike)*: the session's first working directory under `~/y` → Work, under `~/o` → Personal, anything else → Personal Scratch. The same directory is used for the repo group and Resume.
- **Configurable workspaces** (Nov 1, T17b, ADR 0061, Proposed): workspaces are a list in the config (`id`, `label`, `root`, `kind`, `autoArchiveDays`), one tab each; the defaults are the two above. A session goes to the workspace whose root holds its first directory (the deepest root wins), anything else → the workspace marked `fallback`. `kind` picks the Work or Personal behaviour. Cleanup ranges, auto-archive ages, trash retention and the Jira schedule are config keys too, read once at start; an invalid file stops the server (ADR 0060).
- **Branch** *(spike)*: a branch recorded as `HEAD` counts as no branch.
- **Ops detection:** env comes from hac commands found in Bash tool calls and hac's JSON replies (ADR 0036), else a manual tag.
- **Language toggle** in the header; one app, one string table per language.
- **Row menu (⋯)** for Change ticket and Set environment (Oct 27: Change ticket replaced Change category, [ADR 0047](decisions/0047-change-ticket-replaces-change-category.md)).
- **Headless runner moves to v1** (Jira titles) and runs with `--no-session-persistence` *(spike)*, so sync runs never appear as sessions. v2 adds classification and the inbox.
- **Mentions cover 3 days, not a week** (Oct 24, T13): the Jira search returns each issue's whole comment history, and a week of it was too large for one tool result ([ADR 0042](decisions/0042-jira-inbox-window-allow-list-sync-state.md)).
- **"Next ›" dropped from v0;** revisit after v2 with a SessionEnd hook.
- **Stage dots hidden until v3.**
- **Security:** Host and Origin checks, an access token kept across restarts (Oct 24, ADR 0032; `--rotate-token` replaces it), UUID validation, no shell-string spawning.
- **Prod guard is out of scope** (Oct 24, ADR 0033): hac-cli's maintainer owns it.

Rejected: searching the first 5 user prompts, and live-session detection.

## Open questions and spike checklist

These need an answer before or during v0; tick them off as the spike confirms them.

- [x] Confirm session files record working directory and git branch, and how to read a session's last-activity time. *(Spike Q2, Q4: yes, both per message; last activity = newest message timestamp.)*
- [x] Confirm `cleanupPeriodDays` and its default; decide whether to raise it now that bookmarks don't protect against it. *(Spike Q6: unset, default 30; decided to keep 30 with bookmark warnings.)*
- [x] Pick how Resume opens a terminal on the user's OS, and test it from a background server process. *(Spike Q9: osascript from a detached Node child works for Terminal and iTerm2; iTerm2 chosen. The new-tab variant is built and tested in T7.)*
- [ ] Run the Jira sync prompt in headless mode with JSON output; measure duration and token use per run; tune the 30–60 min interval. *(Partly: the T12 titles job is measured (about 11 s and $0.08 per run with a warm cache on Sonnet 5.5 at low effort; [ADR 0040](decisions/0040-runner-denies-built-ins-by-name-sonnet-low.md), [spike § 11](spike.md)). The T13 inbox run took 76 s, 25 turns and $0.68 with prompt v1, and 24 s, 6 turns and $0.20 with prompt v3 and a 3-day mention window ([ADR 0042](decisions/0042-jira-inbox-window-allow-list-sync-state.md)); interval set to 45 min on weekdays 09:00–19:00.)*
- [ ] Confirm GitHub access path for PR reviews and checks (Claude Code vs GitHub CLI), and whether SonarQube results appear as PR checks.
- [ ] Share a sample hac-cli `.toml` (secrets removed) to fix the field that holds environment names.
- [x] Decide the Undo window for deletes (proposed: 8 seconds) and whether deleted files go to a dashboard trash instead. *(Decided Oct 23 in the review ([docs/review.md](review.md) #10) and the "Delete = trash" amendment above: files move to the trash at once; the toast offers Undo for 8 s; trash is purged after 7 days. Built in [ADR 0009](decisions/0009-trash-record-in-state.md), [ADR 0027](decisions/0027-trash-order-bulk-routes-purge-scope.md) and [ADR 0031](decisions/0031-daily-jobs-runner.md) (daily purge). No ADR records the choice itself.)*
- [x] How "Next ›" summaries get written (for example a Claude Code hook at session end), or drop them from v0. *(Dropped from v0 in the review ([docs/review.md](review.md), accepted amendments) and the "Next ›" amendment above; revisit after v2 with a SessionEnd hook. No ADR records it.)*
- [ ] How an Ops session is tagged with its environment when it has no branch (prompt keyword, hac-cli command used, or manual tag).
- [ ] Check company policy for a local server reading work sessions and Jira data.
- [ ] Optional setting to sync dashboard renames to Claude Code by appending a `custom-title` record when the session isn't running. The record format is undocumented and has changed between versions, so it stays off by default.
