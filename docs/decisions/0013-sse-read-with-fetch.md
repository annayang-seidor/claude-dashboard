# 0013: Read /api/events with fetch so the token stays in a header

- Status: Accepted
- Date: 2026-10-24
- Task: T4

## Context
- Every `/api/` request must carry `X-Dashboard-Token` (ADR 0001, CLAUDE.md).
- `EventSource` cannot set request headers, so it cannot call `/api/events` as written.

## Options
1. **fetch-based stream reader**: the page reads the `text/event-stream` body with `fetch` and sends the header like every other call. `security.ts` stays as it is. No built-in reconnect.
2. **`?t=` query token on `/api/events` only**: native `EventSource` with auto-reconnect, but `security.ts` gets a one-route exception, which breaks the header-only rule.

## Decision
Option 1, chosen by the user on 2026-10-24. The server sends standard SSE (`event: sessions-changed`, `data: {}`) plus a `: keep-alive` comment every 25 s. A client could switch to `EventSource` later without server changes, apart from the token check.

## Consequences
- T6 writes the small client parser in `src/web/api.ts` (split on blank lines, read `event:`).
- Reconnect is the client's job: T9's "SSE reconnect with backoff" covers it. After a reconnect the client should refetch the list, because events sent while it was away are lost.
