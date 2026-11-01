# 0007: Find the git top-level by walking up for .git

- Status: Proposed
- Date: 2026-10-24
- Task: T2

## Context
- Repo = git top-level of each session's first cwd, computed whenever a transcript is (re)indexed.
- CLAUDE.md requires spawning with argv arrays; spawning is allowed but adds a process per unique cwd.
- Cost of spawning `git rev-parse --show-toplevel` per cwd was not measured (unverified).
- Tests must not touch the real disk, and the fixture cwds point at real paths under `/Users/annayang`.

## Options
1. **Spawn `git rev-parse --show-toplevel`**: exact git semantics; a process per cwd; needs git on PATH.
2. **Walk up from cwd looking for `.git` (folder or file)**: no process; covers normal repos, worktrees and submodules (both use a `.git` file); stops at `~/y` or `~/o`.

## Decision
Option 2, with the lookup injectable (`findRepoRoot`) so tests pass a fake.

## Consequences
- Never searches above `~/y` or `~/o`, so a repo at `~` is ignored on purpose.
- Edge cases where git disagrees, such as `GIT_DIR` or `core.worktree` overrides, are not handled (unverified that any occur here).
- A cwd that no longer exists gets no git top-level, so it falls back to the first-folder rule (0006).
