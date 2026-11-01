# 0010: Load state.json once and keep it in memory; one writer

- Status: Accepted
- Date: 2026-10-24
- Task: T3

## Context
- Writes must be atomic, serialised and must not lose updates under concurrent calls.
- One server process serves the API and the page (ADR 0003), so nothing else writes state.json.
- The file is small (one entry per session, plus the last sync results).

## Options
1. **Load once, keep in memory**: reads come from memory. Each mutation runs through an in-process promise queue against the last committed state and writes the whole file (temp file + fsync + rename). Memory changes only after the write succeeds. Hand-edits made while the server runs are overwritten.
2. **Re-read the file per mutation**: picks up hand-edits, but costs a parse per write and can hit the corrupt-file path mid-session.
3. **Cross-process file lock** (e.g. proper-lockfile): needs a new dependency, and is only useful with several writers.

## Decision
Option 1, chosen by the user on 2026-10-24. It is the simplest design that meets the requirements with one process.

## Consequences
- A corrupt or unknown-version file is only detected at startup. It is renamed to `state.json.bak-<ISO time>` and the store starts empty. The store never throws on open.
- Migrations are keyed by the version they upgrade from (`MIGRATIONS`, empty for v1). A migrated file is saved right away.
- Running two servers against the same file would lose updates. Revisit Option 3 if that ever becomes possible.
