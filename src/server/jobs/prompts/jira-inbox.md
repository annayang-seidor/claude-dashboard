---
version: 3
---

Build my Jira inbox with the Atlassian Rovo tools. Read only; change nothing, post nothing.

Now: {{now}}
Last good sync: {{lastSyncedAt}}

Steps:

1. Call getAccessibleAtlassianResources for the cloudId and atlassianUserInfo for my account_id and name.
2. Issues I own or follow that changed since {{since}}: searchJiraIssuesUsingJql with
   jql `(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -{{changedMinutes}}m ORDER BY updated DESC`,
   fields summary,status,assignee,updated,comment, maxResults 30, responseContentFormat markdown.
3. Issues that may mention me in the past {{mentionDays}} days: searchJiraIssuesUsingJql with
   jql `comment ~ currentUser() AND updated >= -{{mentionDays}}d ORDER BY updated DESC`, the same fields, maxResults and format.
   This search also matches comments I wrote myself. Count an issue as a mention only if a comment
   by someone else in the past {{mentionDays}} days mentions me (my account_id or @ my name).
4. Merge both lists; each key appears once.

Use only these two searches: their results already hold every comment you need. Do not call
getJiraIssue or search again per issue. If a search result says it exceeds the maximum allowed
tokens or was saved to a file, do not page through it or retry with a smaller maxResults; answer
exactly {"error":"search result too large"}.

Classify each issue:

- kind: "assigned" if I am the assignee, otherwise "mention" (also for issues I only report or watch).
- bucket: "action" when someone is waiting on me: a question or request addressed to me after my
  last comment, the issue newly assigned to me, or a status change that hands it to me.
  Otherwise "fyi": status moves, comments not asking me anything, my own comment being the latest.
- reason: one plain sentence, at most 140 characters, saying what happened and why it needs me or not,
  e.g. "PM asked after your last comment whether the fix is on PRD".
- lastRelevantAt: when the comment or change that decided the bucket happened.

Answer with one JSON object and nothing else:
{"syncedAt":"{{now}}","items":[{"key":"ABC-1","title":"<summary>","status":"<status name>","assignee":"<display name, or empty>","bucket":"action","kind":"assigned","reason":"<one sentence>","lastRelevantAt":"<ISO 8601 with offset>"}]}

Rules: at most 30 items, newest lastRelevantAt first; dates in ISO 8601 with a time zone offset;
skip issues where nothing relevant happened in the window. If there is nothing, answer
{"syncedAt":"{{now}}","items":[]}.

If a Rovo tool says you are not authenticated or must log in, answer exactly {"authRequired":true}.
