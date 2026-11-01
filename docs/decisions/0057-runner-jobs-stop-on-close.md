# 0057: Closing the server stops the Jira jobs from starting a run or saving a late answer

- Status: Accepted
- Date: 2026-11-01
- Task: fix for the flaky `start.test.ts › looks up the Work ticket keys in the background`

## Context
- `start()` starts a background Jira title lookup without waiting for it (ADR 0039). The lookup lists the Work sessions first, then calls the runner.
- `close()` stopped the daily jobs, the inbox timer, the watcher and the HTTP server, but not that lookup. `jiraInbox.stop()` only cleared its timer, so a tick already reading its prompt file still went on to run.
- So a closed server could still start a `claude -p` and write state.json afterwards. In `start.test.ts` the previous test's late lookup put its prompt into the next test's list: the whole file failed 6 of 10 runs, while the test on its own never failed.

## Options
1. **Test only**: give each test server its own runner and prompt list. Server behaviour unchanged.
2. **Stop flag in both jobs, called from `close()`**: no runner call starts after stop, and an answer that arrives after stop is dropped (no state write, no change event). `close()` does not wait for a run already in flight.
3. **Both.**

## Decision
Option 2, chosen by the user on 2026-11-01.
- `JiraTitles.stop()` is new and final (for shutdown). `JiraInbox.stop()` now also sets the flag, and `start()` clears it.
- Each job checks the flag right before its runner call and again when the answer arrives; the inbox also checks it before recording a broken prompt file.
- `close()` calls `jiraTitles.stop()` next to `jiraInbox.stop()`.

## Consequences
- After `close()` no new `claude -p` starts and state.json gets no Jira write from these jobs.
- A `claude -p` already running is not killed and `close()` does not wait for it (up to 120 s, ADR 0039). In practice the process exits right after `close()`. Killing it would need a cancel path in the runner.
- `refresh()` after `stop()`, forced or not, returns the cached snapshot without running.
