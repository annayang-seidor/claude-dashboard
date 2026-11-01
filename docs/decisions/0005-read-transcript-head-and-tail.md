# 0005: Read only the head and tail of each transcript

- Status: Superseded by 0055
- Date: 2026-10-24
- Task: T2

## Context
- Real `~/.claude/projects` holds 41 transcripts, 130 MB in total; the largest is 30.8 MB, mostly `api-request-blob` lines.
- The fields the list needs sit at the ends of a file: the first `cwd` and first user prompt are near the top; the last message timestamp, last branch and last `ai-title`/`custom-title` are near the bottom.
- The last lines are usually untimestamped (`cost-state`, `file-history-snapshot`), so a fixed-size tail can miss the last message (spike §4).
- `branchesSeen` and "last custom title" really need the whole file: a branch used only mid-session, or a rename followed by a long session, sits in the middle. In the fixtures, dd025063 switches branch at line 48 of 952 and is still covered by head + tail.
- How often real sessions use a branch only in the middle is unknown (unverified).

## Options
1. **Read every file in full**: complete `branchesSeen` and titles; cold cost grows with total transcript size (130 MB today).
2. **Head + tail**: read forward in 64 KB chunks until the first cwd and prompt are found, then backward from EOF until a chunk holds a timestamped user/assistant line. Fast; may miss middle-only branches and titles.
3. **Head + tail, then read only appended bytes on growth**: complete for sessions seen growing, but more state to keep right; cold scans are still head + tail.

## Decision
Option 2. The dashboard needs the list on screen within 1 second, and the fields that matter most (cwd, last branch, ticket, last activity) are always at the ends. Accepted by the user on 2026-10-23.

## Consequences
- Measured: real data indexes in 35 ms cold and under 1 ms warm; 500 synthetic files in 84 ms cold and 5 ms warm (cache keyed by path + size + mtime).
- `branchesSeen` is best effort: it lists branches from the start and end of the session only.
- If a middle-of-file field becomes important, revisit Option 3 rather than full reads.
