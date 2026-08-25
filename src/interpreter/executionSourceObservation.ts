import type { GitPromotionPort, RepositoryBinding } from "./finalizer.ts";
import type { Partition } from "./projectStore.ts";
import { authoredHandoffConfigurationReadiness } from "./handoffConfiguration.ts";
import { authoredBuildHandoffConfigurationReadiness } from "./buildHandoffConfiguration.ts";
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
  const parsed = JSON.parse(canonical) as unknown;
  const build = authoredBuildHandoffConfigurationReadiness(parsed);
  if (
    build.readiness === "Ready" &&
    build.configuration.source.kind === "AcceptedWork"
  )
    return {
      repository: build.configuration.source.git.repository,
      targetRef: build.configuration.source.git.targetRef,
      credentialReference: build.configuration.source.git.credentialReference,
    };
  const readiness = authoredHandoffConfigurationReadiness(parsed);
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
      const targetRef = request.ref ?? work?.targetRef;
      const credentialReference =
        request.credentialReference ?? work?.credentialReference;
      const repository: RepositoryBinding = {
        ...project,
        repository:
          request.repository ?? work?.repository ?? project.repository,
        ...(targetRef === undefined ? {} : { targetRef }),
        ...(credentialReference === undefined ? {} : { credentialReference }),
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
