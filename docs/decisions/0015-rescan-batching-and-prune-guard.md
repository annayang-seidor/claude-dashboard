# 0015: Batch watch events in a 500 ms window; never prune from an unreadable root

- Status: Proposed
- Date: 2026-10-24
- Task: T4

## Context
- The T4 prompt asks for a 500 ms debounce on watch events.
- An active Claude Code session appends to its transcript every few hundred ms while it streams. A trailing debounce would never fire, so new sessions would not show up until every session went quiet.
- `pruneOrphans` runs on startup and after each rescan. If `~/.claude/projects` is missing or unreadable, the indexer lists no sessions, and pruning would wipe every status and bookmark.
- Sub-agent transcripts (`<id>/subagents/*.jsonl`) and the runner's folder never become rows (T2), so changes there need no event.

## Options
1. **Trailing debounce**: matches the prompt literally, but starves while any session writes.
2. **Batch window**: the first change starts a 500 ms timer and later changes join it. At most two rescans a second, and nothing waits more than 500 ms.

## Decision
Option 2. Also:
- The watcher has `depth: 1` (the same `<root>/*/*.jsonl` files the indexer reads), reacts only to `.jsonl` paths, and ignores `<root>/<encoded ~/.claude-dashboard/runner>`. The folder name is encoded by replacing every non-alphanumeric character with `-`. The spike confirms this for `/` and `.`; other characters are unverified, but none appear in the runner path.
- Pruning is skipped, with a log line, when the projects root cannot be accessed.
- A rescan always emits `sessions-changed`, even if nothing visible changed (for example, only `lastActivityAt`).

## Consequences
- A busy session triggers two warm rescans a second. Each costs under 1 ms (ADR 0005).
- A root that exists but is empty still prunes everything. That is correct when every transcript is gone, for example after Claude Code's 30-day cleanup.
