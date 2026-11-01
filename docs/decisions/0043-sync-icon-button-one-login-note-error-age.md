# 0043: The header's sync icon is the Sync button; one login note covers titles and inbox; a failed sync keeps the age of the results shown

- Status: Accepted
- Date: 2026-10-24
- Task: T13

## Context
- T13b fills the header sync slot (ADR 0041) with "Jira synced N min ago", an error note and a manual Sync button. The prototype shows only a refresh icon and "Jira synced 2 min ago": no button, no error, no login state.
- Two jobs can now need the Rovo login: titles (ADR 0039) and the inbox (ADR 0042). The login note from T12b follows titles only, and its retry refreshes titles only.
- Spec § Inbox: on a failed or invalid sync, the last good result stays and an error note appears. The server keeps `lastAttempt.reason` and the result's `syncedAt` (ADR 0042).

## Options
Sync button:
1. **The icon is the button**: the prototype's layout, unchanged.
2. **A second button after the text**.

Login note:
1. **One note for both jobs; retry runs both**.
2. **Inbox only**: a titles auth failure shows nothing.

Error note:
1. **Failure + age of the results shown**, reason as a tooltip, Sync button kept.
2. **Short note only**.

## Decision
Chosen by the user on 2026-10-24: option 1 in each.
- `JiraSyncStatus` (src/web/shell/Header.tsx): the refresh icon is an icon button "Sync Jira now" (aria-label and title) that POSTs `/api/jira/inbox/sync`; while it runs it is disabled, `aria-busy`, and the icon spins (not under reduced motion). Text: "Jira synced {ago}", or "Jira not synced yet" before the first good sync. No live region: it changes every minute.
- After a failed attempt (not auth): warning icon, the Sync button, "Jira sync failed · showing results from {ago}" or "· no results yet", `role="status"`, and the reason (timeout, invalid, failed) as the title.
- The login note shows on Work when the last titles run or the last inbox attempt was `auth`, in place of the sync status. Its button, now "Sync Jira again", syncs the inbox and refreshes titles.
- `{ago}`: "just now", "N min ago", "Nh ago", "Nd ago" (`agoLabel`), refreshed every minute by the shared `useNow`.
- `useJiraInbox` follows `useJiraTitles`: GET on mount and on `sessions-changed` through the shared events stream (ADR 0041); a failed GET keeps what is shown.

## Consequences
- The tooltip is the only place that says why a sync failed; the detail kept in state.json (ADR 0042) is for prompt tuning and is not shown.
- The Sync button syncs the inbox only; titles still refresh on rescans and from the login note.
- T14 reads the same `useJiraInbox` data for the Needs you list.
