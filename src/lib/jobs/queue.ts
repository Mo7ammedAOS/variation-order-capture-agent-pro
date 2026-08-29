/**
 * The background job boundary.
 *
 * BullMQ + Redis is the accepted engine (ADR 0001), but Phase 1 runs the
 * in-memory driver so the app starts with no Redis at all. Flipping
 * JOB_DRIVER=bullmq is the whole migration.
 *
 * Jobs own COMMERCIAL TIMING — when a notice deadline is near, when a task is
 * overdue, when a follow-up is due. That logic lives here and never in n8n:
 * "Do not place core reminder logic only inside n8n." n8n delivers the message
 * once this side has decided there is one to send.
 */

export type JobName =
  | 'notice-deadline'
  | 'reminder'
  | 'escalation'
  | 'client-followup'
  | 'approved-unbilled'
  | 'payment-overdue'
  | 'weekly-report'
  | 'ai-processing'
  | 'index-potential-change';

export interface JobPayloadMap {
  'notice-deadline': Record<string, never>;
  reminder: Record<string, never>;
  escalation: Record<string, never>;
  'client-followup': Record<string, never>;
  'approved-unbilled': Record<string, never>;
  'payment-overdue': Record<string, never>;
  'weekly-report': Record<string, never>;
  'ai-processing': { documentId: string };
  'index-potential-change': { potentialChangeId: string };
}

export type JobHandler<TName extends JobName> = (payload: JobPayloadMap[TName]) => Promise<void>;

export interface JobQueue {
  readonly name: string;
  enqueue<TName extends JobName>(job: TName, payload: JobPayloadMap[TName]): Promise<void>;
  register<TName extends JobName>(job: TName, handler: JobHandler<TName>): void;
  /** Runs everything pending. The in-memory driver needs this; BullMQ does not. */
  drain(): Promise<void>;
}

/**
 * In-memory driver.
 *
 * Runs handlers on the next tick, in this process. Nothing survives a restart —
 * which is fine for Phase 1, where the only enqueued work is re-indexing an
 * embedding, and wrong for anything whose loss would be commercially material.
 * That is precisely why the notice-deadline sweep is a scheduled scan over the
 * database rather than a queued job per deadline: the database is the state,
 * and a restart cannot lose a deadline that was never in a queue.
 */
export class InMemoryJobQueue implements JobQueue {
  readonly name = 'memory';
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();
  private pending: Promise<void>[] = [];

  register<TName extends JobName>(job: TName, handler: JobHandler<TName>): void {
    this.handlers.set(job, handler as JobHandler<JobName>);
  }

  async enqueue<TName extends JobName>(job: TName, payload: JobPayloadMap[TName]): Promise<void> {
    const handler = this.handlers.get(job);
    if (!handler) return;

    const run = Promise.resolve()
      .then(() => handler(payload))
      .catch((error) => {
        // A failed background job must never take down the request that
        // enqueued it. The user's Potential Change is already saved.
        console.error(`[jobs] ${job} failed`, error);
      });

    this.pending.push(run);
  }

  async drain(): Promise<void> {
    const inFlight = this.pending;
    this.pending = [];
    await Promise.all(inFlight);
  }
}

let queue: JobQueue | undefined;

export function getJobQueue(): JobQueue {
  queue ??= new InMemoryJobQueue();
  return queue;
}

export function setJobQueue(next: JobQueue): void {
  queue = next;
}
