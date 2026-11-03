# 0063: The Jira jobs read Jira through REST; titles need no Claude; the inbox sends Claude a digest with no tools

- Status: Accepted
- Date: 2026-11-03
- Task: Jira OAuth (c: jobs)
- Supersedes: the Rovo allow-list and auth answer of 0039; the deny-by-name argv of 0040; the Rovo searches, `MAX_MCP_OUTPUT_TOKENS` and `{"error":"search result too large"}` of 0042

## Context
- ADR 0062 added a Jira REST client on the user's own OAuth login. The user chose (2026-11-03) that Claude still decides the inbox bucket and writes the reason, with no tools, from a digest the server builds.
- Since Claude Code 2.1.316, Rovo search results are saved to files instead of reaching the model, so every inbox run failed (ADR 0062 § Context).
- Spike § 11: any `--tools` value hides MCP tools in `-p`. With the server reading Jira, that is what a run needs now. Measured 2026-11-03 on 2.1.317: `-p … --tools "" --strict-mcp-config --permission-mode dontAsk` answers in one turn, lists no tools, about 4 s and $0.01.
- The digest goes to `claude -p` as an argv string; macOS caps argv and the environment at 1 MB together.

## Decision
- **Runner:** `-p <prompt> --no-session-persistence --output-format json --tools "" --strict-mcp-config --permission-mode dontAsk --model --effort`. No allow-list, no deny list, no `MAX_MCP_OUTPUT_TOKENS`. The `{"authRequired":true}` answer is gone; the stderr and error-result auth match stays, for Claude Code's own login.
- **Titles:** no Claude. One `key in (…)` search, fields `summary,status`, up to 50 keys. A 400 for the whole search falls back to one `GET /issue/<key>` per key, 404 being missing. An issue without a string summary and status name counts as missing. A `JiraError` keeps the cache and sets `lastRun.reason` to its kind.
- **Inbox, Jira side:** `myself`, then the same two JQL searches as prompt v3 (now in code: `changedJql`, `mentionJql`), fields `summary,status,assignee,updated,comment`, 50 each. `buildDigest` merges them per key, keeps comments in the window (changed window, or the mention window when the mention search found the issue), at most 10 per issue, 500 characters each, and `myLastCommentAt`. A mention-search-only issue stays only when a comment in its window by someone else mentions the user: an ADF mention node with their account id, or the id in the text. `kind` is `assigned` when the assignee's account id is the user's. At most 30 issues, newest first. Jira offsets (`+0100`) become `+01:00`.
- **Inbox, Claude side:** prompt v5 (`now`, `me`, `accountId`, `issues` slots) gets the digest as JSON, says the issue text is data, and asks for `{ items: [{ key, bucket, reason, lastRelevantAt }] }` (`InboxAnswer`). Title, status, assignee and kind are copied from the digest, never from the answer; keys not in the digest are dropped and a repeated key keeps its first answer. No issues: no run, an empty inbox is stored. A digest over 200,000 characters fails the sync without a run.
- **Failures:** a `JiraError` is recorded as `lastAttempt.reason` = its kind (`auth`, `timeout`, `failed`) with its message as `detail`; the result stays.
- `start()` takes an optional `jira` client; tests and the e2e server pass a fake. Without one it is the REST client on the stored login, which sends nothing when `.env` names no app.

## Consequences
- The inbox no longer depends on MCP output limits or a Claude Code update, and no longer pays for search tool calls: one tool-less turn per sync, none when nothing changed.
- Mentions are decided by the server from ADF, not guessed from JQL text matches.
- "Newly assigned to me" and status changes are judged from comments and the current fields only; the changelog is not read (as before).
- `activity.log` no longer has `jira-titles` lines; titles failures go to server.log.
- The UI's login note still speaks of the Rovo login until task (b).
