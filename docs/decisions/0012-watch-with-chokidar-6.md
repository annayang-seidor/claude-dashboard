# 0012: Watch transcripts with chokidar 6; require Node 22.22

- Status: Accepted
- Date: 2026-10-24
- Task: T4

## Context
- The list must update without a reload when transcripts under `~/.claude/projects` change.
- The review's stack names chokidar. It was not installed yet, so this adds a dependency.
- chokidar 6.0.0 needs Node `>= 22.22`; chokidar 4.0.3 supports `>= 14.16`. `package.json` said `node >=20`. This Mac runs Node 22.22.0.

## Options
1. **chokidar ^4.0.3**: keeps `node >=20`; one small dependency (readdirp).
2. **chokidar ^6.0.0**: latest; raises the engine to `>=22.22`.
3. **`fs.watch` with `recursive`**: no dependency; native on macOS, but we write our own filtering and event handling.

## Decision
Option 2, chosen by the user on 2026-10-24. `engines.node` is now `>=22.22`, and docs/review.md says Node 22.22+.

## Consequences
- The launchd plist in T9 must point at a Node 22.22+ binary.
- The watcher sits behind `watchProjects` (`src/server/watch.ts`), so swapping it later touches one file.
