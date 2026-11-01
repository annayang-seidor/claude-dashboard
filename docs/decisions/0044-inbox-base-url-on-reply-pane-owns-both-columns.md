# 0044: The Jira base URL rides on the inbox reply; SessionsPane renders both Work columns; FYI shows one row per issue

- Status: Accepted
- Date: 2026-10-24
- Task: T14

## Context
- T14 ports the prototype's "Needs you" column: per item New session or Resume session, plus Open in Jira with the "base URL from config". config.json is read by the server only (`terminal`, `prodEnvs`); the page has no way to see it.
- Choosing New vs Resume needs the Work session list (the most recent To do session for the key, else the most recent). The list, the launch calls and their error toasts live in `SessionsPane`; App renders it inside `<main>` and owns the `cols` wrapper.
- The prototype's FYI joins several keys under one reason ("ACME-613, 621, 623"); the sync gives one reason per issue (ADR 0042).
- The task covers the server and the web UI, more than one area.

## Options
Base URL:
1. **Field on the inbox reply**: optional https `jiraBaseUrl` in config.json, read on each call, returned as `jiraBaseUrl: string | null` by GET /api/jira/inbox and POST sync; the button is a real link.
2. **GET /api/config**: the same key from its own route; one more route and fetch, reusable later.
3. **Server opens the browser**: POST runs `open <url>`; the page never sees the URL, but there is no link to middle-click or copy, and one more spawn.

Sharing the session list:
1. **SessionsPane renders both columns on Work**: one fetch, one events subscription, one toast; App's `cols` and ErrorBoundary move inside.
2. **The inbox fetches on its own**: its own `useSessions('work')`, launch handlers and toast; two fetches per change, toasts can overlap.

FYI rows:
1. **One row per issue**: key + title, then the reason.
2. **Group identical reasons**: like the prototype; model wording rarely repeats exactly.

Split:
1. **T14a server, T14b UI**.
2. **One change**.

## Decision
Chosen by the user on 2026-10-24: option 1 in each.
- `JiraBaseUrl` (src/shared/config.ts): `z.url({ protocol: /^https$/ })`, trailing slashes dropped. It is part of `DashboardConfig` (optional) and of `JiraInboxResponse` (nullable), so the page validates it again before it becomes an `href`. A ticket opens at `<base>/browse/<KEY>`. An invalid value makes readConfig fall back to all defaults, as any invalid key already does.
- The job's snapshot stays without the URL; the routes add it (`ApiDeps.jiraBaseUrl`).
- When the URL is unset, Open in Jira shows disabled, with a tooltip naming the config key.

## Consequences
- A typo in `jiraBaseUrl` also resets `terminal` and `prodEnvs` to their defaults (and logs it).
- Changing config.json shows on the next inbox fetch (on load, on `sessions-changed`, or after a sync); there is no watch on the file.
- T14b moves the Work column layout into SessionsPane.
