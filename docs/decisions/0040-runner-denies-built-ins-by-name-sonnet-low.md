# 0040: The runner denies built-in tools by name instead of `--tools ""`, fails a run with any denial, and uses Sonnet 5.5 at low effort

- Status: Accepted
- Date: 2026-10-24
- Task: T12
- Supersedes: the `--tools ""` flag and the default-model consequence of 0039

## Context
- ADR 0039 removed built-in tools with `--tools ""`. Real runs showed that any `--tools` value also hides the MCP tools in `-p`; without `--tools`, `dontAsk` + `--allowedTools` reaches Rovo and returns correct titles. Details, symptoms and the login finding: [spike § 11](../spike.md).
- Model comparison, 4 keys (3 real, 1 made up), 2 runs each, every run correct with the made-up key reported missing:

| Setting | Time | Cost (cold → warm cache) |
|---|---|---|
| Opus (default) | ~17 s | $0.38 → $0.18 |
| Sonnet 5, low | ~12 s | $0.23 → $0.09 |
| Sonnet 5.5, low | 11–13 s | $0.21 → $0.085 |
| Sonnet 5.5, medium | ~8 s | $0.068 (warm) |

## Options
Tool guard:
1. **Deny by name + check**: no `--tools`; `--permission-mode dontAsk` with the three Rovo reads allowed; `--disallowedTools` names the built-ins and the Rovo write tools; a run with any `permission_denials` fails.
2. **Deny by name only**: the same flags; a denial is only logged.

Model:
1. **Sonnet 5.5, low**: least thinking for a pure lookup.
2. **Sonnet 5.5, medium**: no better answers in the comparison.
3. **Sonnet 5, low**: the same results and cost as Sonnet 5.5.

## Decision
Chosen by the user on 2026-10-24: option 1 for the tool guard; Sonnet 5.5 at low effort.
- Denied built-ins: Agent, Bash, Edit, Glob, Grep, NotebookEdit, Read, Skill, Task, WebFetch, WebSearch, Write.
- `--model claude-sonnet-5-5 --effort low` on every run; `createRunner({ model })` can override it for a later job.
- A run with a non-empty `permission_denials` answers `failed`, even with a valid answer, and the cache stays as it was.

## Consequences
- A built-in tool added in a later Claude Code release is not on the deny list. `dontAsk` still denies it, and the denial check fails the run, so the gap shows in activity.log instead of passing silently.
- A title run costs about $0.08 with a warm cache.
- Re-test with `--tools` after a Claude Code upgrade; if it stops hiding MCP tools, it is the stronger guard.
