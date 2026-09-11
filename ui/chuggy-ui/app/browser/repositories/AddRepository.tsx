/**
 * Adding a repository: what the tenant's portal installations grant, marked
 * against what this project already binds, and what choosing one came to.
 *
 * A refusal is one line under the roster and never a second dialog, because
 * the choice that earned it is still on screen and is what the reader would go
 * back to.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ForgeInstallationResponse,
  ForgeRepositoryResponse,
  ProjectRepositoryResponse,
} from "../../../../../src/contract/responses.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import { base64urlFromBytes } from "../../core/base64url.ts";
import {
  apiBindProjectRepository,
  apiForgeInstallationRepositories,
} from "../../core/apiRoutes.ts";
import { operationIdBytesCount } from "../../core/operationFollow.ts";
import { projectResourceKey } from "../../core/projectQueryKeys.ts";
import {
  repositoriesTruncated,
  repositoryBindLines,
  repositoryBindOutcome,
  repositoryChoices,
} from "../../core/projectRepositories.ts";
import type { RepositoryChoice } from "../../core/projectRepositories.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Notice } from "../ui/Notice.tsx";

/** No frame names either read, so the partition's own refetch is what reaches
 * them: a bind raises none, so the bindings key is invalidated by the bind. */
export const forgeReachableResource = "forge-reachable";
export const projectRepositoriesResource = "project-repositories";

interface Reachable {
  readonly repositories: readonly ForgeRepositoryResponse[];
  readonly truncated: boolean;
}

/**
 * What every portal installation the tenant holds grants, read one after
 * another: a listing that is partial makes the whole roster partial, because a
 * repository the reader cannot find may be in the part that was not answered.
 * The first installation that does not answer `Ok` therefore takes the whole
 * roster down deliberately, so one revoked claim is read as a refusal rather
 * than as a roster silently missing the account it covered.
 */
async function readReachable(
  ports: ApiPorts,
  tenant: string,
  installations: readonly ForgeInstallationResponse[],
): Promise<ApiResult<Reachable>> {
  const repositories: ForgeRepositoryResponse[] = [];
  let truncated = false;
  for (const installation of installations) {
    const answered = await apiForgeInstallationRepositories(
      ports,
      tenant,
      installation.installationId,
    );
    if (answered.outcome !== "Ok") return answered;
    repositories.push(...answered.value.repositories);
    truncated = truncated || answered.value.truncated;
  }
  return { outcome: "Ok", value: { repositories, truncated } };
}

function RepositoryChoiceRow(props: {
  readonly choice: RepositoryChoice;
  readonly busy: boolean;
  readonly onChoose: (choice: RepositoryChoice) => void;
}): ReactNode {
  const choice = props.choice;
  return (
    <li className="flex items-center gap-2">
      <Button
        size="sm"
        variant="quiet"
        disabled={props.busy}
        onClick={() => {
          props.onChoose(choice);
        }}
      >
        {choice.repository.fullName}
      </Button>
      {choice.bound ? <span className="text-sm text-ink-3">Bound</span> : null}
    </li>
  );
}

/** One bind, from the identity it spends to the lines it leaves behind. */
function useRepositoryBind(partition: PartitionIdentity): {
  readonly lines: readonly string[];
  readonly busy: boolean;
  readonly bind: (choice: RepositoryChoice) => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [lines, setLines] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  return {
    lines,
    busy,
    bind: (choice) => {
      setBusy(true);
      setLines([]);
      void (async () => {
        const outcome = repositoryBindOutcome(
          await apiBindProjectRepository(
            ports,
            partition,
            { repository: choice.repository.url },
            base64urlFromBytes(drawBytes(operationIdBytesCount)),
          ),
        );
        setBusy(false);
        setLines(repositoryBindLines(outcome));
        if (outcome.outcome === "Refused") return;
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

function AddRepositoryBody(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
}): ReactNode {
  const partition = props.partition;
  const installations = props.installations;
  const state = usePanelResource(
    partition,
    "Project",
    forgeReachableResource,
    (ports) => readReachable(ports, partition.tenant, installations),
  );
  const binding = useRepositoryBind(partition);
  return (
    <>
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <ul className="grid gap-1">
          {repositoryChoices(state.value.repositories, props.bound).map(
            (choice) => (
              <RepositoryChoiceRow
                key={choice.repository.url}
                choice={choice}
                busy={binding.busy}
                onChoose={binding.bind}
              />
            ),
          )}
        </ul>
      ) : null}
      {state.state === "Ready" && state.value.truncated ? (
        <Notice tone="parked" inline detail={repositoriesTruncated} />
      ) : null}
      {binding.lines.map((line) => (
        <Notice key={line} tone="info" inline detail={line} role="status" />
      ))}
    </>
  );
}

export function AddRepository(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      title="Add"
      trigger="Add"
      triggerDisabled={props.installations.length === 0}
      open={open}
      onOpenChange={setOpen}
    >
      <AddRepositoryBody
        partition={props.partition}
        installations={props.installations}
        bound={props.bound}
      />
    </Dialog>
  );
}
