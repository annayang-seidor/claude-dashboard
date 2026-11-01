# 0011: Store sync payloads opaque until the sync tasks define them

- Status: Accepted
- Date: 2026-10-24
- Task: T3

## Context
- State holds the last good Jira and GitHub sync results (`sync.jira`, `sync.github`).
- The Jira output shape exists only as an example in docs/spec.md, and the headless run has not been measured yet (spec open question). GitHub's shape is not known at all.

## Options
1. **Opaque (`z.unknown()`) until their tasks**: each sync task defines its schema and validates before it calls `setSync`. Nothing to undo later. Until then, the state file does not check this data.
2. **Define Jira now from the spec example**: bad data is caught earlier, but this may need a version bump once the real sync output is known.

## Decision
Option 1, chosen by the user on 2026-10-24.

## Consequences
- The v1 to v2 sync tasks must validate payloads themselves and should tighten `SyncState` in src/shared/state.ts when they land. If the stored shape changes, they must add a migration.
