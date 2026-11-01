# 0014: Sessions in the API carry nested state and the effective category

- Status: Accepted
- Date: 2026-10-24
- Task: T4

## Context
- `GET /api/sessions` returns indexer sessions merged with state.json.
- A category is detected automatically but can be overridden (spec: "editable if wrong"). The UI shows the effective category, and the row menu (⋯) needs to know whether it was overridden.

## Options
1. **Nested state + effective category**: `{ ...session, category: override ?? auto, autoCategory, state: { status, bookmarked, categoryOverride? } }`.
2. **Flat fields**: `{ ...session, status, bookmarked, categoryOverride? }`. `category` stays as detected and the UI applies the override itself.

## Decision
Option 1, chosen by the user on 2026-10-24. Schema: `ApiSession` in `src/shared/api.ts`. The list is wrapped as `{ sessions: [...] }`. `PATCH` returns the same `ApiSession`, and `categoryOverride: null` clears the override.

## Consequences
- Grouping and filters in T6 read `category` directly. "Change category" shows `autoCategory` as the reset option.
- Only user-editable state is exposed. `envOverride`, `releaseLabel`, `ticketOverride` and `trashed` stay server-side until a task needs them in `ApiSessionState`.
