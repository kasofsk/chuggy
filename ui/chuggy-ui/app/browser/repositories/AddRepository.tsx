/**
 * Adding a repository: what the tenant's portal installations grant, marked
 * against what this project already binds and against what the worker app was
 * read not to grant, and what choosing one came to.
 *
 * A refusal is one line under the roster and never a second dialog, because
 * the choice that earned it is still on screen and is what the reader would go
 * back to.
 *
 * WHAT AN INSTALLATION GRANTS IS CHANGED ON THE FORGE, so the roster carries
 * the way there under it: the portal app's own page for a repository it does
 * not list, and the worker app's for one a row marks. Each is the install link
 * the page draws, returning to this picker open, where the roster is read
 * again.
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
import type { ForgeAppName } from "../../../../../src/contract/rosters.ts";
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
  repositoriesWorkerless,
  repositoryAddReturnPath,
  repositoryBindNote,
  repositoryBindOutcome,
  repositoryChoices,
  repositoryGrantLines,
  repositoryWorkerMissing,
} from "../../core/projectRepositories.ts";
import type {
  InstallationGrant,
  RepositoryChoice,
  RepositoryNote,
} from "../../core/projectRepositories.ts";
import type { WorkRunner } from "../../core/workRunner.ts";
import { useApiPorts, usePanelResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { currentPath, drawBytes } from "../ports.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Notice } from "../ui/Notice.tsx";
import { SearchableRoster } from "../ui/SearchableRoster.tsx";
import { InstallLink } from "./InstallLink.tsx";
import { RepositoryNextStep } from "./RepositoryNextStep.tsx";

/** No frame names either read, so the partition's own refetch is what reaches
 * them: a bind raises none, so the bindings key is invalidated by the bind. */
export const forgeReachableResource = "forge-reachable";
export const projectRepositoriesResource = "project-repositories";

interface Reachable {
  readonly repositories: readonly ForgeRepositoryResponse[];
  readonly truncated: boolean;
  /** The addresses among them the worker app was read not to grant. */
  readonly workerless: readonly string[];
}

/** What one installation grants, under the account its claim names. */
async function readGrant(
  ports: ApiPorts,
  tenant: string,
  installation: ForgeInstallationResponse,
): Promise<ApiResult<InstallationGrant>> {
  const answered = await apiForgeInstallationRepositories(
    ports,
    tenant,
    installation.installationId,
  );
  if (answered.outcome !== "Ok") return answered;
  return {
    outcome: "Ok",
    value: { account: installation.account, ...answered.value },
  };
}

/**
 * What the worker installations grant, one that does not answer `Ok` left out.
 * The roster is the portal app's, so a worker listing that was not read takes
 * nothing down and marks no row.
 */
async function readWorkerGrants(
  ports: ApiPorts,
  tenant: string,
  workers: readonly ForgeInstallationResponse[],
): Promise<readonly InstallationGrant[]> {
  const granted: InstallationGrant[] = [];
  for (const installation of workers) {
    const answered = await readGrant(ports, tenant, installation);
    if (answered.outcome === "Ok") granted.push(answered.value);
  }
  return granted;
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
  workers: readonly ForgeInstallationResponse[],
): Promise<ApiResult<Reachable>> {
  const portal: InstallationGrant[] = [];
  for (const installation of installations) {
    const answered = await readGrant(ports, tenant, installation);
    if (answered.outcome !== "Ok") return answered;
    portal.push(answered.value);
  }
  const worker = await readWorkerGrants(ports, tenant, workers);
  return {
    outcome: "Ok",
    value: {
      repositories: portal.flatMap((grant) => grant.repositories),
      truncated: portal.some((grant) => grant.truncated),
      workerless: repositoriesWorkerless(portal, worker),
    },
  };
}

function RepositoryChoiceRow(props: {
  readonly choice: RepositoryChoice;
  readonly busy: boolean;
  readonly onChoose: (choice: RepositoryChoice) => void;
}): ReactNode {
  const choice = props.choice;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
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
      {choice.workerless ? (
        <span className="text-sm text-tone-parked">
          {repositoryWorkerMissing}
        </span>
      ) : null}
    </span>
  );
}

/** One line about a repository an app's installation does not grant, with that
 * app's own page on the forge beside it, returning to this picker open. */
function RepositoryGrant(props: {
  readonly tenant: string;
  readonly app: ForgeAppName;
}): ReactNode {
  const line = repositoryGrantLines[props.app];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Notice
        tone={props.app === "worker" ? "parked" : "info"}
        inline
        detail={line.status}
      />
      <InstallLink
        tenant={props.tenant}
        returnPath={repositoryAddReturnPath(currentPath())}
        app={props.app}
        label={line.label}
      />
    </div>
  );
}

/** One bind, from the identity it spends to the line it leaves behind. */
function useRepositoryBind(partition: PartitionIdentity): {
  readonly note: RepositoryNote | undefined;
  readonly busy: boolean;
  readonly bind: (choice: RepositoryChoice) => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [note, setNote] = useState<RepositoryNote | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  return {
    note,
    busy,
    bind: (choice) => {
      setBusy(true);
      setNote(undefined);
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
        setNote(repositoryBindNote(outcome));
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
  readonly workers: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
  readonly runner: WorkRunner;
}): ReactNode {
  const partition = props.partition;
  const installations = props.installations;
  const workers = props.workers;
  const state = usePanelResource(
    partition,
    "Project",
    forgeReachableResource,
    (ports) => readReachable(ports, partition.tenant, installations, workers),
  );
  const binding = useRepositoryBind(partition);
  return (
    <>
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <SearchableRoster
          label="Filter"
          rows={repositoryChoices(
            state.value.repositories,
            props.bound,
            state.value.workerless,
          )}
          textOf={(choice) => choice.repository.fullName}
          keyOf={(choice) => choice.repository.url}
          renderRow={(choice) => (
            <RepositoryChoiceRow
              choice={choice}
              busy={binding.busy}
              onChoose={binding.bind}
            />
          )}
        />
      ) : null}
      {state.state === "Ready" && state.value.truncated ? (
        <Notice tone="parked" inline detail={repositoriesTruncated} />
      ) : null}
      {state.state === "Ready" ? (
        <RepositoryGrant tenant={partition.tenant} app="portal" />
      ) : null}
      {state.state === "Ready" && state.value.workerless.length > 0 ? (
        <RepositoryGrant tenant={partition.tenant} app="worker" />
      ) : null}
      {binding.note === undefined ? null : (
        <Notice tone="info" inline detail={binding.note.status} role="status">
          <RepositoryNextStep
            partition={partition}
            ticketOffered={binding.note.ticketOffered}
            runner={props.runner}
          />
        </Notice>
      )}
    </>
  );
}

export function AddRepository(props: {
  readonly partition: PartitionIdentity;
  /** The portal app's claims, which are what the roster is read under. */
  readonly installations: readonly ForgeInstallationResponse[];
  /** The worker app's claims on the same accounts, read to mark its rows. */
  readonly workers: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
  /** Whether the project's work has a runner to go to, which a bind's next step turns on. */
  readonly runner: WorkRunner;
  /** The page's own state, because the page opens this from more than its trigger. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const offered = props.installations.length > 0;
  return (
    <Dialog
      title="Add"
      trigger="Add"
      triggerDisabled={!offered}
      open={props.open && offered}
      onOpenChange={props.onOpenChange}
    >
      <AddRepositoryBody
        partition={props.partition}
        installations={props.installations}
        workers={props.workers}
        bound={props.bound}
        runner={props.runner}
      />
    </Dialog>
  );
}
