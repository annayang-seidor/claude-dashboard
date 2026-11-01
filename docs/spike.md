# Spike: how Claude Code stores sessions (macOS)

Date: 2026-10-23 · Claude Code **2.1.309** · machine TZ UTC+8 (transcript timestamps are UTC `Z`).
Method: read-only commands over `~/.claude`; the only writes were throwaway sessions created from `/tmp/cc-spike`.

Checked against `docs/spec.md` and the accepted amendments / T2–T8 prompts in `CLAUDE.md`. Contradictions are listed at the end.

---

## 1. Folder and file naming; one file per session?

```
$ ls ~/.claude/projects
-private-tmp-claude-501--Users-annayang-y-acme-shop-…-scratchpad
-Users-annayang
-Users-annayang--claude-session-dashboard
-Users-annayang-Downloads-community-mcp
-Users-annayang-o
-Users-annayang-o-fakesmtp-exe-file
-Users-annayang-y-eurofred
-Users-annayang-y-acme-shop

$ ls ~/.claude/projects/-Users-annayang-y-acme-shop | head
053f6f59-c2de-47bb-b934-c20775623c5c/        <- sidecar folder (subagents/, tool-results/)
053f6f59-c2de-47bb-b934-c20775623c5c.jsonl
0b9b65fb-c3dd-412c-8940-5d9abf034748.jsonl
memory/
```

- Folder = the **launch cwd, realpath'd**, with every `/` and `.` replaced by `-`
  (`~/.claude/session-dashboard` → `-Users-annayang--claude-session-dashboard`; `/tmp/cc-spike` → `-private-tmp-cc-spike`).
  **Lossy**: `-Users-annayang-y-acme-shop` could be `~/y/acme-shop` or `~/y/toys/r/us`. Never decode it; read `cwd` from the file.
- File = `<sessionId>.jsonl`, **one file per session id** (the uuid inside matches the filename on every line that has `sessionId`).
- Optional sibling folder `<sessionId>/` with `subagents/` and `tool-results/`. Also `memory/` per project (not a session).
- Folders leading with `-` break naive shell tools (`ls -Users…` is parsed as flags) — always pass `./`-prefixed or absolute paths.

## 2. Line types, key fields, custom title

10 most recent files (`ls -t */*.jsonl | head -10`), counts of `.type`:

```
1603 attachment      334 mode              124 system
1353 assistant       333 permission-mode    72 file-history-snapshot
 863 api-request-blob 333 atis-latch        66 pr-link
 802 api-request     332 last-prompt        34 queue-operation
 704 user            324 ai-title           20 api-request-shape
                                            19 cost-state
                                            11 file-history-delta
```

Across **all** files additionally: `frame-link`(32), `artifact-comment-monitor`(11), `artifact-autoreact-ledger`(5); in the spike: `custom-title`, `agent-name`; in subagent files: `fork-context-ref`.
**Zero `summary` lines anywhere on disk.**

Which types carry which field (10 most recent files):

