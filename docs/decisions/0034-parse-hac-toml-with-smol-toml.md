# 0034: Parse hac's toml with smol-toml

- Status: Accepted
- Date: 2026-10-24
- Task: T10

## Context
- T10 reads env names and gate flags from hac's per-project `.toml`. The review asks for a TOML library, not a hand-rolled parser.
- The same files hold urls, usernames and passwords. Whatever parses them must not carry those values into logs.

## Options
1. **smol-toml ^1.9.1**: TOML 1.0, no dependencies, ESM with types, maintained. Its `TomlError` message quotes the offending line.
2. **@iarna/toml**: widely used, but TOML 0.5, CJS, unmaintained since 2020.
3. **Hand-rolled subset parser**: no dependency, but breaks silently when hac's format grows.

## Decision
Option 1, chosen by the user on 2026-10-24.
- Only `src/server/hac/index.ts` imports it. On a parse error it logs the file name with `err.line` and `err.column`, never `err.message`, because the message can hold a password.

## Consequences
- One small runtime dependency.
- `src/server/hac/hac.test.ts` fails if any url, username or password from the fixture (or from a broken file) reaches the result or the console.
