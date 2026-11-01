import { OSASCRIPT, type TerminalAdapter } from './adapter';

// Always a new window: a tab needs a Cmd-T keystroke (Accessibility) or typing into the
// existing tab, and ADR 0059 rules out both. The shell line arrives as `item 1 of argv`.
// Not running: launch it and use the window it opens, waiting up to 5 s for it to appear;
// a bare `do script` would leave that window empty beside a second one (spike-terminal § 2).
export const TERMINAL_APP_SCRIPT = `on run argv
  set shellLine to item 1 of argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if wasRunning then
      do script shellLine
    else
      repeat 50 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      if (count of windows) is 0 then
        do script shellLine
      else
        do script shellLine in window 1
      end if
    end if
  end tell
end run`;

export const terminalApp: TerminalAdapter = {
  id: 'terminal',
  bundle: 'Terminal.app',
  caps: { tab: false, argv: false, syncResult: false },
  plan: ({ shellLine }) => ({ file: OSASCRIPT, args: ['-e', TERMINAL_APP_SCRIPT, shellLine] }),
};
