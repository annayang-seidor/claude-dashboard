import { afterEach, describe, expect, it, vi } from 'vitest';
import { batch, projectFolderName, runnerProjectFolder } from './watch';

afterEach(() => vi.useRealTimers());

describe('batch', () => {
  it('calls once, ms after the first call of a burst', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = batch(fn, 500);
    call();
    vi.advanceTimersByTime(300);
    call();
    call();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not starve under steady writes', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = batch(fn, 500);
    for (let t = 0; t < 2000; t += 100) {
      call();
      vi.advanceTimersByTime(100);
    }
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('cancel drops a pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = batch(fn, 500);
    call();
    call.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('runner folder', () => {
  it('encodes the cwd the way Claude Code names project folders', () => {
    // Spike §1: ~/.claude/session-dashboard → -Users-annayang--claude-session-dashboard
    expect(projectFolderName('/Users/annayang/.claude/session-dashboard')).toBe(
      '-Users-annayang--claude-session-dashboard',
    );
    expect(projectFolderName('/tmp/cc-spike')).toBe('-tmp-cc-spike');
  });

  it('is ~/.claude-dashboard/runner under the projects root', () => {
    expect(runnerProjectFolder('/p', '/Users/annayang')).toBe(
      '/p/-Users-annayang--claude-dashboard-runner',
    );
  });
});
