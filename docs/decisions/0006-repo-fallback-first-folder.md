# 0006: Repo falls back to the first folder under ~/y or ~/o

- Status: Proposed
- Date: 2026-10-24
- Task: T2

## Context
- Sessions are grouped by repo (`~/o/<repo>` on the personal page).
- The T2 rule was: git top-level of the first cwd, else the first folder under `~/o`, which leaves non-git folders under `~/y` with no repo.
- On real data, sessions started in `~/y/acme-shop` had no repo: that folder records `gitBranch: "HEAD"`, and its git repos (e.g. `shop`) are subfolders.

## Options
1. **Fall back under `~/o` only** (original rule): `~/y` non-git sessions have repo null.
2. **Fall back under both `~/y` and `~/o`**: `~/y/acme-shop` sessions group under `~/y/acme-shop`.
3. **No fallback**: repo only when git finds one.

## Decision
Option 2, chosen by the user on 2026-10-23. The same rule for both workspaces is simpler and gives work sessions a useful group.

## Consequences
- A session started at `~/y` or `~/o` itself still has repo null; so does anything outside them (e.g. `~/Downloads`, `/private/tmp`).
- `repo` is an absolute path; the UI shortens it to `~/…`.
- `docs/review.md` (row 6 and the T2 prompt) was updated to match.