| field | carried by |
|---|---|
| `cwd`, `gitBranch`, `isSidechain`, `uuid`, `parentUuid` | `user`, `assistant`, `attachment`, `system` only |
| `timestamp` | the above + `api-request`, `api-request-shape`, `pr-link`, `queue-operation`, `file-history-delta` |
| `sessionId` | nearly everything except `file-history-snapshot`, `file-history-delta` |
| `leafUuid` | **`last-prompt` only** (`{"type":"last-prompt","lastPrompt":"…","leafUuid":"…"}`) |
| no `timestamp` | `ai-title`, `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `cost-state`, `file-history-snapshot`, `api-request-blob` |

Observations that matter for a parser:
- `gitBranch` is `"HEAD"` (not null/absent) when detached **or not a git repo at all** (`~/o` and `/tmp/cc-spike` both record `"HEAD"`).
- `cwd` **changes inside a session** when Claude `cd`s (e.g. `053f6f59` has 16 distinct cwds). Use the first `cwd` as "project", not the last.
- Branch can change inside a session: `dd025063` = `develop` → `bugfix/ACME-623-621_pdp-fixes`; `0a8cb056` = `dev` → `feature/form-improvement`.
- `ai-title` is re-appended many times (e.g. 146× in `87878b59`); take the **last** one.
- Metadata-only files exist: `ec78c11b…jsonl` has 5 lines (`ai-title`, `mode`, `permission-mode`, `atis-latch`, `cost-state`), **no timestamp and no messages**.

**Custom title**: yes, `{"type":"custom-title","customTitle":"…"}` — written by `claude -n/--name` (and presumably `/rename`). None of the real sessions had one; produced in the spike:

```
$ claude -n "spike named session" -p "say ok named"
$ grep -o '"type":"custom-title"[^}]*' d4a1e24c-….jsonl
"type":"custom-title","customTitle":"spike named session","sessionId":"d4a1e24c-…"   (×3, plus 3× agent-name)
```

## 3. Where the `--resume` title comes from

From the 2.1.309 binary (`strings $(readlink ~/.local/bin/claude)`):

```js
displayText: ts.customTitle ?? ts.aiTitle                          // resume suggestions
let Se = (ke.customTitle ?? ke.aiTitle)?.toLowerCase()             // --resume <name> matching
if (i.firstPrompt || i.customTitle || i.aiTitle) return true       // what is listed at all
else if (ko.type==="summary" && ko.leafUuid) r.set(ko.leafUuid, ko.summary)   // legacy summaries still read
```

Picker subtitle (`UEn`): `modified` date · `bg` · `gitBranch` · size or "N messages" · `#tag` · `@agent` · PR.

**Precedence: `customTitle` (last) → `aiTitle` (last) → first user prompt.** Legacy `summary` lines (keyed by `leafUuid`) are still parsed but none exist here. `claude -p` sessions get **no `ai-title`** line.

## 4. Last activity: mtime vs last timestamp

Across all 43 main files (mtime − max(`timestamp`)):

```
0s     0328999a, 7731d546, 908f3c7c, all spike files
2–80s  most sessions
1131s  87878b59     1570s 4a0886ae     3680s 506e8f56
9767s  0b9b65fb    11470s 0522a2c7    64306s (~18h) cd37d25a
n/a    ec78c11b (no timestamped line at all)
```

mtime is **never earlier** than the last timestamp. The last line is usually an un-timestamped `cost-state` or `file-history-snapshot`, written when the process exits / idles. So mtime ≈ "process last wrote / exited"; max `timestamp` ≈ "last real message". Use **max `timestamp` of user/assistant lines** for "last activity", with mtime as fallback (and as a cheap change-detection key).

## 5. Resume behaviour

```
$ cd /tmp/cc-spike && claude -p "say ok" --output-format json | jq .session_id
"ed01b28c-7dc0-4d49-8681-6c5009e3bdb4"            # file: 26 lines
$ claude --resume ed01b28c-… -p "say ok again" --output-format json | jq .session_id
"ed01b28c-7dc0-4d49-8681-6c5009e3bdb4"            # same file, now 40 lines
$ claude --resume ed01b28c-… --fork-session -p "say ok fork"
"af6dffa1-ef1d-44e2-86a1-d912adb08e77"            # NEW file; original untouched (40 lines)
$ claude --session-id 11111111-2222-4333-8444-555555555555 -p "say ok sid"
"11111111-2222-4333-8444-555555555555"            # file named exactly that
```

- `--resume <id>` **appends to the same file, same id** (verified on 2.1.309 only).
- `--fork-session` → new id, new file containing a **full copy** of the history with `sessionId` rewritten. All 19 original `uuid`s reappear in the fork; there is **no `forkedFrom` field**. Fork lineage is only detectable via shared `uuid`s.
- `--session-id <uuid>` lets the dashboard **choose the id up front**, so it knows the file path before launch.

Help text: `--fork-session  When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)`; `--session-id <uuid>  Use a specific session ID for the conversation (must be a valid UUID)`.

## 6. cleanupPeriodDays

```
$ jq '{cleanupPeriodDays}' ~/.claude/settings.json             -> null (keys: enableWorkflows,hooks,model,theme)
$ <repo>/.claude/settings{,.local}.json for ~/o ~/y/* ~/Downloads/community-mcp  -> none exist
$ cat ~/.claude/.last-cleanup                                   -> 2026-10-23T08:22:26.018Z
binary: let s=(settings).cleanupPeriodDays ?? d1t; if (s===0) return null; …   var d1t=30
oldest surviving transcript: 23 Sep 16:54  (= exactly 30 days before today's cleanup)
```

