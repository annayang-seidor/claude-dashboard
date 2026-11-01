# 0054: T15 (GitHub PR status) is parked on feature/T15-github-pr-status; v3 waits for a stage rule that fits the team's git flow

- Status: Accepted
- Date: 2026-11-01
- Task: T15 (parked)

## Context
- T15 built the v3 slice from the spec: stage dots per ticket group (Spec → Branch → Coding → PR → Review) and "PR needs fixes" items in Needs you, from the logged-in `gh`. T15a (the server job) and T15b (the UI) were done and tested.
- With the dashboard running on real work, the stage rule didn't fit. It reads a ticket's stage only from branches whose name carries the ticket key, but some work is committed straight onto a shared branch (for example `develop_restyling-phase3`). Those tickets have no branch and show as Spec however far along they are.
- How a session relates to a branch depends on the team's git flow at the time, which is expected to change. A rule built for one flow would need reworking as soon as the team works another way.

## Options
1. **Park T15**: keep the work on its own branch, take it off `develop` and out of the task list, and revisit v3 once the git flow settles.
2. **Ship T15 as is**: stages are wrong for tickets without their own branch.
3. **Extend the rule now** (for example, count commits whose message carries the key on any branch): it guesses at a flow that is still changing.

## Decision
Option 1, chosen by the user on 2026-11-01.
- All T15 work is on the local branch `feature/T15-github-pr-status`, with ADRs 0052 and 0053 and the T15 prompt in docs/review.md. `develop` was reset to `aa7eecb` and the T16 plan was cherry-picked back. T15 is no longer in the task list in docs/review.md.
- ADR numbers 0052 and 0053 belong to that branch, so `develop` skips them and the two sets never collide.
- Spec v3 (stage dots, "PR needs fixes") stays in the spec as planned work. Stage dots stay hidden, and Needs you shows only Jira items.

## Consequences
- The spike results on that branch (`gh` is logged in; SonarQube is a check but not required; `isRequired` and review threads only in GraphQL) aren't on `develop`. The spec's open question about GitHub access stays unticked until v3 resumes.
- When v3 resumes, start from that branch: the `gh` access, schemas, last-good-result handling and UI carry over, and only the stage rule (`stageOf`, `ticketBranches`) needs a new design. It should be decided in a new ADR that supersedes 0052's stage rule.
- `~/.claude-dashboard/state.json` may still hold a `sync.github` written by the T15 server. `develop` loads it without checking it (`z.unknown()`, ADR 0011) and doesn't use it. `ignoreSonarRepos` in config.json is ignored as an unknown key.
