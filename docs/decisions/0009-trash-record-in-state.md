# 0009: Keep a trash record in state so pruning spares trashed sessions

- Status: Accepted
- Date: 2026-10-24
- Task: T3

## Context
- `pruneOrphans(liveIds)` drops state for sessions that no longer exist. A trashed session is gone from `~/.claude/projects`, but Undo must bring back its status and bookmark, so its entry has to survive until the 7-day purge.
- T8 already has to record `{ originalPath, hadFolder, trashedAt }` in state so Undo knows where to move files back.

## Options
1. **Trash record in state**: each session entry gets an optional `trashed`, and prune keeps entries that have one. The store stays a pure state.json owner. If state.json is lost, files in the trash no longer count as trashed.
2. **Store scans the trash folder**: prune lists `<id>.jsonl` in an injected trash dir. The disk is the truth, but the store gets tied to T8's folder layout and repeats T8's work.
3. **Caller passes trashed ids**: `pruneOrphans(liveIds, trashedIds)`. A simple store, but every caller has to work out the trashed ids, and the signature differs from the task.

## Decision
Option 1, chosen by the user on 2026-10-24. T8 needs the record anyway, and one entry per session keeps purge simple: delete the files, then `remove(id)`.

## Consequences
- `SessionState.trashed` is part of the v1 schema. Undo clears it (`update(id, { trashed: undefined })`).
- Prune never looks at the trash folder. A file put in the trash by hand without a record loses its state on the next prune.
