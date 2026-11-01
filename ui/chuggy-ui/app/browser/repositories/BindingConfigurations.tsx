/**
 * A live binding the project holds no configuration for, and its configuration
 * step asked for again.
 *
 * Why the step last deferred is not stored, so the row says only that it did
 * until a retry answers with a reason. A retry the route answers, or one that
 * meets the binding retired, redraws the listing.
 */

import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiConfigureProjectRepository } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { projectRepositoriesInvalidated } from "../../core/projectQueries.ts";
import {
  repositoryConfigureStatus,
  type RepositoryStepStatus,
} from "../../core/projectRepositories.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { useProjectAbilities } from "../projectAbilities.tsx";
import { Button } from "../ui/Button.tsx";
import { Pill } from "../ui/Pill.tsx";

/** What the row draws before a retry has answered. */
const bindingConfigurationsDeferred: RepositoryStepStatus = {
  status: "Deferred",
  retry: true,
};

/** One retry, from the request it sends to the status it leaves on the row. A
 * binding found retired is no refusal of it, because the listing redrawn says so. */
function bindingConfigurationsRetryWrite(
  partition: PartitionIdentity,
  repository: string,
): ConsoleWrite<undefined, RepositoryStepStatus> {
  return {
    mutationKey: consoleWriteKey(
      "repository-configure",
      partition.tenant,
      partition.project,
      repository,
    ),
    write: async (ports) => {
      const answered = await apiConfigureProjectRepository(ports, partition, {
        repository,
      });
      const retired =
        answered.outcome === "Conflict" &&
        answered.code === "RepositoryRetired";
      if (answered.outcome !== "Ok" && !retired) return answered;
      return { outcome: "Ok", value: repositoryConfigureStatus(answered) };
    },
    refusal: (failure) => repositoryConfigureStatus(failure).status,
    landed: (client) => projectRepositoriesInvalidated(client, partition),
  };
}

function useBindingConfigurationsRetry(
  partition: PartitionIdentity,
  repository: string,
): {
  readonly status: RepositoryStepStatus;
  readonly busy: boolean;
  readonly retry: () => void;
} {
  const retrying = useConsoleWrite(
    bindingConfigurationsRetryWrite(partition, repository),
  );
  const status =
    retrying.error === null
      ? (retrying.data ?? bindingConfigurationsDeferred)
      : { status: retrying.error.message, retry: true };
  return {
    status,
    busy: retrying.isPending,
    retry: () => {
      retrying.mutate(undefined);
    },
  };
}

export function BindingConfigurations(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
}): ReactNode {
  const step = useBindingConfigurationsRetry(props.partition, props.repository);
  const abilities = useProjectAbilities(props.partition);
  return (
    <>
      <span role="status">
        <Pill tone="parked">{step.status.status}</Pill>
      </span>
      {step.status.retry && !projectAbilityRefused(abilities, "administer") ? (
        <Button
          size="sm"
          variant="quiet"
          busy={step.busy}
          disabled={step.busy}
          onClick={step.retry}
        >
          Retry
        </Button>
      ) : null}
    </>
  );
}
