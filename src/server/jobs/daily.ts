import type { StateStore } from '../state';

/** A job that should run at most once per local calendar day. Must be safe to repeat, since a
 * crash between running it and recording the day runs it again. */
export interface DailyJob {
  /** Key in state.json `jobs`; never rename once shipped, or the job runs again that day. */
  name: string;
  run(): Promise<unknown>;
}

export interface DailyJobsOptions {
  jobs: DailyJob[];
  state: Pick<StateStore, 'jobDay' | 'setJobDay'>;
  /** How often to check for jobs not yet done today. */
  intervalMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface DailyJobs {
  /** One pass: runs every job not yet done today, one at a time. A pass already in progress is
   * joined, never doubled. */
  tick(): Promise<void>;
  /** Ticks now, then every `intervalMs`. Resolves after the first pass. */
  start(): Promise<void>;
  stop(): void;
}

/** Every 6 hours by default (`jobs.dailyIntervalHours`): a server that stays up past midnight
 * catches the new day within 6 h. */
export const DAILY_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Local calendar day as YYYY-MM-DD: "today" means the user's day, not UTC's. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Runs daily jobs on start and every 6 h, skipping any already done today (ADR 0031). A failed
 * job is logged and not recorded, so the next pass tries it again. */
export function createDailyJobs(opts: DailyJobsOptions): DailyJobs {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.warn(`[jobs] ${m}`));
  let running: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function pass(): Promise<void> {
    for (const job of opts.jobs) {
      const today = localDay(now());
      if (opts.state.jobDay(job.name) === today) continue;
      try {
        await job.run();
      } catch (err) {
        log(`${job.name} failed: ${(err as Error).message}; retrying on the next pass`);
        continue;
      }
      try {
        await opts.state.setJobDay(job.name, today);
      } catch (err) {
        log(`${job.name} ran but could not be recorded: ${(err as Error).message}`);
      }
    }
  }

  function tick(): Promise<void> {
    running ??= pass().finally(() => (running = null));
    return running;
  }

  return {
    tick,
    async start() {
      await tick();
      timer ??= setInterval(() => void tick(), opts.intervalMs ?? DAILY_INTERVAL_MS);
      // Never the reason the process stays alive.
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
