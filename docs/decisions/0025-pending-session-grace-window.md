# 0025: A pre-assigned session id survives pruning for 24 h until its transcript appears

- Status: Accepted
- Date: 2026-10-24
- Task: T7

## Context
- "New session for this ticket" starts `claude --session-id <uuid>` (spike Q5) and writes `ticketOverride` to state, so the session joins the ticket group even when it has no ticket branch.
- The transcript does not exist until Claude Code writes it. Every rescan (each `GET /api/sessions` and each watch batch) prunes state of ids with no transcript (ADR 0009, ADR 0015), so the entry could be dropped before the session starts.
- The server restarts often in dev (`tsx watch`).

## Options
1. **Grace window in state**: an optional `pendingSince` on the entry; pruning spares pending entries younger than 24 h and clears the flag once the transcript is seen. Survives restarts. One optional field, no state version bump.
2. **In memory until the file appears**: the session service holds `{ id → ticketKey }` and writes state on the first rescan that sees the file. No schema change, but a restart in those first seconds loses the ticket link.
3. **Never prune entries with `ticketOverride`**: simplest, but entries for sessions that never started, or that Claude Code later cleaned up, pile up forever.

## Decision
Option 1, chosen by the user on 2026-10-24. `pendingSince` lives in `SessionState` (`src/shared/state.ts`); `PENDING_GRACE_MS` and the pruning rule are in `src/server/state/index.ts`. If the terminal cannot be opened, the entry is removed at once.

## Consequences
- A session that is never started leaves its entry for at most 24 h.
- Once the transcript appears, `pendingSince` is cleared and the entry is pruned like any other when the session goes away.
- `ticketOverride` now takes effect: the API shows it as `ticketKey`, and a Scratch session with an override counts as Ticket (both `category` and `autoCategory`). It stays out of `ApiSessionState` (ADR 0014).
