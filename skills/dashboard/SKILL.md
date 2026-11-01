---
name: dashboard
description: Start, open, stop or check the Claude Code Session Dashboard (the local web page at 127.0.0.1:4317 that lists Claude Code sessions). Use when the user says "open the dashboard", "show my sessions dashboard", "start/stop the dashboard", or asks whether it is running.
---

Run the `dashboard` command with the matching subcommand, then report its output in one line:

| User wants                                      | Command                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| to see the dashboard, and it may not be running | `dashboard start` (starts it if needed, then opens the page) |
| to open the page of a running dashboard         | `dashboard open`                                             |
| to stop it                                      | `dashboard stop`                                             |
| to know if it is running                        | `dashboard status`                                           |

- `dashboard start` detaches the server, so it keeps running after this session ends. Don't run it as a background task, and don't start the server any other way.
- Never print or repeat the link or the token. `dashboard` opens the link itself.
- If `dashboard` is not found, tell the user to link it: `ln -s ~/o/claude-dashboard/bin/dashboard ~/.local/bin/dashboard`.
- If `dashboard open` says it isn't running, offer `dashboard start`; don't start it unasked.
- If `dashboard stop` says launchd runs it, pass on the `launchctl bootout` command it prints; don't run it.
