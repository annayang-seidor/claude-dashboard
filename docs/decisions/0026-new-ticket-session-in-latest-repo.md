# 0026: A new ticket session starts in the repo of the ticket's latest session

- Status: Accepted
- Date: 2026-10-24
- Task: T7

## Context
- The T7 prompt says to start "New session for this ticket" in "the ~/y repo root". `~/y` is not a repo: it holds about a dozen client repos (acme-shop, eurofred, …).
- Claude Code detects the branch from its launch folder, and the indexer derives workspace and repo from the first cwd.

## Options
1. **Repo of the ticket's latest session**: use the `repo` of the most recent Work session whose effective ticket key matches, falling back to `~/y`. Right for every ticket group that exists today; the Inbox (no session yet) can pass a repo later.
2. **A `workRepo` in config.json**: always the same folder. Predictable, but wrong for tickets in other client repos.
3. **`~/y` itself**: Claude starts outside any git repo, so branch detection and branch-based grouping do not work; the ticket link depends only on `ticketOverride`.

## Decision
Option 1, chosen by the user on 2026-10-24. Implemented in `startTicketSession` in `src/server/sessions/index.ts`.

## Consequences
- A ticket with no session yet, or whose sessions have no repo, starts in `~/y` (still the Work workspace).
- If a ticket spans two repos, the most recently active one wins.
