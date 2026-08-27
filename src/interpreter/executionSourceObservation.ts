/**
 * What a ticket's work is observed against: the project's binding, narrowed by
 * the configuration's handoff role and then by the ticket's own branch, which
 * is the most specific of the three and therefore the last word. An evaluation
 * is observed against the work instead, because what it judges is what the work
 * produced rather than what the work was handed.
 */

import {
  repositoryBindingNarrowed,
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
      const project = await bindings.binding(request.partition);
      if (project === undefined)
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      const work = executionSourceConfiguredWork(
        request.configurationCanonical,
      );
      const repository: RepositoryBinding = repositoryBindingNarrowed(
        {
          ...project,
          ...(work === undefined ? {} : { repository: work.repository }),
          ...(work === undefined ? {} : { targetRef: work.targetRef }),
          ...(work === undefined
            ? {}
            : { credentialReference: work.credentialReference }),
        },
        request.ref,
      );
      const observed = await git.observeTarget(repository);
      return observed.observed === "Target"
        ? {
            observed: "Source",
            source: {
              repository: repository.repository,
              target: observed.target,
              manifests: [],
            },
          }
        : observed;
    },
  };
}
