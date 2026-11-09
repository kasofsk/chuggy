/**
 * What a Stacked ticket's evaluation runs over, decided when the first
 * evaluation of a work cycle spawns and read, never decided again, by every
 * spawn after it.
 *
 * A CYCLE'S STACK IS CHOSEN ONCE. The first spawn computes `stackFor` from the
 * queue, mints the stack commit and hands back the record to be written with
 * that spawn's own decision. A cycle that has already started an evaluation
 * keeps what it started with, so a later stage, a re-ask of a blocked evaluator
 * and a re-preparation read the record, and where there is none the cycle was
 * evaluated unstacked and stays so.
 *
 * A STACK THAT CANNOT BE MINTED IS NO STACK. A merge that conflicts, a push the
 * remote refuses, a target or an object that cannot be read: the evaluation
 * runs unstacked over the candidate's accepted commit, nothing is recorded and
 * no failure is counted.
 */

import type { TicketId } from "../domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
} from "./evaluationStack.ts";
import {
  asGitRefName,
  repositoryTargetObserved,
  type GitObjectId,
  type GitPromotionPort,
  type GitRefName,
  type RepositoryId,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import { stackFor } from "./stackChoice.ts";
import { briefLandsOn, type TicketBriefPort } from "./ticketBrief.ts";

/** The ref a cycle's stack commit is published at, which a plain clone fetches. */
export function stackRefOf(ticket: number, cycle: number): GitRefName {
  return asGitRefName(
    `refs/heads/chuggy/stack/${String(ticket)}/${String(cycle)}`,
  );
}

/** The stack a spawn's evaluation runs over, and whether this spawn is the one to record it. */
export interface StackedEvaluation {
  readonly record: EvaluationStack;
  readonly fresh: boolean;
}

export interface EvaluationStacking {
  stackOf(input: {
    readonly partition: Partition;
    readonly ticket: TicketId;
    readonly cycle: number;
    readonly repository: RepositoryId;
    /** The commit the candidate's work was accepted at. */
    readonly commit: GitObjectId;
  }): Promise<StackedEvaluation | undefined>;
}

export interface EvaluationStackingPorts {
  readonly store: Pick<
    EvaluationStackStore,
    "read" | "evaluated" | "queue" | "stackFailures"
  >;
  readonly briefs: TicketBriefPort;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly git: Pick<GitPromotionPort, "observeTarget" | "mintStack">;
}

export function evaluationStacking(
  ports: EvaluationStackingPorts,
): EvaluationStacking {
  return {
    stackOf: async (input) => {
      const { partition, ticket, cycle, repository, commit } = input;
      const recorded = await ports.store.read(partition, ticket, cycle);
      if (recorded !== undefined) return { record: recorded, fresh: false };
      if (await ports.store.evaluated(partition, ticket, cycle))
        return undefined;
      const brief = await ports.briefs.brief(partition, ticket);
      if (
        brief?.finalization?.kind !== "GitMerge" ||
        brief.finalization.policy !== "Stacked"
      )
        return undefined;
      const binding = await ports.bindings.binding(partition, repository);
      if (binding === undefined) return undefined;
      const target = briefLandsOn(brief);
      const observed = await repositoryTargetObserved(
        ports.git,
        binding,
        target,
      );
      if (observed.observed !== "Target") return undefined;
      const read = await Promise.all([
        ports.store.queue(partition, repository, target),
        ports.store.stackFailures(partition, ticket),
      ]).catch((): undefined => undefined);
      if (read === undefined) return undefined;
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
      if (beneath === undefined) return undefined;
      const minted = await ports.git.mintStack({
        repository: binding,
        tip: observed.target,
        beneath: beneath.map((member) => member.commit),
        candidate: commit,
        ref: stackRefOf(ticket, cycle),
      });
      if (minted.minted !== "Stack") return undefined;
      return {
        record: {
          ticket,
          cycle,
          repository,
          target: observed.target.ref,
          tip: observed.target.commit,
          beneath,
          stackCommit: minted.commit,
          stackTree: minted.tree,
        },
        fresh: true,
      };
    },
  };
}
