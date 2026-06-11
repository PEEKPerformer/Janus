import type { AiLensResult } from "./aiLens";
import { checkTextWithAiLens } from "./aiLensService";

/**
 * The single lane every AI Lens inference drives through. A 355M forward
 * pass owns the CPU/ANE while it runs, so concurrent checks (a tap during
 * an auto scan during a feed prefetch) would just fight each other. One
 * serialized queue with priorities instead:
 *
 *   0 tap       the user is literally waiting — jumps everything
 *   1 auto      thread-open checks and scans
 *   2 prefetch  speculative work; paced with breathers, first to be shed
 *
 * Anything already in the verdict cache resolves without queueing time
 * (the underlying check is cache-first), so re-enqueues are harmless.
 */

export type AiPriority = 0 | 1 | 2;

interface Job {
  text: string;
  priority: AiPriority;
  seq: number;
  resolve: (r: AiLensResult) => void;
  reject: (e: unknown) => void;
}

export interface AiQueue {
  /** Enqueue and await one judgement. */
  run(text: string, priority: AiPriority): Promise<AiLensResult>;
  /** Pending jobs (excluding the one running). */
  size(): number;
  /** Drop queued prefetch work (e.g. leaving the feed); rejects those jobs. */
  shedPrefetch(): void;
  /** Fires after each completed judgement — feeds re-read the verdict cache. */
  subscribe(fn: () => void): () => void;
}

export function createAiQueue(
  check: (text: string) => Promise<AiLensResult>,
  opts: {
    prefetchPaceMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): AiQueue {
  const pace = opts.prefetchPaceMs ?? 800;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const jobs: Job[] = [];
  const listeners = new Set<() => void>();
  let seq = 0;
  let running = false;

  const next = (): Job | undefined => {
    if (!jobs.length) return undefined;
    let best = 0;
    for (let i = 1; i < jobs.length; i++) {
      const a = jobs[i];
      const b = jobs[best];
      if (
        a.priority < b.priority ||
        (a.priority === b.priority && a.seq < b.seq)
      )
        best = i;
    }
    return jobs.splice(best, 1)[0];
  };

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = next(); job; job = next()) {
        try {
          job.resolve(await check(job.text));
        } catch (e) {
          job.reject(e);
        }
        listeners.forEach((fn) => fn());
        if (job.priority === 2 && jobs.length) await sleep(pace);
      }
    } finally {
      running = false;
      // A job enqueued during the final await would otherwise strand.
      if (jobs.length) void drain();
    }
  };

  return {
    run(text, priority) {
      return new Promise<AiLensResult>((resolve, reject) => {
        jobs.push({ text, priority, seq: seq++, resolve, reject });
        void drain();
      });
    },
    size: () => jobs.length,
    shedPrefetch() {
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i].priority === 2) {
          const [job] = jobs.splice(i, 1);
          job.reject(new Error("prefetch shed"));
        }
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The app-wide lane, bound to the real on-device check. */
export const aiQueue: AiQueue = createAiQueue(checkTextWithAiLens);
