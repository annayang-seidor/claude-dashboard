# 0004: Pin TypeScript 6.0 and pnpm 10

- Status: Proposed
- Date: 2026-10-23
- Task: T1

## Context
- `typescript@latest` is 7.0.2, but typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0` (checked with `pnpm view`).
- Corepack's default pnpm on this Mac was 8.2.0, which is old and could produce a different lockfile.
- `package.json` had `"typescript": "^6.0.3"`, which allows 6.1+ (outside typescript-eslint's range).

## Options
1. **Latest TypeScript 7**: newest compiler, but linting is unsupported and may break silently.
2. **TypeScript 6.0 with a tilde range (`~6.0.3`)**: supported by typescript-eslint, patch updates only.
3. **Drop typescript-eslint**: free to upgrade, but no type-aware linting.

## Decision
Option 2. `typescript` is `~6.0.3`. pnpm is pinned with `"packageManager": "pnpm@10.18.3"` so corepack uses the same version everywhere.

## Consequences
- Before moving to TypeScript 7, check `pnpm view typescript-eslint peerDependencies`, upgrade both together, and supersede this ADR.
- `tsconfig.json` sets `allowImportingTsExtensions` (allowed with `noEmit`) so `vite.config.ts` can import `src/shared/config.ts` with its extension, as Vite's native config loader needs.
