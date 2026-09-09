/**
 * What a ticket's work is observed against: the binding of the repository the
 * ticket's brief names, narrowed by the configuration's handoff role and then
 * by the branch that brief says its work happens on, which is the most specific
 * of the three and therefore the last word. Where that work lands is the
 * brief's separate answer and the finalizer's to read. An evaluation is
 * observed against the work instead, because what it judges is what the work
 * produced rather than what the work was handed.
 *
 * A BRIEF NAMING NO REPOSITORY IS UNREADABLE RATHER THAN THE PROJECT'S OLDEST
 * BINDING. Migration 82 backfills every brief it left null, so a released
 * ticket's brief now names none only where its own project has never bound one,
 * or where the ticket carries no brief row at all — and there the
 * oldest-binding election this port used to fall back to would find nothing
 * either, so it is not asked.
 *
 * A BRANCH THE REMOTE DOES NOT HOLD YET IS WHERE THE WORK STARTS, NOT A FAILED
 * OBSERVATION. The base is the binding's own target, exactly as it is for a
 * brief naming no branch at all, and the source still names the ticket's
 * branch — which the finalizer's first promotion creates where the brief lands
 * its work there.
 */

import {
  repositoryTargetObserved,
  type GitObjectId,
  type GitPromotionPort,
  type RepositoryBinding,
  type RepositoryId,
} from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import { authoredHandoffConfigurationReadiness } from "./handoffConfiguration.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import type { ResultManifestId } from "./resultManifest.ts";
import type {
  ExecutionSourceObservation,
  ExecutionSourceObservationPort,
} from "./executionSource.ts";

/**
 * What the ticket's latest work spawn was given and what it produced: the base
 * it ran against, every commit its executions declared, and the manifests it
 * terminalized. The declarations are gathered rather than reduced, so a spawn
 * that declared more than one is visible here as more than one.
 */
export interface WorkSourceHistory {
  readonly repository: RepositoryId;
  readonly base: GitObjectId;
  readonly declared: readonly GitObjectId[];
  readonly manifests: readonly ResultManifestId[];
}

export interface ExecutionSourceHistoryPort {
  workSource(
    partition: Partition,
    ticket: number,
  ): Promise<WorkSourceHistory | undefined>;
}

/**
 * The commit an evaluation of that work runs on: the one commit the work
 * declared, or the base it ran against where it declared any other number.
 * A fan-out that declared several names no one tree and none of them may stand
 * for the rest, while the base is the tree every member of it started from and
 * every member's manifest reaches the evaluation regardless.
 */
function executionSourceEvaluated(
  work: WorkSourceHistory,
): ExecutionSourceObservation {
  const declared = work.declared.length === 1 ? work.declared[0] : undefined;
  return {
    repository: work.repository,
    target: { commit: declared ?? work.base },
    manifests: work.manifests,
  };
}

function executionSourceConfiguredWork(canonical: string | undefined):
  | {
      readonly repository: RepositoryBinding["repository"];
      readonly targetRef: NonNullable<RepositoryBinding["targetRef"]>;
      readonly credentialReference: string;
    }
  | undefined {
  if (canonical === undefined) return undefined;
  const readiness = authoredHandoffConfigurationReadiness(
    JSON.parse(canonical) as unknown,
  );
  if (readiness.readiness === "Incomplete") return undefined;
  return {
    repository: readiness.configuration.work.repository,
    targetRef: readiness.configuration.work.targetRef,
    credentialReference: readiness.configuration.work.credential,
  };
}

export function executionSourceObservation(
  bindings: ProjectRepositoryBindingRead,
  git: Pick<GitPromotionPort, "observeTarget">,
  history: ExecutionSourceHistoryPort,
): ExecutionSourceObservationPort {
  return {
    observe: async (request) => {
      if (request.kind === "Evaluation") {
        const work = await history.workSource(
          request.partition,
          request.ticket,
        );
        if (work === undefined)
          return { observed: "Unreadable", evidence: "RefUnreadable" };
        return { observed: "Source", source: executionSourceEvaluated(work) };
      }
      if (request.repository === undefined)
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      const bound = await bindings.binding(
        request.partition,
        request.repository,
      );
      if (bound === undefined)
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      const work = executionSourceConfiguredWork(
        request.configurationCanonical,
      );
      const repository: RepositoryBinding = {
        ...bound,
        ...(work === undefined ? {} : { repository: work.repository }),
        ...(work === undefined ? {} : { targetRef: work.targetRef }),
        ...(work === undefined
          ? {}
          : { credentialReference: work.credentialReference }),
      };
      const observed = await repositoryTargetObserved(
        git,
        repository,
        request.ref,
      );
      return observed.observed === "Target"
        ? {
            observed: "Source",
            source: {
              repository: repository.repository,
              target: {
                ref: observed.target.ref,
                commit: observed.target.commit,
              },
              manifests: [],
            },
          }
        : observed;
    },
  };
}
