import type { ExecutionSchedulerConfig } from "./executionScheduler.ts";
import type { Partition } from "./projectStore.ts";
import type { ExecutionContextRead } from "./schedulerContext.ts";
import type { SelectorOperationalContext } from "./selector.ts";
import type { SelectorProposalReviewStore } from "./selectorReview.ts";

export interface SelectorContextClock {
  now(): { readonly instant: string; readonly epochMilliseconds: number };
}

export interface SelectorOperationalContextConfig {
  readonly reviewFeedbackMax: number;
  readonly projectBacklogMax: ExecutionSchedulerConfig["projectBacklogMax"];
  readonly installationBacklogMax: ExecutionSchedulerConfig["installationBacklogMax"];
}

export interface SelectorOperationalContextRead {
  context(partition: Partition): Promise<SelectorOperationalContext>;
}

function checkedBound(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new RangeError(`${name} must be between 1 and 100`);
  return value;
}

/** Joins selector-owned feedback to one scheduler-owned project observation. */
export function selectorOperationalContextRead(
  execution: ExecutionContextRead,
  reviews: Pick<SelectorProposalReviewStore, "reviewFeedback">,
  clock: SelectorContextClock,
  config: SelectorOperationalContextConfig,
): SelectorOperationalContextRead {
  const reviewFeedbackMax = checkedBound(
    config.reviewFeedbackMax,
    "selector review feedback bound",
  );
  return {
    context: async (partition) => {
      const observed = clock.now();
      const [scheduler, reviewFeedback] = await Promise.all([
        execution.context(partition),
        reviews.reviewFeedback(partition, undefined, reviewFeedbackMax),
      ]);
      return {
        version: 2,
        observedAt: observed.instant,
        observedAtEpochMs: observed.epochMilliseconds,
        reviewFeedback,
        activeWork: {
          queued: scheduler.activeWork.queued,
          admitted: scheduler.activeWork.admitted,
          launching: scheduler.activeWork.launching,
          running: scheduler.activeWork.running,
        },
        capacity: { account: scheduler.account, ...scheduler.capacity },
        backlog: {
          project: {
            queued: scheduler.backlog.project,
            ceiling: config.projectBacklogMax,
          },
          installation: {
            queued: scheduler.backlog.installation,
            ceiling: config.installationBacklogMax,
          },
        },
      };
    },
  };
}
