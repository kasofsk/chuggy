/**
 * What the first evaluation of a work cycle reads of the stack the finalizer
 * prepared for it. The ticket service chooses nothing here and writes nothing.
 *
 * A PREPARED CYCLE IS READ, AND AN UNPREPARED ONE WAITS. A cycle left a record
 * runs over it; a cycle decided unstacked, or whose ticket is not Stacked, runs
 * unstacked. A Stacked cycle with neither is not yet prepared, so its spawn is
 * deferred, `stackDeferralPassesMax` passes at most, and after those it runs
 * unstacked. A cycle that already has an evaluation registered is unstacked
 * whatever is later written for it, because the finalizer writes nothing for a
 * cycle that has begun evaluating.
 *
 * KNOWN LIMIT. The finalizer's check that a cycle has not begun evaluating and
 * its write are one transaction, and the spawn that begins an evaluation is
 * another, so a preparation committed in the instant between a spawn's read and
 * its commit leaves a record for a cycle that ran unstacked. Such an evaluation
 * lands as a re-check, because its merge result is not the recorded tree.
 */

import type { TicketId } from "../domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
} from "./evaluationStack.ts";
import type { Partition } from "./projectStore.ts";
import type { TicketBriefPort } from "./ticketBrief.ts";
import { stackDeferralPassesMax } from "./ticketService.ts";

/** What a spawn finds of its cycle's stack. */
export type StackSpawned =
  | { readonly stack: "Stack"; readonly record: EvaluationStack }
  | { readonly stack: "Unstacked" }
  | { readonly stack: "Pending" };

export interface EvaluationStackSpawn {
  spawned(input: {
    readonly partition: Partition;
    readonly ticket: TicketId;
    readonly cycle: number;
    readonly deferredPasses: number;
  }): Promise<StackSpawned>;
}

export interface EvaluationStackSpawnPorts {
  readonly store: Pick<EvaluationStackStore, "decision" | "evaluated">;
  readonly briefs: TicketBriefPort;
}

export function evaluationStackSpawn(
  ports: EvaluationStackSpawnPorts,
): EvaluationStackSpawn {
  return {
    spawned: async ({ partition, ticket, cycle, deferredPasses }) => {
      const decision = await ports.store.decision(partition, ticket, cycle);
      if (decision?.decided === "Stack")
        return { stack: "Stack", record: decision.record };
      if (decision !== undefined) return { stack: "Unstacked" };
      if (await ports.store.evaluated(partition, ticket, cycle))
        return { stack: "Unstacked" };
      const brief = await ports.briefs.brief(partition, ticket);
      const stacked =
        brief?.finalization?.kind === "GitMerge" &&
        brief.finalization.policy === "Stacked";
      return stacked && deferredPasses < stackDeferralPassesMax
        ? { stack: "Pending" }
        : { stack: "Unstacked" };
    },
  };
}
