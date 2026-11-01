# 0041: The Jira login note sits in the header sync slot with a retry button; titles show without status; the page shares one /api/events stream

- Status: Accepted
- Date: 2026-10-24
- Task: T12

## Context
- T12b shows Jira titles (ADR 0039) on Work ticket groups and in search, and must say "Jira login needed — run claude and /mcp" after an auth failure. The prototype shows key + title on ticket groups; it has no Jira status on them and no login state.
- The header has an empty sync slot that T13 fills with "Jira synced N min ago" or an error.
- The titles hook needs `sessions-changed` events, as `useSessions` does. Its own `/api/events` stream would hold a second connection per tab. Browsers allow about 6 HTTP/1.1 connections per host, so three open tabs would use them all. The e2e test for a refused token caught the second stream.

## Options
Login note:
1. **Header sync slot**: one Jira status spot, which T13 extends.
2. **Note above the Work list**: more visible; two places talk about Jira after T13.

Jira status:
1. **Not shown yet**: key + title, as in the prototype; status stays in the API.
2. **In the group meta line**: not in the prototype.

Refresh on demand:
1. **Retry icon button in the login note**: only when it is needed; T13 adds the header Sync button.
2. **Always-visible header icon**: overlaps with T13's Sync button.
3. **None in T12b**.

Events:
1. **One shared stream**: `subscribeEvents()` in src/web/api.ts; the first subscriber opens it, the last to leave closes it.
2. **Piggyback on sessions reloads**: no SSE change, but couples titles to the list, and T13 would need the same trick.
3. **Accept two streams**: one connection more per tab, and one more per later hook.

## Decision
Chosen by the user on 2026-10-24: option 1 in each.
- The note shows on Work only, when `lastRun` is `{ ok: false, reason: 'auth' }`. It has a warning icon and text (`role="status"`); its retry button has aria-label and title "Look up Jira titles again" and POSTs `/api/jira/titles/refresh`. Other failures show nothing until T13.
- Ticket group headings and timeline rows show the Jira title after the key; a key with no cached title shows the key alone. Search also matches the Jira title of a session's ticket.
- Every hook that needs `/api/events` uses `subscribeEvents`, never `followEvents` directly.

## Consequences
- T13 replaces the slot's content with its own status and must keep the login case.
- One page holds one events connection however many hooks listen.
- A failed GET of the titles keeps what is shown and shows no error: titles are extra.
