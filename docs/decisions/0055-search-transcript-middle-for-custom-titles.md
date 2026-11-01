# 0055: Read the head and tail of each transcript, and search the bytes between them for custom titles

- Status: Accepted
- Date: 2026-11-01
- Task: T16a
- Supersedes: 0005

## Context
- The spec's title rule needs Claude Code's last `custom-title` record "anywhere in the file, not only the file's tail": a dashboard rename is dropped when that record changes (ADR 0056).
- `/rename` appends a `custom-title` line, then an `agent-name` line, wherever the session is at the time (spike § 12, Claude Code 2.1.316). A rename followed by a long session puts the record in the middle, which ADR 0005's head + tail read never sees.
- `/rename` also overwrites `<id>/custom-title.json` (`{"customTitle":"<latest>"}`). The file is undocumented, and nobody has checked whether `--name` or older sessions have it.
- Real `~/.claude/projects` today: 44 sessions, 101 MB, the largest 7.9 MB. Its 15 custom titles all sit inside head + tail, so this change alters no title on real data yet.

## Options
1. **Head + tail, then search the middle bytes for `"custom-title"`**: a plain byte search over the bytes between the two reads, parsing only lines that contain the marker. Same cache as before (path + size + mtime). Every cold or changed file is read in full.
2. **Read `<id>/custom-title.json` first**, falling back to option 1: cheap for renamed sessions, but it relies on an undocumented file and still needs option 1 when the file is missing.
3. **Head + tail, then read only appended bytes on growth** (ADR 0005 option 3): reads less while a session is active, but needs per-file offsets in the cache and a full read on the first scan anyway.

## Decision
Option 1, chosen by the user on 2026-11-01. Option 2 was declined after the spike: `custom-title.json` is ignored, and the `.jsonl` records are the only source.
- `readTail` returns its lines and the offset where they start. `readMiddle` reads `[headEnd, tailStart)` in 1 MB chunks and applies each matching line that parses as `type: "custom-title"`. Lines are applied in file order (head, then middle, then tail), so the last record wins.
- An escaped `\"custom-title\"` inside a JSON string does not match the marker. A line longer than 64 KB is skipped, not buffered: a title record is about 120 bytes, and buffering a 30 MB `api-request-blob` line would copy it once per chunk.
- `Session` gains `customTitle` (the last record, or null), so the rescan can compare it with the rename's snapshot.

## Consequences
Measured on 2026-11-01 on this machine, the same runs before and after (cold = new indexer, warm = second `index()` call):

| Data | Before (ADR 0005) | After |
|---|---|---|
| Real data: 44 sessions, 101 MB | 77–105 ms cold, 0.7–0.8 ms warm | 124–152 ms cold, 0.7 ms warm |
| Fixtures: 6 sessions, 7.2 MB | 8–25 ms cold, 0.3–0.5 ms warm | 11–30 ms cold, 0.3–0.5 ms warm |
| 500 synthetic files (`indexer.bench.test.ts`) | 108 ms cold, 5 ms warm | 111–114 ms cold, 5 ms warm |
| One growing file, re-indexed after each append | not measured | 8 MB: 4–6 ms; 30 MB: 14–16 ms |

- The list still appears well under the 1 s target. The bench files are about 50 KB each, so the head read covers them whole; the growing-file runs measure the middle search.
- While a session is active, each watch batch re-reads its whole file. That costs about 0.5 ms per MB. Revisit option 3 if transcripts grow far past 30 MB.
- `branchesSeen` is still best effort (head and tail only), as in ADR 0005.