Not set anywhere → **default 30 days**, consistent with the oldest file on disk. `0` disables cleanup. Cleanup is run by Claude Code itself at startup (`.last-cleanup`), so sessions vanish without the dashboard doing anything.

## 7. Sub-agent transcripts

```
<project>/<parentSessionId>/subagents/agent-<agentId>.jsonl
                                     agent-<agentId>.meta.json        {"agentType":"general-purpose","description":"/code-review 870","spawnDepth":1,"finished":true,…}
                                     agent-<agentId>.forked-skill.json / .forked-skill.marker.json   (skill forks only)
```

- **Main files contain 0 lines with `isSidechain:true`**; sidechains live only in `subagents/`.
- Subagent lines: `isSidechain:true`, `agentId:"a…"`, and `sessionId` = **the parent's** session id. First line may be `fork-context-ref` (fork agents).
- Parent links to the child via `toolUseResult.agentId` on the tool-result `user` line.
- A glob of `*/*.jsonl` (depth 2) naturally excludes them; a recursive glob would wrongly list them as sessions.

## 8. `claude -p` and session files

- **Yes, `-p` writes a normal transcript** (`ed01b28c….jsonl`, 162 KB for "say ok" because of `api-request-blob` lines).
  Its `user` lines have `"entrypoint":"sdk-cli"` (interactive = `"cli"`), and there is **no `ai-title`**.
- Disable with **`--no-session-persistence`** (print mode only): the run returned id `3040f178-…`, no file was created.
- `--output-format json` returns one object; fields of interest:

```json
{"type":"result","subtype":"success","is_error":false,"result":"ok",
 "session_id":"ed01b28c-…","num_turns":1,"duration_ms":1400,"duration_api_ms":1139,
 "total_cost_usd":0.068,"stop_reason":"end_turn","terminal_reason":"completed",
 "usage":{…},"modelUsage":{"claude-opus-5-5":{…}},"permission_denials":[],"subagent_stats":{…},"uuid":"…"}
```

Without `</dev/null`, `-p` waits 3 s for stdin and prints a warning — spawn with stdin ignored.

## 9. Open Terminal.app / iTerm2 in a cwd from a detached Node child

Working code (`node v22.22.0`; iTerm2 is installed at `/Applications/iTerm.app`):

```js
import { spawn } from 'node:child_process';

const SCRIPTS = {
  terminal: `
on run argv
  set shellLine to item 1 of argv
  tell application "Terminal"
    activate
    do script shellLine
  end tell
end run`,
  iterm: `
on run argv
  set shellLine to item 1 of argv
  tell application "iTerm"
    activate
    set w to (create window with default profile)
    tell current session of w to write text shellLine
  end tell
end run`,
};

const shQuote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

export function openInTerminal(app, cwd, command) {
  const shellLine = `cd ${shQuote(cwd)} && ${command}`;
  // argv goes through `on run argv`, so no AppleScript string escaping is needed
  const child = spawn('/usr/bin/osascript', ['-e', SCRIPTS[app], shellLine], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}
```

Verified:

```
$ node open-terminal.mjs terminal "/tmp/cc-spike/dir with 'quote'" 'pwd > /tmp/cc-spike/term-terminal.txt'
$ node open-terminal.mjs iterm    "/tmp/cc-spike/dir with 'quote'" 'pwd > /tmp/cc-spike/term-iterm.txt'
$ head /tmp/cc-spike/term-*.txt
==> term-iterm.txt <==     /tmp/cc-spike/dir with 'quote'
==> term-terminal.txt <==  /tmp/cc-spike/dir with 'quote'
```

No Automation (TCC) prompt appeared, presumably because the host terminal already has that permission. **Untested:** a dashboard server started by launchd or a different app will probably get a one-time "X wants to control Terminal/iTerm" prompt.

## 10. Is a session running right now?

