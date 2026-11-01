# 0008: Use a legacy summary only when its leaf is in the same file

- Status: Proposed
- Date: 2026-10-24
- Task: T2

## Context
- Title order: custom title → AI title → summary (old format) → first prompt cut to 80 characters, matching `claude --resume` (spike §3).
- Claude Code 2.1.309 still reads `summary` lines keyed by `leafUuid` into a leafUuid → summary map; there are no real `summary` lines on this machine.
- Older versions wrote summaries of *previous* sessions at the top of a new session's file, which is why they are keyed by leaf (unverified, inferred from the leafUuid keying).
- The only fixture summary is synthetic; its `leafUuid` is that file's last assistant message.

## Options
1. **Use the last `summary` line in the file**: simple; risks titling a session with another session's summary.
2. **Use a summary only if its `leafUuid` matches a message uuid in this file**, taking the last match.

## Decision
Option 2.

## Consequences
- Uuids are collected from the lines that were read (head + tail, see 0005), so a summary whose leaf is in the middle of a file is ignored. It is unlikely to matter, since summaries are old format and the leaf is normally the last message.
- A test covers both cases: the fixture summary is used once `ai-title` lines are dropped, and a summary with a foreign `leafUuid` is ignored.
