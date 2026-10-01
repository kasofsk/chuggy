/**
 * A live binding the project holds no configuration for, and its configuration
 * step asked for again.
 *
 * Why the step last deferred is not stored, so the row says only that it did
 * until a retry answers with a reason. A retry that leaves the project holding
 * a configuration, or meets the binding retired, redraws the listing.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { apiConfigureProjectRepository } from "../../core/apiRoutes.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import {
  repositoryConfigureStatus,
  type RepositoryStepStatus,
} from "../../core/projectRepositories.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Pill } from "../ui/Pill.tsx";
import { projectRepositoriesResource } from "./AddRepository.tsx";

/** One retry, from the request it sends to the status it leaves on the row. */
function useBindingConfigurationsRetry(
  partition: PartitionIdentity,
  repository: string,
): {
  readonly status: RepositoryStepStatus;
  readonly busy: boolean;
  readonly retry: () => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [status, setStatus] = useState<RepositoryStepStatus>({
    status: "Deferred",
    retry: true,
  });
  const [busy, setBusy] = useState(false);
  return {
    status,
    busy,
    retry: () => {
      setBusy(true);
      void (async () => {
        const answered = await apiConfigureProjectRepository(ports, partition, {
          repository,
        });
        setBusy(false);
        setStatus(repositoryConfigureStatus(answered));
        const redrawn =
          answered.outcome === "Ok" ||
          (answered.outcome === "Conflict" &&
            answered.code === "RepositoryRetired");
        if (!redrawn) return;
        await client.invalidateQueries({
          queryKey: projectResourceKey(
            partition,
            "Project",
            projectRepositoriesResource,
          ),
        });
      })();
    },
  };
}

export function BindingConfigurations(props: {
  readonly partition: PartitionIdentity;
  readonly repository: string;
}): ReactNode {
  const step = useBindingConfigurationsRetry(props.partition, props.repository);
  return (
    <>
      <span role="status">
        <Pill tone="parked">{step.status.status}</Pill>
      </span>
      {step.status.retry ? (
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