```
$ lsof +D ~/.claude/projects
Claude  1765 … DIR  /Users/annayang/.claude/projects     <- desktop app watching the dir; no .jsonl held open
$ ps -axo pid,tty,lstart,command | grep claude
 6809 ttys000 Fri 23 Oct 17:03:11  claude
 7410 ttys001 Fri 23 Oct 17:04:35  claude
10147 ttys003 Fri 23 Oct 17:08:27  claude --resume
$ cat ~/.claude/sessions/6809.json
{"pid":6809,"sessionId":"57a77212-…","cwd":"/Users/annayang/o","startedAt":1792746194707,
 "procStart":"Fri Oct 23 09:03:11 2026","kind":"interactive","entrypoint":"cli",
 "name":"o-5f","status":"busy","updatedAt":…,"messagingSocketPath":"/tmp/cc-socks/6809.sock",…}
```

- **`lsof` does not work**: transcripts are opened, appended and closed. **`ps` alone can't map pid → session** (argv is just `claude`).
- **`~/.claude/sessions/<pid>.json` is a live-session registry**: pid → `sessionId`, `cwd`, `status` (`busy`/…), `kind`. Treat an entry as live only if `kill -0 pid` succeeds **and** `procStart` matches the process start time (guards against pid reuse and stale files).
- Caveat: pid 10147 (`claude --resume`, sitting in the picker) registered a placeholder id `4f1e5a22…` that has **no transcript file**. Registry ids can point at files that don't exist (yet).
- Ignore `<pid>.<hash>.key` files there; they look like secrets and are not needed.
- Fallback heuristic: mtime < ~2 min ago.

## 11. `claude -p` with MCP connectors (Atlassian Rovo)

Date: 2026-10-24 · Claude Code **2.1.310**. Method: unlike sections 1–10, these were real `-p` runs against the user's Jira through Rovo, read-only tools only, with `--no-session-persistence` (no transcripts written). Found while building T12 (ADR 0039, ADR 0040).

```
$ claude mcp list
claude.ai Atlassian Rovo: https://mcp.atlassian.com/v1/mcp/authv2 - ✔ Connected
```

- **Rovo is a claude.ai connector**, not a local MCP config. Its tools are `mcp__claude_ai_Atlassian_Rovo__<tool>` (e.g. `searchJiraIssuesUsingJql`, `getJiraIssue`, `getAccessibleAtlassianResources`). `--strict-mcp-config` would drop it.
- **Any `--tools` value hides the MCP tools in `-p`.** Tried, each with `--permission-mode dontAsk` and the Rovo tools in `--allowedTools`: `--tools ""`, `--tools ToolSearch`, `--tools "ToolSearch,<rovo tools>"`, `--tools "<rovo tools>"` with `ENABLE_TOOL_SEARCH=false`. No run could call Rovo. With `--tools default` they are listed as loadable through ToolSearch.
- **What a run with no tools looks like:** it does not error. `num_turns: 1`, `permission_denials: []`, and `result` is either a tool call written out as text (`<invoke name="mcp__atlassian_rovo__…">`) or a made-up answer such as `{"authRequired":true}`. **If a run "fails auth" or returns no JSON, check `num_turns` first.**
- **Without `--tools`, `--permission-mode dontAsk` + `--allowedTools <rovo reads>` works:** 4–5 turns, correct answers, `permission_denials: []`. Built-ins are present then, so deny them by name (`--disallowedTools`).
- **Login:** Rovo answered with the user logged out of Atlassian in the browser; Claude Code holds its own login. No run has produced an auth error, so its wording is still unknown (unverified).
- **Cost depends on the prompt cache:** the same run costs 2–4× more cold than warm (e.g. Sonnet 5.5: $0.21 cold, $0.085 warm). Per-model numbers: ADR 0040.
- **Mentions in JQL (T13, 2026-10-24):** `comment ~ currentUser()` and `comment ~ "<accountId>"` return the same issues (18 in the past week), so it is a text match on the account id and also matches comments the user wrote. Telling a mention from one's own comment needs the comments read (ADR 0042). `assignee/reporter/watcher = currentUser()` works through Rovo.
- **Large tool results are saved under `~/.claude` even with `--no-session-persistence` (T13):** a result over `MAX_MCP_OUTPUT_TOKENS` (default 25,000) goes to `~/.claude/projects/<runner folder>/<id>/tool-results/*.txt`, and the model gets an error instead. In `-p` with Read denied it re-ran the search with `maxResults` 6, then 3, and stopped after 12 of 18 issues: a valid but incomplete answer. `searchJiraIssuesUsingJql` with `fields: comment` returns each issue's whole comment history (142k characters for 18 issues over 7 days). Setting `MAX_MCP_OUTPUT_TOKENS=60000` in the runner's environment keeps the result inline (ADR 0042).
- **Inbox runs (T13, Sonnet 5.5 low):**

