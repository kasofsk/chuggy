import type { GitPromotionPort, RepositoryBinding } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import { authoredHandoffConfigurationReadiness } from "./handoffConfiguration.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import type {
  ExecutionSourceObservation,
  ExecutionSourceObservationPort,
} from "./executionSource.ts";

export interface ExecutionSourceHistoryPort {
  workSource(
    partition: Partition,
    ticket: number,
  ): Promise<ExecutionSourceObservation | undefined>;
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
        const source = await history.workSource(
          request.partition,
          request.ticket,
        );
        if (source !== undefined) return { observed: "Source", source };
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      }
      const project = await bindings.binding(request.partition);
      if (project === undefined)
        return { observed: "Unreadable", evidence: "RefUnreadable" };
      const work = executionSourceConfiguredWork(
        request.configurationCanonical,
      );
      const repository: RepositoryBinding = {
        ...project,
        ...(work === undefined ? {} : { repository: work.repository }),
        ...(work === undefined ? {} : { targetRef: work.targetRef }),
        ...(work === undefined
          ? {}
          : { credentialReference: work.credentialReference }),
      };
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
