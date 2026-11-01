# 0061: Workspaces are a configured list with a kind and one fallback; the page reads its config from GET /api/config

- Status: Proposed
- Date: 2026-11-01
- Task: T17b
- Supersedes (once accepted): the fixed `~/y` → Work, anything else → Personal rule (spec § Amendments, "Workspace"); in ADR 0024, `AUTO_TRASH_DAYS` as the source of the idle days; in ADR 0037, the `autoArchive: { at, work, personal }` record and reply shape; in ADR 0038, `CLEANUP_RANGES` in src/shared/cleanup.ts

## Context
- Before this decision, `~/y` and `~/o` were hard-coded in the indexer, the session service, the header tabs, the Clean up modal and the ticket group meta line. `Workspace` was `z.enum(['work', 'personal'])`.
- Work and Personal are more than paths. Work has the Jira inbox, hac env detection, the ticket row-menu items and Scratch-only auto-archive. Personal groups by repo and auto-archives every idle session (ADR 0024).
- Before this decision, the page imported its constants from src/shared/config.ts at build time and never saw the config (ADR 0044).

## Options
Behaviour per workspace:
1. **`kind: "work" | "personal"`**: each entry reuses one of the two existing behaviours. A third workspace is a copy of one of them.
2. **Feature flags** (`jira`, `hac`, `groupBy`, `archiveScope`): more flexible, but many combinations the UI was never designed for.

Tab labels:
1. **In the config**, as one string or `{ "en", "zh-TW" }`: like a repo name, they are user content.
2. **i18n keys from the id**: a new workspace would need a code change.

How the page gets the config:
1. **`GET /api/config`**: one more token-checked route; the page loads it before the first render.
2. **Injected into index.html**: no extra request, but `pnpm dev` serves the page from Vite, which has no config.

## Decision
Chosen by the user on 2026-11-01: `kind`, labels in the config, and `GET /api/config`.
- **Schema.** `workspaces: [{ id, label, root, kind, fallback?, autoArchiveDays }]`, from 1 to 8 entries.
  - `id` is a lowercase slug, and the page path is `/<id>`.
  - `root` is absolute or starts with `~/`, and `~` expands against the server's home folder.
  - Exactly one entry has `fallback: true`.
  - `autoArchiveDays` replaces `AUTO_TRASH_DAYS`.
- **Default.** Today's two: `work` (`~/y`, kind `work`, 7 days) and `personal` (`~/o`, kind `personal`, 14 days, the fallback).
- **Assignment.** The indexer gives a session the workspace whose root holds its first cwd; the deepest root wins when roots nest. A session under no root goes to the fallback workspace. The workspace is computed on every scan and never stored, so changing a root moves sessions without touching their state, which is keyed by session id.
- **What `kind: "work"` turns on:**
  - the hac env scan;
  - Jira title lookups for those workspaces' tickets;
  - the inbox and sync status on the page;
  - the ticket and env row-menu items;
  - Scratch-only auto-archive.

  New session starts in the first Work-kind root when the ticket has no repo yet (ADR 0026).
- **The page's config.** `GET /api/config` returns `PageConfig`: `workspaces`, `cleanup`, `autoArchive`, `retentionWarnDays` and `undoMs`. `terminal` and the timings stay on the server.
  - The page fetches the config before its first render. If the fetch fails, it falls back to `DEFAULT_PAGE_CONFIG`, so the Vite-only header specs still render.
  - `GET /api/sessions` answers 400 for an id that is not configured.
- **Auto-archive record.** The state.json record becomes `{ at, moved: { <id>: UUID[] } }`, and `GET /api/auto-archive` replies with the same shape. The old `{ at, work, personal }` is read into it, so there is no version bump.
- **Strings.** Search hints, the archive note and the page layout are chosen by `kind`. The document title is `"{workspace} sessions"` with the label. The Clean up ranges are labelled from their day count ("1 week", "3 weeks", "10 days") instead of one i18n key per range.

## Consequences
- More than two tabs work with no code change. The header is sized for two; a long list may wrap at narrow widths (unverified).
- A session's workspace can change after a restart. Its bookmark, status and title stay, but the "auto-archived" Undo note for an older run may belong to a workspace id that no longer exists; such a note simply never shows.
- Default tab labels now live in src/shared/config.ts, not in the i18n files.
- `/work` and `/personal` stay the paths for the default config, so existing links and the launchd setup keep working.
