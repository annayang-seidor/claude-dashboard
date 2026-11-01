# 0023: Load sessions with a hand-rolled hook; optimistic edits sit on top of the server list

- Status: Accepted
- Date: 2026-10-24
- Task: T6

## Context
- The list reads `GET /api/sessions`, refetches on `sessions-changed` from `/api/events` (ADR 0013), and PATCHes status and bookmark optimistically with rollback on error.
- There is one list endpoint and one mutation.

## Options
1. **Hand-rolled hook**: `useSessions(workspace)` in `src/web/sessions/` using `api()` and a fetch-based SSE reader in `src/web/api.ts`. No dependency, about 100 lines; reconnect stays T9's job.
2. **TanStack Query**: built-in cache, refetch and `onMutate`/`onError` rollback, but a runtime dependency and a provider for a single endpoint.

## Decision
Option 1, chosen by the user on 2026-10-24.
- Unsaved edits are kept in a `pending` map and laid over the last server list, so a refetch that lands mid-PATCH does not flash the old value.
- A PATCH success replaces the session with the server's answer; a failure drops the pending edit (the rollback) and sets `saveFailed`, announced through a polite live region.
- Each edit carries a sequence number; only the latest edit for a session clears its pending entry.

## Consequences
- `streamEvents` resolves when the stream ends and does not reconnect. T9 adds backoff and must refetch after reconnecting, because events sent while away are lost.
- If a second list or more mutations arrive (Delete in T8, Resume in T7), revisit whether a query library pays off.
