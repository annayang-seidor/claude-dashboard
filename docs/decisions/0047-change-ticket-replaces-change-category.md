# 0047: Change ticket replaces Change category in the row menu; the API exposes ticketOverride

- Status: Accepted
- Date: 2026-10-27
- Task: v2 manual debug

## Context
- The Work ⋯ menu had "Change category" (Ticket / Ops / Scratch). Picking Ticket for a session with no ticket key only set `categoryOverride`, so the session moved into a "no ticket" ticket group instead of a real one.
- State already has `ticketOverride` (ADR 0025), and `merge` already prefers it over the branch's key, but ADR 0014 kept it out of `ApiSessionState` until a task needed it.

## Options
1. **Change ticket replaces Change category**: a text field takes a key such as ACME-555 and saves `ticketOverride`; empty clears it and the branch's key applies again. Saving also clears an old `categoryOverride`, so the session lands in that ticket group.
2. **Keep both items**: Change ticket next to Change category. More control, but the category item still allows a ticket group with no key.

Menu label: "Change ticket" or "Change branch". The item does not rename or switch the git branch.

## Decision
Option 1 with the label "Change ticket", chosen by the user on 2026-10-27.
- `ApiSessionState` gains `ticketOverride` (a ticket key); `ApiSession` gains `autoTicketKey`, the key detected from the branch, which the form shows as the reset hint.
- `PATCH /api/sessions/:id` accepts `ticketOverride: TicketKey | null`; `null` clears it, like the other overrides. The form trims and upper-cases the input and refuses anything that is not a key.

## Consequences
- The UI can no longer set `categoryOverride`. The API keeps it, so existing overrides still apply until a ticket is saved for that session.
- Sessions started with "New session for this ticket" now show their `ticketOverride` in the list's state, and Change ticket can clear it.
