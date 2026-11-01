// Shared by e2e/support/server.ts and the smoke spec. Not 4317, so a dashboard already running
// on this machine (for example from launchd) does not collide.
export const E2E_PORT = 4318;
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
/** Fixed only for this test server; the real one keeps a random one in ~/.claude-dashboard/token (ADR 0032). */
export const E2E_TOKEN = 'e2e-smoke-token';

/** The Jira title the fixture server's fake runner gives ACME-608. */
export const E2E_JIRA_TITLE = 'Product sheets: preorder and gift';
