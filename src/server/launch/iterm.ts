import { OSASCRIPT, type TerminalAdapter } from './adapter';

// The shell line arrives as `item 1 of argv` (`on run argv`), so it is never spliced into
// AppleScript source and needs no AppleScript escaping (spike Q9).
// Running: new tab in the current window, or a new window if it has none.
// Not running: launch it and use its first window, waiting up to 5 s for it to appear.
// Whether it is running is only known when the script runs, so the fallback rule lives here.
export const ITERM_SCRIPT = `on run argv
  set shellLine to item 1 of argv
  set wasRunning to application "iTerm" is running
  tell application "iTerm"
    activate
    if wasRunning then
      if (count of windows) is 0 then
        set s to current session of (create window with default profile)
      else
        set w to current window
        if w is missing value then set w to first window
        tell w to set s to current session of (create tab with default profile)
      end if
    else
      repeat 50 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      if (count of windows) is 0 then
        set s to current session of (create window with default profile)
      else
        set s to current session of first window
      end if
    end if
    tell s to write text shellLine
  end tell
end run`;

export const iterm: TerminalAdapter = {
  id: 'iterm',
  bundle: 'iTerm.app',
  caps: { tab: true, argv: false, syncResult: false },
  plan: ({ shellLine }) => ({ file: OSASCRIPT, args: ['-e', ITERM_SCRIPT, shellLine] }),
};
