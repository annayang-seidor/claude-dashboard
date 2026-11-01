import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDailyJobs, localDay, type DailyJob } from './daily';

const HOUR = 60 * 60 * 1000;

/** In-memory stand-in for the state store's job days. */
function fakeState(days: Record<string, string> = {}) {
  return {
    days,
    jobDay: (name: string) => days[name],
    setJobDay: async (name: string, day: string) => void (days[name] = day),
  };
}

function job(name: string, run: () => Promise<unknown> = async () => {}) {
  return { name, run: vi.fn(run) } satisfies DailyJob;
}

afterEach(() => vi.useRealTimers());

describe('localDay', () => {
  it('uses the local calendar day, not UTC', () => {
    expect(localDay(new Date(2026, 9, 24, 0, 30))).toBe('2026-10-24');
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('createDailyJobs', () => {
  it('runs each job once a day and records the day', async () => {
    let now = new Date(2026, 9, 24, 9, 0);
    const state = fakeState();
    const purge = job('trash-purge');
    const jobs = createDailyJobs({ jobs: [purge], state, now: () => now, log: () => {} });

    await jobs.tick();
    await jobs.tick();
    expect(purge.run).toHaveBeenCalledOnce();
    expect(state.days).toEqual({ 'trash-purge': '2026-10-24' });

    now = new Date(2026, 9, 25, 0, 5);
    await jobs.tick();
    expect(purge.run).toHaveBeenCalledTimes(2);
    expect(state.days['trash-purge']).toBe('2026-10-25');
  });

  it('skips a job already done today before this process started', async () => {
    const purge = job('trash-purge');
    const jobs = createDailyJobs({
      jobs: [purge],
      state: fakeState({ 'trash-purge': '2026-10-24' }),
      now: () => new Date(2026, 9, 24, 18, 0),
    });
    await jobs.tick();
    expect(purge.run).not.toHaveBeenCalled();
  });

  it('does not record a failed job, retries it next pass, and still runs the others', async () => {
    const state = fakeState();
    const log = vi.fn();
    let fail = true;
    const flaky = job('flaky', async () => {
      if (fail) throw new Error('disk full');
    });
    const other = job('other');
    const jobs = createDailyJobs({
      jobs: [flaky, other],
      state,
      now: () => new Date(2026, 9, 24, 9, 0),
      log,
    });

    await jobs.tick();
    expect(other.run).toHaveBeenCalledOnce();
    expect(state.days).toEqual({ other: '2026-10-24' });
    expect(log).toHaveBeenCalledWith('flaky failed: disk full; retrying on the next pass');

    fail = false;
    await jobs.tick();
    expect(flaky.run).toHaveBeenCalledTimes(2);
    expect(other.run).toHaveBeenCalledOnce();
    expect(state.days.flaky).toBe('2026-10-24');
  });

  it('joins a pass already running instead of starting a second one', async () => {
    let release!: () => void;
    const slow = job('slow', () => new Promise<void>((r) => (release = r)));
    const jobs = createDailyJobs({
      jobs: [slow],
      state: fakeState(),
      now: () => new Date(2026, 9, 24, 9, 0),
    });
    const first = jobs.tick();
    const second = jobs.tick();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(slow.run).toHaveBeenCalledOnce();
  });

  it('start runs at once, then every 6 hours until stopped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 9, 0));
    const state = fakeState();
    const purge = job('trash-purge');
    const jobs = createDailyJobs({ jobs: [purge], state });

    await jobs.start();
    expect(purge.run).toHaveBeenCalledOnce();

    // Same day: the 6-hourly checks find nothing to do.
    await vi.advanceTimersByTimeAsync(12 * HOUR);
    expect(purge.run).toHaveBeenCalledOnce();

    // 03:00 the next day: the 6-hourly check runs it again.
    await vi.advanceTimersByTimeAsync(6 * HOUR);
    expect(purge.run).toHaveBeenCalledTimes(2);
    expect(state.days['trash-purge']).toBe('2026-10-25');

    jobs.stop();
    vi.setSystemTime(new Date(2026, 9, 27, 9, 0));
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(purge.run).toHaveBeenCalledTimes(2);
  });
});
