/**
 * What a Stacked ticket's evaluation runs over, decided by the finalizer once
 * per work cycle, before the cycle's first evaluation spawns, and read, never
 * decided again, by that spawn and every one after it.
 *
 * A CYCLE'S STACK IS CHOSEN ONCE. `stackPrepared` computes `stackFor` from the
 * queue, mints the stack commit, publishes it, and hands back what the finalizer
 * writes in one transaction: the record, or the reason the cycle is evaluated
 * unstacked. A cycle that has begun evaluating keeps what it began with.
 *
 * THE QUEUE IS READ BEFORE THE TIP, so a ticket that lands between the two
 * reads is beneath a tip that already holds it, which folds in as nothing,
 * rather than missing from a stack built on a tip before it.
 *
 * A STACK THAT CANNOT BE MINTED IS A DECISION, AND ONE THAT CANNOT BE ASKED
 * ABOUT IS NOT. A merge that conflicts, a push the remote refuses, a queue with
 * nothing to stack over, a failure cap and a barrier each leave the cycle
 * decided unstacked. A target nobody could read, or a queue too large to read,
 * leaves nothing, and the next pass asks again.
 */

import {
  stackRefOf,
  type EvaluationStackStore,
  type StackPrepared,
  type UnpreparedStack,
  type UnstackedReason,
} from "./evaluationStack.ts";
import {
  asRepositoryId,
  repositoryTargetObserved,
  type GitPromotionPort,
} from "./finalizer.ts";
import type { RecoveryEpoch } from "./projectStore.ts";
import { stackFor } from "./stackChoice.ts";
import { briefLandsOn, type TicketBriefPort } from "./ticketBrief.ts";

export interface EvaluationStackingPorts {
  readonly store: Pick<EvaluationStackStore, "queue" | "stackFailures">;
  readonly briefs: TicketBriefPort;
  readonly git: Pick<GitPromotionPort, "observeTarget" | "mintStack">;
}

async function queueRead(
  ports: EvaluationStackingPorts,
  due: UnpreparedStack,
  target: ReturnType<typeof briefLandsOn>,
) {
  return Promise.all([
    ports.store.queue(due.partition, due.repository, target),
    ports.store.stackFailures(due.partition, due.ticket),
  ]).catch((): undefined => undefined);
}

/**
 * What the cycle of a ticket whose work was accepted is to be left, or nothing
 * where the question cannot be answered now.
 */
export async function stackPrepared(
  ports: EvaluationStackingPorts,
  epoch: RecoveryEpoch,
  due: UnpreparedStack,
): Promise<StackPrepared | undefined> {
  const { partition, ticket, cycle, commit } = due;
  const brief = await ports.briefs.brief(partition, ticket);
  if (
    brief?.finalization?.kind !== "GitMerge" ||
    brief.finalization.policy !== "Stacked"
  )
    return undefined;
  const unstacked = (reason: UnstackedReason): StackPrepared => ({
    prepared: "Unstacked",
    ticket,
    cycle,
    reason,
  });
  const binding = {
    partition,
    repository: asRepositoryId(due.repository),
    recoveryEpoch: epoch,
  };
  const target = briefLandsOn(brief);
  const read = await queueRead(ports, due, target);
  if (read === undefined) return undefined;
  const observed = await repositoryTargetObserved(
    ports.git,
    binding,
    target,
  ).catch((): undefined => undefined);
  if (observed?.observed !== "Target") return undefined;
  const [queue, stackFailures] = read;
  const beneath = stackFor(
    {
      ticket,
      policy: "Stacked",
      stackFailures,
      rank: queue.find((entry) => entry.ticket === ticket)?.rank,
    },
    queue,
  );
  if (beneath === undefined) return unstacked("Unchosen");
  const minted = await ports.git
    .mintStack({
      repository: binding,
      tip: observed.target,
      beneath: beneath.map((member) => member.commit),
      candidate: commit,
      ref: stackRefOf(ticket, cycle),
    })
    .catch((): undefined => undefined);
  if (minted === undefined || minted.minted === "Failed")
    return unstacked("Unpublished");
  if (minted.minted === "Conflicted") return unstacked("Conflicted");
  return {
    prepared: "Stack",
    stack: {
      ticket,
      cycle,
      repository: due.repository,
      target: observed.target.ref,
      tip: observed.target.commit,
      beneath,
      stackCommit: minted.commit,
      stackTree: minted.tree,
    },
  };
}