| Prompt | Mention window | Time | Turns | Cost | Items | Note |
|---|---|---|---|---|---|---|
| v1 | 7 d | 76 s | 25 | $0.68 | 7 | per-issue lookups, oversized result |
| v2: no per-issue lookups, maxResults 30 | 7 d | 55 s | 10 | $0.40 | 4 | oversized result paged; 3 issues never read |
| v3: + 60k MCP cap, too-large answer | 3 d | 24 s | 6 | $0.20 | 3 | both searches complete, nothing saved under `~/.claude` |

  The same issue (ACME-532) was `action` in v1 and v2 and `fyi` in v3 on the same comments: classification is not stable from run to run.
- Re-test all of this after upgrading Claude Code: if `--tools` stops hiding MCP tools, it is the stronger guard.

## 12. Where `/rename` writes

Date: 2026-11-01 · Claude Code **2.1.316** (it auto-updated from 2.1.314 during the run). Method: an interactive `claude` in `/tmp/cc-spike` driven by `expect`, with a clean environment (an inherited `CLAUDE_CODE_CHILD_SESSION` turns transcript saving off). One prompt ("say ok"), `/rename spike first name`, `/rename spike second name`, `/exit`. Found while planning T16a.

```
$ grep -n -o '"type":"custom-title"[^}]*' 5824af27-….jsonl        # 48 lines in all
35:"type":"custom-title","customTitle":"spike first name","sessionId":"5824af27-…"
40:"type":"custom-title","customTitle":"spike second name","sessionId":"5824af27-…"
$ cat 5824af27-…/custom-title.json
{"customTitle":"spike second name"}
```

- **Each `/rename` appends one `custom-title` line to the same `.jsonl`**, followed at once by an `agent-name` line with the same text (lines 36, 41). No timestamp on either. The first rename landed mid-file (line 35 of 48), after the `ai-title` lines; later lines (`system`, `user`, `cost-state`, `file-history-snapshot`, `last-prompt`) follow it.
- **`/rename` also writes `<id>/custom-title.json`** in the session's sidecar folder: `{"customTitle":"<latest>"}`, overwritten on each rename (the folder was created for it; this session had no sub-agents or tool results). Its mtime is the second rename's time, not the file's last write.
- `~/.claude/history.jsonl` gets each typed command (`"display":"/rename spike first name"`, with `sessionId`); that is prompt history, not a title store. Nothing in `~/.claude.json` or `~/.claude/sessions/` holds the name.
- The rename changes the terminal tab title at once (OSC 0 in the output).
- Not checked: whether `claude -n/--name` also writes `custom-title.json` (the § 2 fixture has no sidecar folder).
- The throwaway session `~/.claude/projects/-private-tmp-cc-spike/5824af27-41fe-4bdc-a1bf-2fe497b7c13e*` and `/tmp/cc-spike` were left in place.

## 13. `claude --session-id <uuid> --name <name> <prompt>` (what the launcher runs)

Date: 2026-11-01 · Claude Code **2.1.316**. Method: an interactive `claude` in `/tmp/cc-spike` under `script -q /dev/null` (a pty), every `CLAUDE*` variable unset (see § 12), killed after 45 s. Found while doing T16c.

```
$ claude --session-id 341b560f-… --name 'test name' 'say ok'
$ grep -n -o '"type":"[a-z-]*"' 341b560f-….jsonl | awk -F: '$1!=p{print;p=$1}' | head -7    # 45 lines in all
1:{"type":"custom-title"      ← "customTitle":"test name"
2:{"type":"agent-name"        ← "agentName":"test name"
3:{"type":"mode"
4:{"type":"permission-mode"
5:{"type":"file-history-snapshot"
6:{"type":"file-history-snapshot"
7:"type":"user"               ← the first prompt
```

