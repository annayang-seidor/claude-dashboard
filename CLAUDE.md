# Claude Code Session Dashboard

Local-only dashboard for Claude Code sessions. Spec: docs/spec.md. Spike facts: docs/spike.md (trust it over memory).
Decisions: docs/decisions/ — read before changing security, build or tooling; add an ADR for any decision a later task could undo.
UI source of truth: docs/prototype/*.dc.html — match layout, spacing, colours, copy.

## Commands
- pnpm dev        # server :4317 + vite
- pnpm test       # vitest
- pnpm e2e        # playwright (e2e/); screenshots in e2e/screenshots/
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

## Decisions
- Read docs/decisions/ before planning. Accepted ADRs are binding; do not reopen them.
- If a task needs a technical choice not covered by docs/spec.md or an ADR, stop,
  list 2–3 options with trade-offs, and wait for my pick. Then write the ADR
  (status Accepted) in the same commit as the code.
- Never edit an accepted ADR; supersede it with a new one.
