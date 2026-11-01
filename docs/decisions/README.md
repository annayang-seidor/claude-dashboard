# Decisions

| # | Title | Status | Task |
|---|-------|--------|------|
| [0001](0001-localhost-request-checks.md) | Protect the localhost server with Host, Origin and token checks | Proposed; token lifetime superseded by 0032 | T1 |
| [0002](0002-token-in-url-kept-in-memory.md) | Deliver the token in the URL and keep it in memory | Superseded by 0032 | T1 |
| [0003](0003-one-process-in-production.md) | One process serves API and page in production; Vite only in dev | Proposed | T1 |
| [0004](0004-pin-typescript-6-and-pnpm-10.md) | Pin TypeScript 6.0 and pnpm 10 | Proposed | T1 |
| [0005](0005-read-transcript-head-and-tail.md) | Read only the head and tail of each transcript | Superseded by 0055 | T2 |
| [0006](0006-repo-fallback-first-folder.md) | Repo falls back to the first folder under ~/y or ~/o | Proposed | T2 |
| [0007](0007-git-root-by-walking-up.md) | Find the git top-level by walking up for .git | Proposed | T2 |
| [0008](0008-legacy-summary-own-leaf-only.md) | Use a legacy summary only when its leaf is in the same file | Proposed | T2 |
| [0009](0009-trash-record-in-state.md) | Keep a trash record in state so pruning spares trashed sessions | Accepted | T3 |
| [0010](0010-state-in-memory-single-writer.md) | Load state.json once and keep it in memory; one writer | Accepted | T3 |
| [0011](0011-sync-payloads-opaque-until-defined.md) | Store sync payloads opaque until the sync tasks define them | Accepted | T3 |
| [0012](0012-watch-with-chokidar-6.md) | Watch transcripts with chokidar 6; require Node 22.22 | Accepted | T4 |
| [0013](0013-sse-read-with-fetch.md) | Read /api/events with fetch so the token stays in a header | Accepted | T4 |
| [0014](0014-session-response-shape.md) | Sessions in the API carry nested state and the effective category | Accepted | T4 |
| [0015](0015-rescan-batching-and-prune-guard.md) | Batch watch events in a 500 ms window; never prune from an unreadable root | Proposed | T4 |
| [0016](0016-hand-rolled-router.md) | Route /work and /personal with a hand-rolled History API router | Accepted | T5 |
| [0017](0017-self-hosted-fonts-fontsource.md) | Self-host Noto Sans TC and JetBrains Mono with @fontsource | Superseded by 0020 | T5 |
| [0018](0018-inline-feather-icon-subset.md) | Inline the Feather icons the prototype uses in one Icon component | Accepted | T5 |
| [0019](0019-playwright-for-browser-tests.md) | Add Playwright for browser tests and prototype screenshots | Superseded by 0021 | T5 |
| [0020](0020-fonts-from-google-fonts.md) | Load Noto Sans TC and JetBrains Mono from Google Fonts | Accepted | T5 |
| [0021](0021-prototype-one-file-per-page.md) | Keep the prototype as one file per page; Playwright opens them directly | Accepted | T5 |
| [0022](0022-component-tests-rtl-jsdom.md) | Test components with React Testing Library on jsdom | Accepted | T6 |
| [0023](0023-hand-rolled-sessions-hook.md) | Load sessions with a hand-rolled hook; optimistic edits sit on top of the server list | Accepted | T6 |
| [0024](0024-personal-no-scratch-14-day-trash.md) | Personal has no Scratch; its sessions move to trash after 14 idle days | Accepted | T6 |
| [0025](0025-pending-session-grace-window.md) | A pre-assigned session id survives pruning for 24 h until its transcript appears | Accepted | T7 |
| [0026](0026-new-ticket-session-in-latest-repo.md) | A new ticket session starts in the repo of the ticket's latest session | Accepted | T7 |
| [0027](0027-trash-order-bulk-routes-purge-scope.md) | Trash writes its record before moving; bulk routes sit beside the single ones; purge also clears stray entries | Accepted | T8 |
| [0028](0028-shared-start-and-e2e-fixture-server.md) | One start() for the server; the Playwright smoke runs it on a fixture copy | Accepted | T9 |
| [0029](0029-current-link-in-url-file.md) | Write the current link to ~/.claude-dashboard/url (mode 600) | Superseded by 0032 | T9 |
| [0030](0030-retention-route-and-bookmark-note.md) | Claude Code's cleanupPeriodDays comes from GET /api/retention; the bookmark note shows once per browser | Accepted | T9 |
| [0031](0031-daily-jobs-runner.md) | Daily jobs run on start and every 6 hours, recorded per local day in state.json | Accepted | T9 |
| [0032](0032-token-kept-across-restarts.md) | Keep the token in ~/.claude-dashboard/token across restarts; on a 403 the page stops and asks for the new link | Accepted; 403 fallback superseded by 0048 | T9 |
| [0033](0033-hac-prod-guard-out-of-scope.md) | The hac-cli prod guard is out of scope; hac-cli's maintainer owns it | Accepted | Plan |
| [0034](0034-parse-hac-toml-with-smol-toml.md) | Parse hac's toml with smol-toml | Accepted | T10 |
| [0035](0035-hac-config-from-dot-hac-projects.md) | Read hac envs from ~/.hac/projects/*.toml, names and gate flags only | Accepted | T10 |
| [0036](0036-full-pass-for-hac-env-detection.md) | Work transcripts get a full, incremental pass for hac env detection, reading commands and replies | Accepted | T10 |
| [0037](0037-auto-archive-record-restore-clock-activity-log.md) | Auto-archive records its run in state.json for a once-per-browser Undo note; a restore restarts the idle clock; activity.log is JSON lines | Accepted | T11 |
| [0038](0038-cleanup-ranges-under-claude-cleanup.md) | Clean up offers 1 week and 2 weeks; the custom date stops at Claude Code's cleanupPeriodDays | Accepted | T11 |
| [0039](0039-headless-runner-rovo-allow-list-title-cache.md) | The headless runner allows three read-only Rovo tools; auth is reported by the prompt with a fallback; Jira titles cache per key in state.json | Accepted; tool flag and model superseded by 0040; allow-list extended by 0042 | T12 |
| [0040](0040-runner-denies-built-ins-by-name-sonnet-low.md) | The runner denies built-in tools by name instead of `--tools ""`, fails a run with any denial, and uses Sonnet 5.5 at low effort | Accepted | T12 |
| [0041](0041-jira-login-note-header-one-events-stream.md) | The Jira login note sits in the header sync slot with a retry button; titles show without status; the page shares one /api/events stream | Accepted | T12 |
| [0042](0042-jira-inbox-window-allow-list-sync-state.md) | The Jira inbox widens its window to the last good sync and replaces the result whole; mentions cover 3 days; the runner also allows atlassianUserInfo and raises the MCP result cap; `sync.jira` keeps the result and the last attempt | Accepted | T13 |
| [0043](0043-sync-icon-button-one-login-note-error-age.md) | The header's sync icon is the Sync button; one login note covers titles and inbox; a failed sync keeps the age of the results shown | Accepted | T13 |
| [0044](0044-inbox-base-url-on-reply-pane-owns-both-columns.md) | The Jira base URL rides on the inbox reply; SessionsPane renders both Work columns; FYI shows one row per issue | Accepted; base URL source superseded by 0058 | T14 |
| [0045](0045-clawd-sparkles-icon-icons8-credit.md) | Clawd Sparkles from Icons8 is the logo and favicon; the credit link lives in the footer | Accepted; credit wording superseded by 0051 | — |
| [0046](0046-macos-launcher-app.md) | A macOS launcher app starts the server if needed and opens the link | Superseded by 0049 | — |
| [0047](0047-change-ticket-replaces-change-category.md) | Change ticket replaces Change category in the row menu; the API exposes ticketOverride | Accepted | v2 manual debug |
| [0048](0048-trade-in-previous-token.md) | A tab holding the token from before the last rotation can trade it for the current one; --revoke-token drops it | Accepted | v2 manual debug |
| [0049](0049-dashboard-command-replaces-macos-app.md) | A `dashboard` shell command replaces the macOS launcher app; `dashboard start` rotates the token | Accepted | v2 manual debug |
| [0050](0050-static-cache-headers-asset-404.md) | The app shell is sent with no-cache, hashed assets as immutable, and a missing asset is a 404 | Accepted | v2 manual debug |
| [0051](0051-shorter-icons8-credit.md) | The footer credit shrinks to one "Icon: Icons8" link | Accepted | v2 manual debug |
| [0054](0054-park-t15-github-pr-status.md) | T15 (GitHub PR status) is parked on feature/T15-github-pr-status; v3 waits for a stage rule that fits the team's git flow; 0052–0053 belong to that branch | Accepted | T15 (parked) |
| [0055](0055-search-transcript-middle-for-custom-titles.md) | Read the head and tail of each transcript, and search the bytes between them for custom titles | Accepted | T16a |
| [0056](0056-dashboard-title-snapshot-cleared-on-rescan.md) | A dashboard rename stores a snapshot of Claude Code's custom title; every rescan drops the rename once that title changes | Accepted | T16a |
| [0058](0058-project-config-file-with-local-override.md) | A committed dashboard.config.json holds shared settings; ~/.claude-dashboard/config.json overrides it per key | Accepted | v2 manual debug |
| [0059](0059-terminal-adapters-tab-then-window.md) | Terminals plug in as adapters behind `Launcher`; a tab when the terminal can, else one new window, never keystrokes | Accepted | terminal spike |
| [0060](0060-config-read-once-invalid-fails-start.md) | Config is read once at start; an invalid file stops the server; every key has a default; nested objects merge; prodEnvs dropped; commented .jsonc example | Proposed | T17b |
| [0061](0061-workspace-list-kind-fallback-config-route.md) | Workspaces are a configured list with a kind and one fallback; the page reads its config from GET /api/config | Proposed | T17b |