- **`--name` writes `custom-title` as line 1, before the first prompt**, with an `agent-name` line right after. Both are re-appended (same text) after each turn: lines 21, 31, 40 here.
- The name shows in the prompt box at once. The positional prompt is sent as the first message, as without `--name`.
- **`--name` writes no `<id>/custom-title.json`**: the session has no sidecar folder (unlike `/rename`, § 12).
- So the dashboard sees the name as Claude Code's `customTitle` from the first rescan that sees the file; it is not a dashboard rename (`title` stays unset, ADR 0056 never clears anything).
- Throwaway session `~/.claude/projects/-private-tmp-cc-spike/341b560f-5806-4da9-b326-7ad094397b5b.jsonl` left in place. Three earlier attempts wrote no transcript (sandbox, then the inherited `CLAUDE_CODE_CHILD_SESSION`).

---

## Fixtures (`fixtures/projects/`)

Generated by `fixtures/scrub.py` (whitelist of id/time/cwd/branch/enum keys kept verbatim; JSON-in-string fields recursed; every other string → lorem, capped at 160 chars). Verified: for every line `[type, uuid, parentUuid, sessionId, timestamp, cwd, gitBranch, isSidechain, leafUuid, agentId]` is byte-identical to the source (0 mismatches). Git branch names (incl. inside API-request blobs) are kept by design.

| slot | session | why |
|---|---|---|
| ticket branch | `-Users-annayang-y-acme-shop/da917231…` | `bugfix/ACME-608_dynamic-preorder-accordion` |
| no branch | `-Users-annayang-y-acme-shop/506e8f56…` | `gitBranch:"HEAD"`, + `tool-results/`. Line 1 is a **synthetic** `summary` line (added by hand, see below) |
| sidechain-heavy | `-Users-annayang-y-acme-shop/55e4d22f…` | 3 subagents (2 forked-skill, 1 plain) |
| custom title (instead of "summary present") | `-private-tmp-cc-spike/d4a1e24c…` | No real `summary` line exists on this machine, so this slot holds a session with `custom-title` + `agent-name`, `entrypoint:sdk-cli` and no `ai-title` |
| multi-branch | `-Users-annayang-y-acme-shop/dd025063…` | `develop` → `bugfix/ACME-623-621_pdp-fixes`, + 1 subagent |
| outside ~/y, ~/o | `-Users-annayang-Downloads-community-mcp/0328999a…` | `~/Downloads/community-mcp`, branch `dev` |

Size: 7.2 MB (mostly the API-request blobs).

**Synthetic summary line.** To let T2 test the old-format fallback, `506e8f56…jsonl` starts with one hand-made line in the shape the 2.1.309 reader still parses (`type==="summary" && leafUuid`):
`{"type":"summary","summary":"lorem ipsum dolor sit amet","leafUuid":"b2304b97-2397-415d-8406-1507a36e0066"}`. The `leafUuid` is the file's last assistant message. The file also has `ai-title` lines, so it tests that the AI title wins; drop those lines in a test to check that summary comes next. It is the only line in the fixtures that did not come from a real transcript.

---

## Summary

