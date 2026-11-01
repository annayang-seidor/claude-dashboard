# 0033: The hac-cli prod guard is out of scope; hac-cli's maintainer owns it

- Status: Accepted
- Date: 2026-10-24
- Task: Plan (review.md)

## Context
- The review planned task S1: a PreToolUse hook in the `~/y` project that blocks ImpEx import and Groovy execution when hac-cli targets production. T13 depended on it.
- hac-cli already gates writes per environment (`read_only`, `allow_*` flags in its `.toml`; `impex-import` is confirmed). Its maintainer owns the env model, the config format and the command surface.
- A hook written here would have to copy hac-cli's env resolution and subcommand list, and would break silently whenever hac-cli changes.

## Options
1. **Keep S1 here**: the dashboard repo ships a guard that copies hac-cli's internals.
2. **Hand it to hac-cli's maintainer**: the guard lives next to the code it protects; this project sends a request listing the measures.

## Decision
Option 2, chosen by the user on 2026-10-24.
- S1 and its prompt are removed from `docs/review.md`; T13 no longer depends on it.
- The dashboard never runs hac commands. T10 still reads env names and flags (never url, username or password) for `[S1]` / `[P1]` tags.

## Consequences
- Prod safety for Claude Code sessions depends on hac-cli's release, not on this repo.
- If hac-cli moves its config out of `~/y/.claude` (for example to keep secrets out of git), T10's input path changes with it.
