# 0036: Work transcripts get a full, incremental pass for hac env detection, reading commands and replies

- Status: Accepted
- Date: 2026-10-24
- Task: T10
- Supersedes: the "head + tail only" part of 0005, for Work sessions

## Context
- T10 tags a session with the env its hac calls used most. On real data, 5 of 49 transcripts run hac, and the calls sit anywhere in the file. ADR 0005 reads only the head and tail.
- Real calls often name no env literally: `for e in p1 s1; do hac … -e "$e"`, or no `-e` at all when hac infers it. hac's JSON reply always carries `"project"` and `"env"`.
- Measured: a raw read of all 153 MB (74 MB Work) takes about 80 ms with the OS file cache warm.

## Options
1. **Full pass, Work only**: head + tail stay for list fields; Work transcripts are also read end to end. Cost grows with Work transcript size.
2. **Append-only (0005 option 3)**: cheapest, but a restart forgets calls in the middle of existing files.
3. **Background pass after the first list**: never slows first paint; more moving parts, and Ops groups appear a moment later.

## Decision
Option 1, chosen by the user on 2026-10-24; reading replies too, also chosen by the user.
- `scanHac` (`src/server/indexer/scan.ts`) streams the file in 64 KB chunks and JSON-parses only lines whose bytes contain `hac`. The indexer cache keeps its offset and tally, so a growing file is read only from where the last pass stopped. A shrunk file is read again from the start.
- A Bash `tool_use` counts each `hac <operation> … -e/--env <name>` it names (`-p/--project` when given). Operations: flexible-search, sql, groovy, impex-validate, impex-export, impex-import, ping. `projects`, `session`, `logout`, `skill` and mentions such as `which hac` do not count.
- When some operation in a command names no literal env, the envs come from the hac envelopes in that call's `tool_result` instead, never from both.
- Most uses wins; a tie goes to the latest. A use without a project joins the same env name when exactly one project has it.
- Category: a ticket key wins, then an env (Ops), then Scratch. State `ticketOverride`, `envOverride` and `categoryOverride` win over detection.

## Consequences
- Measured on real data: 48 sessions index in 178 ms cold (35 ms before) and 1 ms warm.
- Only env and project names are kept from tool output; nothing else from a reply is stored.
- Personal sessions are never fully read.
- If hac changes its envelope header order or flags, `src/server/indexer/hac.ts` is the one place to change.
