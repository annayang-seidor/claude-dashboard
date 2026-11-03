# 0062: Jira is read through the REST API with the user's own Atlassian OAuth app; the login is a mode-600 file; the callback skips the token check behind a one-time state

- Status: Accepted
- Date: 2026-11-03
- Task: Jira OAuth (a: server, b: web, c: jobs)

## Context
- Since Claude Code 2.1.316 (installed 2026-11-01) every `jira-inbox` run has failed. The Rovo search results (141–164 KB) are saved under `~/.claude/projects/<runner folder>/<id>/tool-results/` instead of reaching the model, although the runner sets `MAX_MCP_OUTPUT_TOKENS=60000` (ADR 0042). 2.1.317 saved a 51 KB result too. The model cannot read the file and answers something other than the inbox. Measured from `activity.log` and the saved files; the changelog entry was not checked (unverified).
- 7 of about 75 runs since 2026-10-24 also answered `authRequired` after one tool call, and the next run worked without a new login. The cause was not logged.
- The user has their own Atlassian OAuth 2.0 (3LO) app (client id and secret) and asked to replace the Rovo connection with it.
- The spec said "No stored tokens for Jira" (§ Safety). ADR 0001 requires `X-Dashboard-Token` on every `/api/` request; Atlassian's redirect back is a plain browser GET that cannot carry it.
- Atlassian rotates refresh tokens: each refresh returns a new one and the old one stops working. A refresh token lapses after 90 days unused (unverified for this app).
- Measured 2026-11-03: a login with the callback `http://127.0.0.1:4317/api/jira/oauth/callback` registered on the app succeeds. Atlassian granted exactly the scopes asked for (`offline_access read:jira-user read:jira-work`), though the app also allows write, manage and Confluence scopes; the access token lasts 1 hour.

## Options
Token storage:
1. **File, mode 600**: `~/.claude-dashboard/jira-oauth.json`, like the access token (ADR 0032). Simple, testable on fixtures; readable by any process running as the user.
2. **macOS Keychain**: via `/usr/bin/security` with an argv array. Better at rest, but `add-generic-password -w <token>` puts the token in the process list for a moment, and tests need a fake.

Callback:
1. **One-time state**: only the callback path skips the token header; it must carry a random `state` that a token-checked route issued, used once, within 10 minutes. Host still checked.
2. **Paste the code**: no exemption; a static page shows the code and the user pastes it into the dashboard. One more step on each login.

Classification (task c):
1. **Claude, no tools**: the server sends a compact digest to `claude -p` with every tool denied; Claude decides the bucket and writes the reason.
2. **Plain code**: rules decide the bucket; the reason is a template.

Split:
1. **Three tasks**: (a) server, (b) web, (c) jobs.
2. **One change**.

## Decision
Chosen by the user on 2026-11-03: option 1 in each.
- **App:** `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET` in the repo's `.env` (ignored by git; `.env.example` is committed). It is parsed with `util.parseEnv` and never loaded into `process.env`, so `claude -p` children never inherit the secret. Both blank or no file: Jira OAuth is off. Only one set: the start stops (ADR 0060).
- **Scopes:** `read:jira-work read:jira-user offline_access`. Nothing that writes.
- **Callback URL:** `http://127.0.0.1:4317/api/jira/oauth/callback`, the page's own host, registered on the app exactly.
- **Routes:** `GET /api/jira/oauth/status`, `POST /api/jira/oauth/start` (409 with no app), `POST /api/jira/oauth/disconnect`, all token-checked; `GET /api/jira/oauth/callback`, the one `tokenFreeGets` path in `security()`. It checks the `state` (32 random bytes, at most 5 open, 10 min, removed on first use), answers `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and redirects to `<page origin>/jira-oauth?result=connected|denied|failed`. A connect or disconnect sends `sessions-changed`.
- **Login file:** `{ accessToken, refreshToken, expiresAt, scope, cloudId, site }`, written to a temporary file and renamed, mode 600. The site is the accessible resource whose URL is `jiraBaseUrl`; with no `jiraBaseUrl`, the only one. Refreshed 60 s before expiry, one refresh at a time. A 4xx on refresh deletes the file (connect again); a 5xx keeps it. Logs carry Atlassian's error code, never a token, code or secret.
- **Client:** `POST /rest/api/3/search/jql` paged by `nextPageToken`, and `GET /rest/api/3/myself`, at `api.atlassian.com/ex/jira/<cloudId>`. 30 s timeout per request; a 401 refreshes once and retries; a 429 or 5xx waits (Retry-After, at most 10 s) and retries once. Replies are validated with zod. Errors are `JiraError` with kind `auth`, `timeout` or `failed`, matching the runner's `RunFailure`.

## Consequences
- The spec's "No stored tokens for Jira" no longer holds; § Safety now names the file.
- ADR 0001's "token on every /api/ request" has one exception, the callback.
- Task (c) supersedes the Rovo parts of ADRs 0039, 0040 and 0042: the jobs fetch through the client, and `claude -p` runs with no tools at all. Until then the jobs still use Rovo, and the new routes have no UI except `/jira-oauth` falling back to the app shell.
- An expired or revoked login shows as `auth` straight away instead of a guess from the model.
- Atlassian's own errors are visible as HTTP codes; a passing 429 or 5xx is retried once.
