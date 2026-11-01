# 0035: Read hac envs from ~/.hac/projects/*.toml, names and gate flags only

- Status: Accepted
- Date: 2026-10-24
- Task: T10

## Context
- docs/spec.md and the T10 prompt said hac-cli's `*.toml` lives under `~/y/.claude`. ADR 0033 warned the path could move.
- On this Mac hac keeps one file per project in `~/.hac/projects/<project>.toml` (plus `<project>.toml.example`). Its skill says a repository `.hac.toml` cannot grant gates. The commands take `-p/--project` and `-e/--env`.
- `~/.hac/sessions/` holds cached logins and is never read.

## Options
1. **Keep `~/y/.claude/*.toml`**: matches the old spec, but there are no envs there.
2. **`~/.hac/projects/*.toml`**: where hac reads them; the file stem is the project name that `-p` takes.

## Decision
Option 2, chosen by the user on 2026-10-24 ("check ~/.hac … move it to a proper place").
- `readHacEnvs` reads every `*.toml` (not `*.toml.example`) in `~/.hac/projects` and keeps `{ project, name, readOnly, allowSqlCommit, allowGroovyCommit, allowImpexImport }`. Everything else in the parsed file is dropped inside the function.
- Production: `read_only = true`, or the name matches `/^(p\d+|prod)/i`, or it is listed in config.json `prodEnvs: { "<project>": ["<env>"] }`.
- Tests use `fixtures/hac-cli/acme.toml` (fake values), never `~/.hac`.

## Consequences
- Envs are keyed by project and name, so two projects can both have `p1`.
- If hac moves its config again, only `HAC_PROJECTS_DIR` changes.
