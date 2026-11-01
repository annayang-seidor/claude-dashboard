# 0058: A committed dashboard.config.json holds shared settings; ~/.claude-dashboard/config.json overrides it per key

- Status: Accepted
- Date: 2026-11-01
- Task: v2 manual debug
- Supersedes: the "config.json only" source of `jiraBaseUrl` in 0044

## Context
- "Open in Jira" stayed disabled: `jiraBaseUrl` lives only in `~/.claude-dashboard/config.json` (ADR 0044), and that file did not exist on this machine.
- The user wants the repo to carry a config file for non-secret settings and environment constants (the Jira site first), so a fresh checkout works without hand-made files.
- Some settings are per machine (`terminal`), so the home file still has a role.
- Before this, any invalid key made readConfig drop the whole file and use all defaults.

## Options
1. **Committed JSON + local override**: `dashboard.config.json` at the repo root, same zod schema, read by the server on each call; the home file wins per key. No rebuild to change a value.
2. **TypeScript constants**: `src/shared/settings.ts` imported by server and page; compiler-checked, but a change needs a restart or rebuild, and per-machine keys stay in the home file anyway.
3. **Committed JSON only**: one place, but per-machine choices get committed for everyone.

## Decision
Chosen by the user on 2026-11-01: option 1.
- `PROJECT_CONFIG_PATH` (src/server/config.ts) is the repo's `dashboard.config.json`; `readConfig(paths)` reads the files in order and merges them shallowly, a later file winning per key.
- Each file is validated on its own with `DashboardConfigFile` (every key optional, no defaults); an invalid file is logged and skipped, so the other file and the defaults still apply. `DashboardConfig` adds the defaults after the merge.
- `start()` takes an optional `projectConfigPath`; only src/server/index.ts passes it, so tests and the e2e fixture server read only their own config (ADR 0028).
- The file must stay non-secret: it is committed. The first value is `jiraBaseUrl: https://example.atlassian.net`.

## Consequences
- A typo in one file no longer resets the other file's settings (it still resets that file's own keys).
- `prodEnvs` merges as a whole object: a home `prodEnvs` replaces the project's, it does not add to it.
- The company's Jira site is now in the repo.
