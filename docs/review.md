# Session Dashboard — Review, Task Plan & Prompts

Oct 23, 2026 · @Anna

Reviews: [Claude Code Session Dashboard — Spec](https://claude.ai/artifact/Ue3fPhsjP7GfdtXQpm2xZf) · UI: [Claude Code Session Dashboard prototype](https://claude.ai/artifact/Ue19U3GubVnPHXNkNR8EPt)

## Review verdict

The spec is ready to build v0 once five blockers are settled; v1–v3 need smaller fixes that can wait. The scope, release slicing and safety stance are strong. The gaps are mostly about how Claude Code actually stores and resumes sessions, and how a localhost server is attacked.

Blockers to settle before the first coding prompt:

1. **Session title source is undefined.** The prototype shows clean titles, but the spec never says where they come from (summary entries, first prompt, or a rename).
2. **Resume may change the session ID.** If `claude --resume` forks into a new session file on your version, status and bookmarks keyed by ID silently disappear after every resume.
3. **`cleanupPeriodDays` defaults to 30 days.** That makes the 90-day cleanup option and any bookmark older than a month meaningless unless you raise it in v0.
4. **Localhost is not private by itself.** Any web page you visit can send requests to `127.0.0.1`. With Delete and Resume (which runs a command) exposed, the server needs Host, Origin and token checks from day one.
5. **Pending delete lives only in the browser.** An 8-second timer that deletes on expiry loses or half-applies deletes if the tab or server dies. Moving files to a dashboard trash right away is simpler and safer, and it also answers the Undo-window question.

The rest of this doc lists the gaps, the prototype mismatches, the spec amendments I suggest, the task plan, and one Claude Code prompt per task. Assumptions: macOS, Node 22.22+, and that you will build it with Claude Code in a fresh repo under `~/o`.

## Spec gaps and technical risks

Severity: **High** blocks v0 or risks data loss; **Med** causes rework in a later slice; **Low** is polish.

| # | Area | Finding | Severity | Suggested fix |
| --- | --- | --- | --- | --- |
| 1 | Session data | Title source undefined. Spike: no `summary` lines exist on 2.1.309; `claude --resume` shows `customTitle ?? aiTitle`. | High | Title = custom title → AI title → summary (old format) → first user prompt cut to 80 chars. |
| 2 | Session data | `gitBranch` and `cwd` are written per message and can change mid-session (spike: up to 16 cwds). No branch is stored as `"HEAD"`, not empty. | Med | Use the first `cwd` (launch folder) for workspace, repo and Resume; use the last branch that isn't `"HEAD"`; keep a list of all branches seen for search. |
| 3 | Session data | Sub-agent transcripts and empty sessions would show as rows. Spike: sub-agents live in `<id>/subagents/`, never in the main file; metadata-only stub files exist. | Med | Index `*/*.jsonl` only (depth 2); skip sessions with no user prompt. |
| 4 | Session data | The Jira sync job runs `claude -p`, which writes its own session files and floods the list. | High | Run with `--no-session-persistence` (spike: writes no file). Also run from `~/.claude-dashboard/runner` and exclude that folder as a backup. |
| 5 | Session data | Sessions whose `cwd` is outside `~/y` and `~/o` (home, `/tmp`) have no workspace. | Med | Put them in Personal → Scratch, or hide behind a setting. Decide once. |
| 6 | Resume | If resume forks a new ID, state is orphaned and then deleted by orphan cleanup. | Resolved | Spike: `--resume <id>` keeps the id and appends to the same file. Only `--fork-session` creates a new id; the dashboard never uses it. |
| 7 | Resume / delete | Deleting or resuming a session that is still running in another terminal causes two writers. | High | Mark rows "live" when the file changed in the last 2 min or a `claude` process holds it; block delete, warn on resume. |
| 8 | Retention | `cleanupPeriodDays` (default 30) deletes transcripts at Claude Code startup, bookmarks or not. | High | v0 task sets it to 365 in `~/.claude/settings.json`; never 0. Show a warning badge on bookmarks older than the limit minus 7 days. |
| 9 | Security | No CSRF / DNS-rebinding protection; Resume spawns a process. | High | Check `Host` is `127.0.0.1:<port>`, reject foreign `Origin`, require a per-launch token, validate session IDs as UUIDs, never pass paths through a shell string. |
| 10 | Delete | Timer-based delete is not crash-safe; auto-archive has no human to press Undo. | High | Delete = move to `~/.claude-dashboard/trash/` now; Undo = move back; purge trash after 7 days. |
| 11 | Ops tagging | "Started from a release/environment context" is not computable. Release groups (REL, 2026.10 go-live) have no data source. | Med | Detect env from hac-cli commands in the transcript's Bash tool calls; release name is a manual tag in v1. |
| 12 | New session | A new session for a ticket without a branch (ACME-786) lands in Scratch. | Med | Launch with `--session-id <uuid>` (spike: confirmed) and pre-write the ticket link to state. |
| 13 | Jira titles | v1 needs Jira titles but the Jira runner is planned for v2. | Med | Move the headless runner into v1; v2 adds classification on top. |
| 14 | Jira sync | Headless MCP auth can expire silently; tools need pre-approval; LLM output may invent keys or dates. | Med | Allow only read-only Rovo tools; schema-validate with key regex and ISO dates; show "re-login needed" when the run errors on auth. |
| 15 | Jira sync | Every 30–60 min all day costs tokens and rate limit. | Low | Run only 09:00–19:00 on work days plus a manual Sync button; send last `syncedAt` so the job fetches deltas. |
| 16 | Search | Goal 1 ("the session where I debugged the PRD cronjob") fails if search covers titles only. | Med | Index the first 5 user prompts per session for search; no full transcript search in v0. |
| 17 | Performance | `~/.claude/projects` can hold hundreds of MB; full parse on load breaks the 1-second target. | Med | Cache per file by path + size + mtime; read only head and tail lines; debounce the watcher. |
| 18 | Stage dots | Spec and Coding stages have no rule. | Low | Spec = ticket exists; Branch = branch exists; Coding = commits ahead of base; PR / Review from GitHub in v3. Hide dots until v3. |
| 19 | Prod safety | "Permission settings must deny P1 writes": prefix deny rules on Bash are easy to sidestep. | High (work) | Out of scope here: hac-cli's maintainer owns the prod guard (ADR 0033). The dashboard never runs hac commands. |

Decided since the review: #7 (live sessions) and #16 (prompt search) are not built; #8 keeps `cleanupPeriodDays` at 30 with bookmark warnings instead. See Proposed spec amendments.

## Prototype vs spec mismatches

The prototype matches the spec on layout, tokens, filters, cleanup and toast. These eight differences need a decision so Claude Code does not guess.

| # | Prototype shows | Spec says | Decide |
| --- | --- | --- | --- |
| 1 | One HTML file per language (Main / Main-en) | Two pages × two languages | Build one app with an i18n string table and a language toggle. The spec never places the toggle: add it to the header, right of the workspace tabs. |
| 2 | Stage dots on ticket groups from day one | Stage dots are v3 | Hide dots in v0–v2, or show only the locally known Branch stage. |
| 3 | "PR needs fixes" item with review and SonarQube counts in Needs you | `kind: pr` is in the Jira schema, but GitHub data arrives in v3 | v2 inbox shows only `assigned` and `mention`; `pr` items come from the GitHub job in v3. |
| 4 | REL group "2026.10 go-live" with "involves FA-540, FA-551" | Ops grouped by `[ENV]` + release or env name | Group Ops by environment; release name and linked tickets are a manual label stored in state. |
| 5 | Row labels "Archives in N days" and "Bookmarked, won't be archived" | Not in spec | Add to spec as Scratch row meta. Rename "archive" to "moves to trash" so the word matches the behaviour. |
| 6 | Personal page uses placeholders (Project A, Session summary) | Grouped by repo `~/o/<repo>` | Repo = git top-level of `cwd`; fall back to the first folder under `~/y` or `~/o`. |
| 7 | No control to change a session's category or env | "Editable if wrong" | Add a row overflow menu (⋯) with "Change category" and "Set environment". |
| 8 | `⌘K` hint only | Not specified | Bind ⌘K on macOS and Ctrl+K elsewhere; `/` also focuses search. |

The prototype's Personal page mock data also includes sessions 41 days old, which cannot exist under the default 30-day `cleanupPeriodDays`. With the 30-day limit kept, treat those rows as mock data only.

## Proposed spec amendments

Tick each one you accept, then paste the accepted list into the spec before Task T0 starts. The prompts below already assume all of them.

- [x] **Delete = trash.** Delete moves the transcript to `~/.claude-dashboard/trash/<id>.jsonl` at once, together with its `<id>/` folder (sub-agents, tool output) when there is one; Undo moves both back; trash is purged after 7 days. Replaces the 8-second timer and the open question.
- [x] **Scratch auto-archive moves to trash too,** keeps bookmarked sessions, and runs at most once a day on server start.
- [x] **Keep `cleanupPeriodDays` at 30.** The Clean up range drops the 30-day option (it duplicates Claude Code's own cleanup). Bookmarked sessions within 7 days of the 30-day limit show a warning.
- [x] **Session title rule:** custom title → AI title → summary (old format) → first user prompt (80 chars). Same order as `claude --resume`.
- [x] **Workspace rule:** the session's first `cwd` under `~/y` → Work, under `~/o` → Personal, anything else → Personal Scratch. The same first `cwd` is the repo source and the Resume folder.
- [x] **Ops detection:** env comes from hac-cli commands found in Bash tool calls, else a manual tag.
- [x] **Language toggle** in the header; one app, one string table per language.
- [x] **Row menu (⋯)** for Change category and Set environment.
- [x] **Move the headless runner to v1** (Jira titles); v2 adds classification and the inbox.
- [x] **"Next ›" dropped from v0;** revisit after v2 with a SessionEnd hook.
- [x] **Stage dots hidden until v3.**
- [x] **Security section adds:** Host and Origin checks, per-launch token, UUID validation, no shell-string spawning.
- [x] **Prod guard is out of scope** (Oct 24, ADR 0033): hac-cli's maintainer owns it. The dashboard only reads env names and flags for tags.

Updated after the T0 spike (Oct 23): Delete = trash (adds the `<id>/` folder), Session title rule (adds the AI title, which is where real titles come from), Workspace rule (first `cwd`). Also: `"HEAD"` means no branch, and the headless runner uses `--no-session-persistence`. Details: docs/spike.md.

Rejected: searching the first 5 user prompts (search stays on key, Jira title, env and session title), and live-session detection (no badge, no delete block, no resume warning).

Still open, needs your answer: which terminal Resume should open (Terminal.app, iTerm2, Ghostty, or the VS Code terminal), and a sanitised hac-cli `.toml` sample.

**Decided — terminal:** Resume opens iTerm2. If iTerm2 is running, it opens a new tab in the current window; otherwise it launches iTerm2 in a new window. **Decided — hac-cli config:** environment names are the keys of the `[envs.<name>]` tables (local, d3, s1, p1). Production = `read_only = true`, with the name rule as a fallback. The dashboard reads only names and flags, never url, username or password.

## Working setup

One TypeScript repo, one Node process, one React page: small enough that Claude Code can hold the whole thing in context, and familiar to a frontend lead.

**Stack.** Node 22.22+, Hono (HTTP + SSE), chokidar (file watch), zod (all schemas, shared by server and web), Vite + React + TypeScript, Vitest, Playwright for two smoke tests. No database: `~/.claude-dashboard/state.json` with atomic writes.

**Repo layout** (`~/o/claude-dashboard`):

```
docs/spec.md            # the amended spec, copied from the Doc
docs/prototype/         # Main-en.dc.html, Personal-en.dc.html (+ zh-TW copies)
docs/spike.md           # T0 findings; every later prompt reads it
fixtures/projects/      # sanitised .jsonl samples copied from ~/.claude/projects
src/shared/             # zod schemas + types (Session, State, SyncResult)
src/server/             # indexer, state store, api, launcher, jobs
src/web/                # React app, i18n/, components/
```

**Workflow per task.** One task = one branch = one fresh Claude Code session. Start in plan mode (Shift+Tab), approve the plan, then let it build. Each prompt ends with checks Claude must run (`pnpm test`, `pnpm typecheck`, `pnpm lint`) and a short report. Commit after each task; run `/clear` before the next one so context stays clean. Use `#` to add any repeated correction to CLAUDE.md.

**Permissions for this repo.** Allow `pnpm *`, `git status/diff/add/commit`, and reads under `~/.claude/projects`. Deny `rm -rf`, `git push`, and any write under `~/.claude/` except the trash and settings steps you approve by hand.

**CLAUDE.md** (paste as the repo root file in T1):

```markdown
# Claude Code Session Dashboard

Local-only dashboard for Claude Code sessions. Spec: docs/spec.md. Spike facts: docs/spike.md (trust it over memory).
UI source of truth: docs/prototype/*.dc.html — match layout, spacing, colours, copy.

## Commands
- pnpm dev        # server :4317 + vite
- pnpm test       # vitest
- pnpm typecheck && pnpm lint

## Rules
- Never write inside ~/.claude/ except: moving transcripts (and their <id>/ folders) to/from ~/.claude-dashboard/trash/.
- Tests use fixtures/projects/, never the real ~/.claude.
- All server input validated with zod from src/shared. Session ids must be UUIDs.
- Server binds 127.0.0.1 only; every request checks Host, Origin and the X-Dashboard-Token header.
- Spawn processes with argv arrays, never shell strings.
- UI strings live in src/web/i18n/{zh-TW,en}.json; never hard-code copy.
- Colour is never the only signal (tags carry text). Every icon button has aria-label + title.
- Keep tasks small: if a change needs a new dependency or touches more than one area, stop and ask.
```

## Task breakdown

19 tasks across six slices (Rename was added after v2); v0 is 9 tasks of roughly half a day each with Claude Code. Each task is sized for one session and one PR. T5 (UI shell) can run in parallel with T2–T4 in a second worktree.

| ID | Slice | Task | Depends on | Done when |
| --- | --- | --- | --- | --- |
| T0 | Spike | Investigate session files, resume, retention, terminal launch, headless runs | — | `docs/spike.md` answers all 10 questions with evidence; fixtures copied |
| T1 | v0 | Scaffold repo, CLAUDE.md, secure server skeleton | T0 | `pnpm dev` serves a blank page; security tests pass |
| T2 | v0 | Session indexer (parse, cache, classify) | T1 | Fixture tests cover title, branch, workspace, category, exclusions |
| T3 | v0 | State store + orphan cleanup | T1 | Atomic write, schema version, orphan test |
| T4 | v0 | API + file watch + SSE | T2, T3 | Endpoints validated; new session appears without reload |
| T5 | v0 | UI shell: tokens, i18n, header, tabs, footer | T1 | Matches prototype header at 1440 px and 900 px |
| T6 | v0 | Session list: by ticket, timeline, filters, search, row | T4, T5 | All filter combos and empty state match prototype |
| T7 | v0 | Resume + live detection | T4 | Resume opens the chosen terminal in the right `cwd` |
| T8 | v0 | Delete via trash + Undo toast | T4, T6 | Delete, Undo, purge; live sessions blocked |
| T9 | v0 | Retention warnings + v0 hardening pass | T8 | `cleanupPeriodDays` warnings shown; Playwright smoke passes |
| T10 | v1 | Env config + Ops detection + row menu | T6 | `[S1]`, `[P1]` tags from toml; manual override works |
| T11 | v1 | Cleanup modal + Scratch auto-archive | T8 | Preview counts match; auto-archive once a day |
| T12 | v1 | Headless runner + Jira titles | T4 | Ticket groups show titles; runner sessions hidden |
| T13 | v2 | Jira classification sync + scheduler + sync status | T12 | Invalid output keeps last good result |
| T14 | v2 | Needs you inbox + FYI | T13 | Inbox matches prototype; New/Resume actions work |
| T16a | Rename | Session rename (server): display title, `custom-title` anywhere in the file, rename state | T2, T3, T4 | `/rename` in Claude Code replaces a dashboard rename; a new `ai-title` does not; ADR supersedes 0005 |
| T16b | Rename | Row menu on both pages, Rename in place, Copy resume command | T16a | Rename save/cancel/empty/rollback; Personal rows have the menu |
| T16c | Rename | Optional name for a new ticket session (`--name`) | T7, T12 | Name pre-filled from the Jira title; newline in a name rejected |

After each slice, use it daily for a week as the spec says, and log misses as issues before starting the next slice.

## Claude Code prompts

Paste each prompt into a fresh session in plan mode. Every prompt names its inputs, scope, out-of-scope, acceptance checks and the stop-and-ask points, so Claude does not drift into the next task.

### T0 — Spike (read-only)

```plain
You are investigating how Claude Code stores sessions on this Mac, to de-risk a local session dashboard. Spec: docs/spec.md. This is research, not product code.

Rules: do not modify, move or delete anything under ~/.claude except a throwaway session you create yourself from /tmp/cc-spike. Use read-only commands (ls, head, tail, jq, stat, lsof, claude --help).

Answer each question in docs/spike.md with the evidence (command + trimmed output):
1. Folder and file naming under ~/.claude/projects; one file per session?
2. Every line `type` seen in the 10 most recent files, with counts; which lines carry cwd, gitBranch, timestamp, sessionId, isSidechain, leafUuid; is there a custom-title entry?
3. Where the title shown in `claude --resume` comes from.
4. Last activity: file mtime vs last timestamp line; any drift?
5. Resume: in /tmp/cc-spike run `claude -p "say ok"`, then `claude --resume <id> -p "say ok again"`. Same file appended, or a new session id? Check `claude --help` for --session-id and --fork-session.
6. cleanupPeriodDays: current value in ~/.claude/settings.json and project settings; documented default.
7. Where sub-agent transcripts are stored and how to recognise them.
8. Does `claude -p` create a session file? Any flag to disable that? Shape of `--output-format json`.
9. Open a new Terminal.app (and iTerm2 if installed) window running a command in a given cwd via osascript, launched from a detached Node child process. Show working code.
10. Can we tell a session is running right now (lsof on the .jsonl, or ps)?

Then copy 6 representative sessions (ticket branch, no branch, sidechain-heavy, summary present, multi-branch, outside ~/y and ~/o) to fixtures/projects/, replacing all prompt and response text with lorem ipsum but keeping structure, ids, cwd, gitBranch and timestamps.

End with a table: question → answer → confidence → impact on spec. Stop and ask if any answer contradicts the spec's assumptions.
```

### T1 — Scaffold + secure server skeleton

```text
Read docs/spec.md, docs/spike.md and CLAUDE.md (create CLAUDE.md from the text I paste below if missing).

Set up a pnpm TypeScript repo: Hono server in src/server, Vite + React in src/web, zod schemas in src/shared, Vitest, ESLint, Prettier. `pnpm dev` runs server on 127.0.0.1:4317 and Vite with a proxy.

Security middleware, tested:
- bind 127.0.0.1 only
- reject requests whose Host is not 127.0.0.1:4317 or localhost:4317 (DNS rebinding)
- reject non-GET requests whose Origin is not the dashboard's own
- per-launch random token: server prints the URL with ?t=<token>, web stores it in memory and sends X-Dashboard-Token; missing or wrong → 403
- GET /api/health returns { ok: true }

Out of scope: any session reading. Acceptance: pnpm test, typecheck and lint pass; tests show 403 for a forged Host, forged Origin and missing token. Report the files created.
```

### T2 — Session indexer

```text
Read docs/spike.md first; it is the truth about the transcript format. Build src/server/indexer.

Input: a projects root (default ~/.claude/projects, injectable for tests). Output: Session[] per the zod schema in src/shared/session.ts with id, filePath, cwd, workspace ('work'|'personal'), repo, branch, branchesSeen[], ticketKey, category ('ticket'|'ops'|'scratch'), title, createdAt, lastActivityAt.

Rules:
- title: last custom-title line's customTitle → last ai-title line's aiTitle → summary (old format, keyed by leafUuid) → first user prompt cut to 80 chars
- cwd: the first cwd in the file (the launch folder; cwd changes mid-session). Used for workspace, repo and Resume.
- branch: last gitBranch that isn't "HEAD" ("HEAD" means detached or no git repo → null); branchesSeen[] excludes "HEAD"
- ticketKey: branch matches ^[\w-]+/([A-Z][A-Z0-9]+-\d+)
- workspace: cwd under ~/y → work; under ~/o → personal; else personal (repo null)
- repo: git top-level of cwd if it exists, else first folder under ~/y or ~/o
- category: ticket if ticketKey; else scratch (ops comes in T10)
- lastActivityAt: newest timestamp on a user/assistant line; file mtime only as a fallback (mtime runs ahead by up to hours)
- scan <projects>/*/*.jsonl only (depth 2): sub-agent transcripts live in <id>/subagents/ and must never become rows. Skip files with no user prompt (metadata-only stubs exist) and anything under the runner folder ~/.claude-dashboard/runner. Tolerate unknown line types.
- performance: read the head and the tail of each file. The tail read goes back until it reaches a timestamped user/assistant line, because the last lines are usually untimestamped (cost-state, file-history-snapshot). Cache by path+size+mtime.

Tests use fixtures/projects only. Add a benchmark test: 500 synthetic files index in under 1s warm. Stop and ask if a fixture does not fit these rules.
```

### T3 — State store

```text
Build src/server/state: a store for ~/.claude-dashboard/state.json (path injectable).

Shape (zod, versioned): { version: 1, sessions: { [id]: { status: 'todo'|'done', bookmarked: boolean, categoryOverride?, envOverride?, releaseLabel?, ticketOverride? } }, sync: { jira?: {...}, github?: {...} } }.

Requirements:
- atomic write (temp file + rename), serialised writes, no lost updates under concurrent calls
- corrupt or unknown-version file → back it up as state.json.bak-<ts> and start empty; never crash
- pruneOrphans(liveIds) removes entries whose session no longer exists, but keeps entries for files currently in the trash
- defaults: status todo, bookmarked false

Out of scope: HTTP. Tests: concurrency, corrupt file, migration stub, orphan pruning with trash.
```

### T4 — API + file watch + live updates

```text
Wire indexer (T2) and state (T3) into Hono routes. All bodies validated with zod; ids must be UUIDs.

- GET /api/sessions?workspace=work|personal → sessions merged with state
- PATCH /api/sessions/:id { status?, bookmarked?, categoryOverride? }
- GET /api/events → SSE stream; push 'sessions-changed' when chokidar sees changes under the projects root (debounce 500 ms, ignore the runner folder)
- on startup and after each rescan: state.pruneOrphans

Out of scope: resume, delete, UI. Acceptance: integration tests against fixtures (copy to a temp dir, add a file, expect an SSE event within 2 s). Report the API in a short table in docs/api.md.
```

### T5 — UI shell

```text
Port the shell of docs/prototype/Main-en.dc.html and Personal-en.dc.html into React (src/web). The prototype is the source of truth for spacing, colours, copy and order; its <script> mock data is not.

Build: design tokens as CSS variables (palette, radii, fonts Noto Sans TC + JetBrains Mono, Feather icons via an icon component), header (icon + title, sync-status slot, search box max 420px with ⌘K/Ctrl+K and '/' focus, workspace tabs 工作 ~/y / 個人 ~/o, language toggle 中/EN right of the tabs), footer, two routes (/work, /personal), responsive stacking below 900px.

i18n: src/web/i18n/zh-TW.json and en.json with every string from both prototype languages; default from navigator.language, choice kept in localStorage.

Out of scope: data fetching and the list. Acceptance: side-by-side screenshots (Playwright) of header at 1440px and 880px against the prototype; visible focus rings; every icon button has aria-label and title. List any visual difference you could not match.
```

### T6 — Session list, filters, search

```text
Build the main column of the Work page and the Personal page against GET /api/sessions and /api/events. Match the prototype markup and states exactly.

Work: view toggle (By ticket / Timeline); type chips All/Ops/Ticket/Scratch and status chips All/To do/Bookmarked/Done with counts that follow the type filter; collapsible groups ordered Ops → tickets → Scratch; ticket group shows key, branch, "n/m done", "New session for this ticket" (disabled until T7); Timeline buckets Today/Yesterday/Earlier this week/Older with the group key tag. Within a group: To do first, then Done, then by lastActivityAt desc.
Personal: intro line, groups by repo (~/o/<repo>), Scratch group last.
Row: title (greyed when Done), time + meta, Scratch "moves to trash in N days" / "Bookmarked, kept", status select, bookmark toggle (aria-pressed), Resume and Delete buttons (wired in T7/T8).
Search: case-insensitive, as you type, over ticket key, Jira title (when present), env, title; expands all groups; empty state copy from prototype.
Status and bookmark call PATCH optimistically and roll back on error.

Hide stage dots and "Next ›" (later slices). Tests: filter + search combinations with React Testing Library.
```

### T7 — Resume and New session

```text
Use the launcher approach proven in docs/spike.md (Q9). Terminal app is configurable in ~/.claude-dashboard/config.json; default: iTerm2. If iTerm2 is running, open a new tab in its current window (create a window if it has none); if it is not running, launch it and use its first window. Use iTerm2's AppleScript API (create tab with default profile, then write text "cd <cwd> && claude --resume <id>" with proper quoting).

- POST /api/sessions/:id/resume → open an iTerm2 tab (or window, as above) running `claude --resume <id>` in the session's cwd (the first cwd, as the indexer reports it). Spawn with argv arrays; escape for AppleScript properly; test with a cwd containing spaces and quotes.
- If the file is missing → 410, the UI shows an error toast and drops the row.
- POST /api/tickets/:key/new-session → open an iTerm2 tab the same way in the ~/y repo root running `claude` with a first prompt naming the ticket. Spike Q5 confirmed --session-id: pre-generate the UUID and write ticketOverride to state so the session lands in the ticket group even without a branch.

Out of scope: delete. Acceptance: unit tests on the command builder; one manual check I will do, so print exact steps.
```

### T8 — Delete via trash + Undo

```text
Implement delete as a move, never an unlink:
- POST /api/sessions/:id/trash moves the .jsonl to ~/.claude-dashboard/trash/<id>.jsonl and, if it exists, the sibling <id>/ folder (subagents/, tool-results/) to ~/.claude-dashboard/trash/<id>/; records { originalPath, hadFolder, trashedAt } in state
- POST /api/sessions/:id/restore moves both back (409 if either original path now exists)
- POST /api/trash/purge deletes trash entries (file and folder) older than 7 days; run on startup
- bulk variants accept up to 200 ids and are all-or-report (return per-id results)

UI: Delete removes the row and shows the prototype toast with Undo for 8 s; Undo calls restore. Toast copy from i18n.

Tests: move/restore round trip on a temp copy of fixtures (including a session with an <id>/ folder, e.g. 55e4d22f… with subagents), purge by age, restore conflict.
```

### T9 — Retention + v0 hardening

```text
1. Read cleanupPeriodDays from ~/.claude/settings.json (default 30). Never change it.
2. Row warning on bookmarked sessions whose lastActivityAt is within 7 days of that limit ("Claude Code removes this in N days"), and a one-time note that bookmarks only protect against the dashboard's own cleanup.
3. Hardening: cold-start timing log (target < 1 s to first list with warm cache), error boundary with a retry, SSE reconnect with backoff.
4. Playwright smoke: open /work with fixtures, filter Ticket + To do, search a key, bookmark, delete + undo, switch to /personal and to English.
5. Write README.md: install, start, the launchd plist to auto-start on login (as a file, do not install it).

Report anything in docs/spec.md v0 that is still missing.
```

### T10 — Environments, Ops detection, row menu (v1)

```text
Input: a sanitised hac-cli toml in fixtures/hac-cli/ (fake urls and passwords). Format: top-level ssl_verify, then one [envs.<name>] table per environment (e.g. local, d3, s1, p1) with url, username, password and flags read_only, enable_sql, enable_groovy, allow_sql_commit, allow_groovy_commit, allow_impex_import. Read every ~/.hac/projects/*.toml (ADR 0035) and collect only the table names and those flags. Never log, store or send url, username or password: parse with a TOML library, immediately pick { name, readOnly, allow* } and drop the rest. Add a test that fails if a password value reaches any output.

- isProd(env): read_only = true, OR name matches /^(p\d+|prod)/i, plus a per-project override list in config.json
- Ops detection in the indexer: scan Bash tool_use inputs for hac-cli calls; the most used env wins; category = ops when an env is found and there is no ticketKey
- envOverride, categoryOverride, releaseLabel from state win over detection
- UI: [ENV] tag before Ops group and row titles (prod: bold terracotta on light terracotta; others beige); Ops groups keyed by env, title = releaseLabel or the env's display name; row ⋯ menu with Change category, Set environment, Set release label

Tests: detection on fixtures with hac-cli calls, override precedence, isProd cases.
```

### T11 — Cleanup modal + Scratch auto-archive (v1)

```text
Port the Clean up modal from the prototype (both pages), using the bulk trash API from T8.

- scoped to the current workspace; age from lastActivityAt
- ranges: 2 weeks (default), 90 days, custom date (no future dates)
- checkboxes Keep bookmarked, Keep To do (both on)
- live preview list, "Will delete N", kept counts, confirm button disabled at 0; after confirm, toast with Undo restoring all
- Scratch auto-archive: on server start, at most once per calendar day, trash Scratch sessions idle > 7 days unless bookmarked; log what moved to ~/.claude-dashboard/activity.log; show "N scratch sessions moved to trash · Undo" on next page load

Put the selection logic in one pure function shared by both paths and test it thoroughly.
```

### T12 — Headless runner + Jira titles (v1)

```text
Build src/server/jobs/runner: runs `claude -p` with cwd ~/.claude-dashboard/runner, --no-session-persistence (so runs write no transcript; spike Q8), --output-format json, stdin ignored (otherwise -p waits 3 s for input), a fixed allow-list of read-only Atlassian Rovo MCP tools (read the exact tool names from `claude mcp list` / the tool list, show me before using), a timeout of 120 s, and one run at a time.

Parse the outer JSON, extract the result, validate with a zod schema passed by the caller. On auth errors return { ok: false, reason: 'auth' } so the UI can say "Jira login needed — run claude and /mcp". Never store tokens.

First job: jiraTitles(keys[]) → { key, title, status }[] for ticket keys found in sessions; cache in state for 24 h; refresh on demand. Show titles on ticket groups and in search.

Log duration and token usage per run to activity.log. Tests: mock the child process; schema failure keeps cache.
```

### T13 — Jira sync job (v2)

```text
Add jiraInbox job on the T12 runner. Prompt file: src/server/jobs/prompts/jira-inbox.md (versioned, I will tune it). It asks for issues assigned to / reported by / watched by me changed in the last 2 days, plus issues from the past week with a comment mentioning me, since the last syncedAt; classify each into bucket action|fyi, kind assigned|mention, with a one-line reason.

Schema exactly as docs/spec.md, plus: key matches ^[A-Z][A-Z0-9]+-\d+$, ISO 8601 dates, reason ≤ 140 chars, items ≤ 100. Invalid → keep last good result, record the error.

Scheduler: on server start and every 45 min, only Mon–Fri 09:00–19:00 local; manual Sync button in the header. Header shows "Jira synced N min ago" or the error note. Never block the page. Tests: schedule window, invalid output, stale cache.
```

### T14 — Needs you inbox + FYI (v2)

```text
Port the left column from the prototype: "Needs you" with count badge, items newest lastRelevantAt first, kind icon, meta line, key + title, reason; actions New session (no session for the key) or Resume session (most recent To do session for the key, else most recent), and Open in Jira (base URL from config). FYI section collapsed by default with count. No action posts anything to Jira.

Keyboard: arrow keys move through items, Enter = primary action. Tests: action choice logic, collapsed state, empty and error states.
```

### T16a — Session rename (v2)

```text
Read docs/spec.md (Session model → Title; Feature specs → Rename; Architecture → State file), docs/spike.md, and ADRs 0005, 0010, 0014, 0047.

Goal: a display title per session that follows the spec's "most recent rename wins" rule. Server only; no UI.

0. Before coding, verify in a throwaway session under /tmp/cc-spike: run `claude`, use /rename twice, exit, and show
   that each rename appended a `custom-title` line to the same .jsonl (grep it). Record the result in docs/spike.md.
   Stop and ask if /rename writes anywhere else.
1. Indexer: the last `custom-title` record anywhere in the file, not only head + tail. Approach chosen (Option A):
   keep the head + tail read, and search the bytes in between for `"custom-title"`, parsing only the lines that match;
   cache by path + size + mtime as today. Write an ADR that supersedes 0005 in the same commit, with cold/warm timings
   on real data, the fixtures and the 500-file benchmark (target: list on screen in < 1 s).
2. State (src/shared/state.ts): optional `title` (trimmed, 1–120 chars) and `titleSnapshot` (string | null = Claude
   Code's customTitle at rename time). No version bump if the change is additive; say so if it isn't.
3. API: PATCH /api/sessions/:id accepts `title: string | null`. A string stores title + the current customTitle as
   snapshot; null or empty clears both. ApiSession gets `title` (display) and `autoTitle` (the existing
   custom → ai → summary → prompt rule), like autoTicketKey in ADR 0047.
4. On each rescan, in the same single-writer path as pruneOrphans: if a session has a dashboard title and the current
   customTitle !== titleSnapshot, clear title and titleSnapshot. A new ai-title never triggers this. Never in a GET.
5. Search sources include both title and autoTitle.

Never write to ~/.claude. Tests on fixtures: each title precedence case, a dashboard rename then /rename (append a
custom-title line to a temp copy) → Claude Code's title wins, a new ai-title after a rename → the dashboard title
stays, clearing restores autoTitle, a custom-title in the middle of a large file is found, PATCH validation
(121 chars, whitespace only, non-UUID id). Update docs/api.md. Report the timings.
```

### T16b — Row menu on both pages, Rename, Copy resume command

```text
Read docs/spec.md (Row menu, Rename), ADR 0047 and src/web/sessions/RowMenu.tsx. Needs T16a's `title`/`autoTitle` and PATCH.

1. The ⋯ menu shows on Work and Personal rows. Work items: Rename, Copy resume command, Change ticket, Set environment,
   Set release label. Personal: Rename, Copy resume command. Keep the existing keyboard behaviour; add
   aria-haspopup="menu" and aria-expanded if they are missing.
2. Rename: the title turns into an input in place with the text selected (entry from ⋯ → Rename or a double-click on
   the title). The [ENV] tag stays outside the input. Enter or blur saves, Esc cancels, trim, max 120. The hint under
   the input says an empty value restores "<autoTitle>". Optimistic save; roll back and show an error toast on
   failure. Focus returns to ⋯ after save or cancel. The input has an aria-label from i18n ("Session title").
3. Copy resume command: write `claude --resume <id>` to the clipboard and show a toast. If the clipboard is
   unavailable, show an error toast.
4. Every string goes in both en.json and zh-TW.json. The prototype has no rename mock: reuse the menu--form look from
   Change ticket.

Tests (RTL): open the menu from the keyboard, rename save/cancel/empty/too long, rollback on 500, focus return,
double-click entry, Personal shows only its two items. Extend the Playwright smoke: rename a row, search by the new
title and by the old one. Screenshots in e2e/screenshots/.
```

### T16c — Optional name for a new ticket session

```text
Read docs/spec.md (New session for this ticket), ADRs 0025, 0026, 0039, and src/server/launch/index.ts.
This task touches server and web; that is approved, no need to stop for it.

Why: every new ticket session starts with the same prompt, so Claude Code's AI title is always the bare key.
`claude --name <name>` sets a custom title that /resume, the iTerm2 tab and the dashboard all show.

Before coding, verify in /tmp/cc-spike: `claude --session-id <uuid> --name "test name" "say ok"` writes a
custom-title line to the new .jsonl before or with the first prompt. Record it in docs/spike.md. Stop and ask if it doesn't.

Server:
- POST /api/tickets/:key/new-session accepts an optional body { name?: string }: zod, trimmed, 1–120 chars,
  reject \r, \n and other control characters (the name goes into iTerm2 `write text`; a newline would run a command).
- newSessionArgv(id, key, name?) adds ['--name', name] only when a name is given. Keep the argv array and the
  existing AppleScript quoting; add launcher tests with quotes, backslashes, $(...), emoji and a newline (rejected).

Web:
- Clicking .new-session opens a small form anchored to the button (reuse the menu--form style from Change ticket):
  label "Session name (optional)", pre-filled with "<KEY> <cached Jira title>" or "<KEY>" when no title is cached,
  text selected. Enter or Start launches; Esc or Cancel closes and returns focus to the button. Empty → launch
  without a name, as today.
- All strings in en.json and zh-TW.json. Input has an aria-label; Start is disabled while the request is in flight.

Update docs/spec.md (New session) and docs/api.md. Tests: argv builder, body validation, form pre-fill with and
without a cached title, empty name, Esc focus return. Extend the Playwright smoke with the fake launcher.
```

### T17a — Spike (v3)

```text
Read-only spike: can the dashboard support terminals other than iTerm2 without breaking Resume / New session? Do not change code. Write docs/spike-terminal.md with evidence.

1. Map the current launcher code: where is iTerm2/AppleScript logic, where is the tab-vs-window decision, where is the command string built? Is it behind an interface (a TerminalLauncher port) or mixed into route handlers? List every file that would change.
2. For Terminal.app, Ghostty, Warp, WezTerm, kitty and the VS Code terminal (only those installed; note the rest as untested): how to open a new tab or window running a command in a given cwd, whether "new tab in front window" is possible, and how quoting of the cwd and command works. Show working commands for the installed ones.
3. Propose the port interface (name, methods, capability flags like supportsTab) and the fallback rule when tabs aren't supported.
4. Risks: command injection per terminal, focus behaviour, what happens when the app isn't running.

End with: refactor size (small / medium / large), recommended order, and anything that contradicts the existing ADRs.
```
### T17b: make the dashboard configurable. Plan first; do not change code until I approve (v3)

```text
Read: docs/spec.md, docs/decisions/ (especially ADR 0058 on per-machine vs committed config), src/shared/config.ts, docs/spike-terminal.md.

Step 1 — audit (report, no edits):
- What config exists today: files, keys, schema, defaults, where each is read, and which of T17 is already done.
- Every hard-coded value that should become config: workspace roots (~/y, ~/o), cleanup ranges and default range, keep-bookmarked / keep-todo defaults, Scratch auto-archive age, trash retention, daily-job interval, sync schedule, anything else you find. Give file:line for each.
- For each value, propose: per-machine (home config) or committed default (dashboard.config.json), following ADR 0058. Workspace paths are per-machine.
Stop here and wait for my answers.

Step 2 — after I approve:
- One zod schema in src/shared for both files, with defaults for every key; home values override committed ones.
- Invalid config: fail at startup with a message naming the file, the key and the expected value. No silent fallback.
- Reload on restart only (ADR if you think otherwise).
- Workspaces: a list of { id, label, root }, so more than two is possible; the UI tabs come from it. Paths may start with ~. The "anything else → Personal Scratch" rule becomes "→ the workspace marked as the fallback".
- Cleanup: ranges must not exceed Claude Code's cleanupPeriodDays; warn at startup if one does.
- Ship dashboard.config.example.json documenting every key; README section on configuration.
- Write ADRs for any decision not already covered by ADR 0058 (status Proposed).

Tests: schema defaults, override order, invalid-config errors, a workspace path change re-sorts sessions without losing state (state is keyed by session id), cleanup range validation.

Out of scope: terminal adapters (T18), new UI for editing config (config is edited as a file).
Run pnpm test, typecheck, lint, Playwright smoke. Report per item what changed.
```

### T17c — Terminal adapters: refactor + fixes (builds on T17a spike, ADR 0059) (v3)

```text
Read docs/spike-terminal.md and ADR 0059 (Accepted, binding: do not write a new ADR for the port or fallback rule).
Commits in this order, each with tests passing:

1. Pure refactor: move iTerm2 and Terminal.app into src/server/launch/iterm.ts and terminal-app.ts behind a
   TerminalAdapter with caps { tab, argv, syncResult } and a pure plan(). Launcher.open(cwd, argv), createLauncher's
   options and index.ts's exports keep their shape. No behaviour change: existing tests pass unchanged, plus plan()
   tests per adapter.
2. Fixes:
   - Terminal.app cold start: if not running, wait for its first window (≤ 5 s) and `do script` in window 1, so no
     extra empty window.
   - Before spawning, check the configured app's bundle exists at /Applications, ~/Applications or
     /System/Applications/Utilities; missing → throw → existing 500, never an AppleScript "Where is…" chooser.
     Inject the check through an optional LauncherOptions field so tests never touch the disk.
   - Reject a cwd containing control characters, same as the session-name check.
3. Docs: spec.md Resume and New session (lines 128, 133) say "the configured terminal" (and fix 133's ~/y to the
   first Work-kind workspace root, ADR 0061); list supported terminals and their tab/window behaviour in spec and
   docs/api.md.

Out of scope: WezTerm, kitty, Ghostty adapters (no install to test with); any change to routes, web or i18n.
Run pnpm test, typecheck, lint. Then print manual check steps for me: iTerm2 running / not running, Terminal.app
running / not running, and a configured-but-missing app.

```