| # | Question | Answer | Confidence | Impact on spec |
|---|---|---|---|---|
| 1 | Naming | `projects/<cwd with / and . → ->/<sessionId>.jsonl`, one file per id; sidecar `<id>/` folder | High | Don't decode folder names (lossy); read `cwd` from lines. Glob depth 2 only. |
| 2 | Line types / fields | ~20 types; cwd/branch/sidechain only on user/assistant/attachment/system; `leafUuid` only on `last-prompt`; `custom-title` exists (via `--name`); **no `summary` lines** | High | Parser must tolerate unknown types, metadata-only files, `"HEAD"` = no branch, cwd/branch changing mid-session. |
| 3 | Resume title | `customTitle ?? aiTitle ?? firstPrompt` (last occurrence of each); legacy `summary` still read | High (from code) | **Title must come from `custom-title`/`ai-title`, not `summary`.** |
| 4 | Last activity | mtime ≥ last timestamp; drift 0 s → 18 h | High | Use max message `timestamp`; mtime only as change key / fallback. |
| 5 | Resume | Same id + same file append; `--fork-session` = new id, full copy, no parent pointer; `--session-id` works | High (2.1.309) | Dashboard can pre-assign ids with `--session-id`; dedupe forks by shared uuids if needed. |
| 6 | cleanupPeriodDays | Unset everywhere → default **30** (`0` disables); oldest file = exactly 30 days | High | Dashboard history is at most 30 days. Decided: keep 30 and warn on bookmarks near the limit (T9). |
| 7 | Sub-agents | `<id>/subagents/agent-<agentId>.jsonl` + `.meta.json`; `isSidechain:true`, parent's `sessionId` | High | Don't count them as sessions; optional child list via `meta.json`. |
| 8 | `-p` | Creates a file (`entrypoint:"sdk-cli"`, no ai-title); `--no-session-persistence` disables it; JSON result shape above | High | Any `-p` the dashboard runs pollutes the list unless `--no-session-persistence`; filter `sdk-cli` if desired. |
| 9 | Open terminal | Working Terminal + iTerm2 code via detached `osascript` + `on run argv` | High (tested); TCC prompt untested | Expect a one-time Automation permission prompt depending on the host process. |
| 10 | Running now? | `lsof` no; `ps` can't map; **`~/.claude/sessions/<pid>.json`** maps pid→sessionId+status | Medium-High (undocumented file) | None for now: live detection was rejected. If revisited, use the registry + `kill -0` + `procStart` check and tolerate ids with no file. |
| 11 | `-p` + MCP | Rovo is a claude.ai connector (`mcp__claude_ai_Atlassian_Rovo__*`); **any `--tools` value hides MCP tools**; `dontAsk` + `--allowedTools` without `--tools` works | High (2.1.310, tested) | The runner denies built-ins by name instead of `--tools ""` (ADR 0040). A 1-turn run means no tools, not an auth problem. |
| 12 | `/rename` | Appends `custom-title` + `agent-name` to the same `.jsonl`, mid-file if the session goes on; also overwrites `<id>/custom-title.json` | High (2.1.316, tested) | Last custom title must be searched for in the whole file (ADR 0055); `custom-title.json` is ignored. |

### Contradictions with the spec / CLAUDE.md: all decided on Oct 23 and applied to `CLAUDE.md` and `docs/spec.md`
1. **Title rule** (amendment + T2 said "custom title → latest summary → first user prompt"). There are no `summary` lines; real sessions get titles from `ai-title`. **Decided:** `customTitle → aiTitle → summary (old format) → first user prompt (80 chars)`, matching `claude --resume`.
2. **Branch rule** (T2 said "last non-empty gitBranch"). A missing branch is stored as `"HEAD"`, never empty. **Decided:** `"HEAD"` = no branch.
3. **cwd / workspace / Resume.** `cwd` changes mid-session (up to 16 values). **Decided:** the **first** `cwd` (the launch folder, which is also the folder the file lives in) is used for workspace, repo and Resume.
4. **Delete = move `<id>.jsonl` to trash.** A session can also have an `<id>/` folder (`subagents/`, `tool-results/`). **Decided:** trash and restore the `.jsonl` and the folder together. Data outside the project folder (e.g. `~/.claude/file-history/`) is left alone.
5. **Runner sessions.** **Decided:** the T12 runner uses `--no-session-persistence` (no transcript written); the runner-folder exclusion stays as a backup.
6. **"Read only head and tail"** (T2). The last lines are usually untimestamped (`cost-state`, `file-history-snapshot`). **Decided:** the tail read goes back until it reaches a timestamped user/assistant line.

Confirmed as the spec assumed: resume keeps the same id (blocker 2 resolved), `--session-id` works (gap #12), `cleanupPeriodDays` = 30 (unset), sub-agents are separate files.
Not a contradiction: live-session detection was rejected, but `~/.claude/sessions/<pid>.json` would make it cheap if you revisit that decision.

### Side notes
- The old v1 Python app (`sessions.py`) was still at `~/.claude/session-dashboard/` when the spike started. It has since been archived to `~/o/archive/session-dashboard-v1/`. I didn't read or modify it.
- The throwaway spike sessions (`~/.claude/projects/-private-tmp-cc-spike/`) and `/tmp/cc-spike/` were deleted after the spike. The `-private-tmp-cc-spike/d4a1e24c…` fixture is the only remaining copy.
