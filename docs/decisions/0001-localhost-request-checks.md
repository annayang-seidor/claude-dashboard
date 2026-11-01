# 0001: Protect the localhost server with Host, Origin and token checks

- Status: Proposed; token lifetime superseded by 0032
- Date: 2026-10-23
- Task: T1

## Context
The server binds 127.0.0.1:4317, but binding to loopback does not make it private: any page open in the browser can send requests to it. Two attacks matter:
- **DNS rebinding:** an attacker's domain re-resolves to 127.0.0.1, so their page counts as same-origin and can read responses.
- **CSRF:** any site can send a POST it never reads. That is enough to trigger Delete, or Resume, which starts a process.

Vite 8's dev server already rejects a foreign Host on port 5173 (checked with curl: 403).

## Options
1. **Bind to 127.0.0.1 only**: no code, but open to both attacks above.
2. **Host + Origin checks only**: stops rebinding and browser CSRF, but anything else that reaches the port gets full access.
3. **Host + Origin + per-launch token**: adds a secret no other page can read, at the cost of getting the token to the page (see 0002) and tooling sending it.

## Decision
Option 3, as one middleware on every request (`src/server/security.ts`):
1. **Host, every request:** must be exactly `127.0.0.1:4317` or `localhost:4317`. A missing Host, another port or another name gets 403.
2. **Origin, every request except GET/HEAD:** must be one of the dashboard's own origins. A missing Origin is rejected too, because browsers send Origin on POST/PUT/PATCH/DELETE (unverified across all browsers; true for current Chrome and Firefox fetch).
3. **Token, every `/api/` request:** `X-Dashboard-Token` must equal a random 32-byte token made at launch, compared in constant time. Built static files need no token, so the page can load.

GET with a foreign Origin passes step 2: with no CORS headers the attacking page cannot read the reply, and step 3 still applies.

Dev mode: Vite serves the page on 127.0.0.1:5173 and proxies `/api` with `changeOrigin`, so Host arrives as 127.0.0.1:4317. The Vite origin is allowed only when `DASHBOARD_WEB_ORIGIN` is set, and only `pnpm dev` sets it.

## Consequences
- New routes are covered without extra code. State-changing routes must not be GET, or they skip the Origin check.
- curl and scripts must send the token and a matching Host; mutating calls also need an allowed Origin.
- `EventSource` cannot set headers, so T4's `/api/events` cannot send the token as written. T4 must pick a fetch-based stream reader or a query-string token for that route, and record the choice in an ADR.
- `src/server/security.test.ts` (26 tests, including one on a real socket) covers each 403 case and must keep passing.
