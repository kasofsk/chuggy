/**
 * Adding a repository, which begins with which repository it is and names no
 * app before: one the address carries, one the person names, or one of what
 * the tenant's portal installations grant, marked against what this project
 * already binds and against what the worker app was read not to grant. Once
 * one is chosen the dialog is `ConnectRepository`'s, which keeps it in view
 * and offers choosing another.
 *
 * THE ROSTER IS READ WHEN A PERSON OPENS THE PICKER, AND AGAIN ON A CLOCK OF
 * ITS OWN WHILE IT STAYS OPEN, because the forge can be slow to list a grant
 * just made and nothing tells this console when it does. A listing costs the
 * forge a request whenever it is asked for, so an opening's own readings are
 * counted and stop, and none is made in a tab out of view;
 * `ui/chuggy-ui/app/core/projectRepositories.ts` names the pace and the count.
 * None is raised by the project's stream either, which reports nothing that
 * changes what an installation grants: the roster is held under the tenant's
 * key, which no frame and no refetch of the partition reaches.
 *
 * THE ROSTER IS DRAWN WHEN THE PORTAL APP'S LISTINGS ARE READ, and the worker
 * app's follow it: an opening's first reading writes what it has under its own
 * key before it asks for them. A row is marked once they answer and nothing is
 * drawn of them before.
 *
 * A READING THE PICKER MAKES BY ITSELF CHANGES WHAT IS DRAWN ONLY WHEN IT IS
 * WHOLE, so no row loses a mark to get it back. One that a listing did not
 * answer says nothing and is answered as the roster that stood, which leaves
 * no failure under the key for the next opening to draw.
 *
 * A ROW ONCE DRAWN KEEPS ITS PLACE UNTIL THE PICKER CLOSES, because a press
 * chooses at once and a row moved under the pointer between aim and press
 * chooses another repository. A reading's new rows are drawn after every row, and one
 * it no longer lists stands where it stood, saying so, and cannot be pressed.
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
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import { apiForgeInstallationRepositories } from "../../core/apiRoutes.ts";
import type { ForgeReturnWord } from "../../core/forgeReturn.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  repositoriesTruncated,
  repositoriesWorkerless,
  repositoryChoices,
  repositoriesDrawn,
  repositoryListingsRead,
  repositoryRosterRereadMs,
  repositoryUnlisted,
  repositoryWorkerMissing,
} from "../../core/projectRepositories.ts";
import type {
  ForgeReachable,
  InstallationGrant,
  RepositoryChoice,
  RepositoryDrawn,
} from "../../core/projectRepositories.ts";
import {
  repositoryConnectNamed,
  repositoryNamedLabel,
  repositoryNamedSame,
} from "../../core/repositoryConnect.ts";
import type {
  RepositoryConnectAsked,
  RepositoryNamed,
} from "../../core/repositoryConnect.ts";
import type { WorkRunner } from "../../core/workRunner.ts";
import { forgeReachableQuery } from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Input } from "../ui/Input.tsx";
import { Notice } from "../ui/Notice.tsx";
import { SearchableRoster } from "../ui/SearchableRoster.tsx";
import { ConnectRepository } from "./ConnectRepository.tsx";

function reachableOf(
  portal: readonly InstallationGrant[],
  worker: readonly InstallationGrant[] | undefined,
): ForgeReachable {
  return {
    repositories: portal.flatMap((grant) => grant.repositories),
    truncated: portal.some((grant) => grant.truncated),
    workerless:
      worker === undefined ? undefined : repositoriesWorkerless(portal, worker),
  };
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
  const answered = await repositoryListingsRead(workers, (installation) =>
    readGrant(ports, tenant, installation),
  );
  return answered.flatMap((one) => (one.outcome === "Ok" ? [one.value] : []));
}

/**
 * What every portal installation the tenant holds grants: a listing that is
 * partial makes the whole roster partial, because a repository the reader
 * cannot find may be in the part that was not answered. The first installation
 * in the tenant's order that does not answer `Ok` is therefore the answer for
 * them all, deliberately, so one revoked claim is read as a refusal rather
 * than as a roster silently missing the account it covered.
 */
async function readPortalGrants(
  ports: ApiPorts,
  tenant: string,
  installations: readonly ForgeInstallationResponse[],
): Promise<ApiResult<readonly InstallationGrant[]>> {
  const answered = await repositoryListingsRead(installations, (installation) =>
    readGrant(ports, tenant, installation),
  );
  const portal: InstallationGrant[] = [];
  for (const one of answered) {
    if (one.outcome !== "Ok") return one;
    portal.push(one.value);
  }
  return { outcome: "Ok", value: portal };
}

/** An opening's first reading: the portal app's roster handed to `drawn`
 * before the worker app's listings are asked for, then the roster they mark. */
async function readReachable(
  ports: ApiPorts,
  tenant: string,
  installations: readonly ForgeInstallationResponse[],
  workers: readonly ForgeInstallationResponse[],
  drawn: (roster: ForgeReachable) => void,
): Promise<ApiResult<ForgeReachable>> {
  const portal = await readPortalGrants(ports, tenant, installations);
  if (portal.outcome !== "Ok") return portal;
  drawn(reachableOf(portal.value, undefined));
  const worker = await readWorkerGrants(ports, tenant, workers);
  return { outcome: "Ok", value: reachableOf(portal.value, worker) };
}

/** A reading the open picker makes by itself: the whole roster, and nothing
 * where a listing of either app did not answer. */
async function rereadReachable(
  ports: ApiPorts,
  tenant: string,
  installations: readonly ForgeInstallationResponse[],
  workers: readonly ForgeInstallationResponse[],
): Promise<ForgeReachable | undefined> {
  const portal = await readPortalGrants(ports, tenant, installations);
  if (portal.outcome !== "Ok") return undefined;
  const worker = await readWorkerGrants(ports, tenant, workers);
  return worker.length === workers.length
    ? reachableOf(portal.value, worker)
    : undefined;
}

/** A row, which chooses its repository unless the latest reading no longer lists it. */
function RepositoryChoiceRow(props: {
  readonly choice: RepositoryChoice;
  readonly onChoose: (choice: RepositoryChoice) => void;
}): ReactNode {
  const text = useCopyText();
  const choice = props.choice;
  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <Button
        size="sm"
        variant="quiet"
        disabled={!choice.listed}
        onClick={() => {
          props.onChoose(choice);
        }}
      >
        {choice.repository.fullName}
      </Button>
      {choice.listed ? null : (
        <span className="text-sm text-ink-3">{text(repositoryUnlisted)}</span>
      )}
      {choice.bound ? (
        <span className="text-sm text-ink-3">
          {text({ id: "repositories-bound" })}
        </span>
      ) : null}
      {choice.workerless ? (
        <span className="text-sm text-tone-parked">
          {text(repositoryWorkerMissing)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The roster, read under the tenant's key when the picker opens and written
 * there as it arrives, then read again by itself while the picker stays open.
 * A read the picker abandoned by closing writes nothing, what it still hears
 * being older than whatever the next opening read.
 */
function useReachable(
  tenant: string,
  installations: readonly ForgeInstallationResponse[],
  workers: readonly ForgeInstallationResponse[],
): PanelState<ForgeReachable> {
  const client = useQueryClient();
  /** Whether this opening's first reading has drawn the portal app's roster,
   * which is what a reading made by itself stands on. */
  const [firstDrawn, setFirstDrawn] = useState(false);
  const [rereads, setRereads] = useState(0);
  const query = forgeReachableQuery(
    tenant,
    async (ports, signal, stood) => {
      if (firstDrawn && stood !== undefined) {
        setRereads((made) => made + 1);
        const whole = await rereadReachable(
          ports,
          tenant,
          installations,
          workers,
        );
        return { outcome: "Ok", value: whole ?? stood };
      }
      return readReachable(ports, tenant, installations, workers, (roster) => {
        if (signal.aborted) return;
        client.setQueryData(query.queryKey, roster);
        setFirstDrawn(true);
      });
    },
    firstDrawn ? repositoryRosterRereadMs(rereads) : undefined,
  );
  return usePanelState(query);
}

/**
 * The rows this opening of the picker has drawn, each reading laid over them
 * in the render that first sees it, so no frame draws a reading in its own
 * order. They are kept here and not under the tenant's key because they are
 * this opening's: the key holds each reading as the forge listed it, which is
 * what the next opening first draws, and closing the picker lets them go.
 */
function useRowsDrawn(
  read: readonly ForgeRepositoryResponse[] | undefined,
): readonly RepositoryDrawn[] {
  const [drawn, setDrawn] = useState<{
    readonly from: readonly ForgeRepositoryResponse[];
    readonly rows: readonly RepositoryDrawn[];
  }>();
  if (read === undefined || read === drawn?.from) return drawn?.rows ?? [];
  const rows = repositoriesDrawn(drawn?.rows ?? [], read);
  setDrawn({ from: read, rows });
  return rows;
}

/** The repository named by typing it: `owner/name`, or its address on the forge. */
function ConnectNamed(props: {
  readonly onChoose: (named: RepositoryNamed) => void;
}): ReactNode {
  const text = useCopyText();
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const named = repositoryConnectNamed(typed);
        setRefused(named === undefined);
        if (named !== undefined) props.onChoose(named);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          label={text({ id: "repositories-connect-name" })}
          placeholder={text({ id: "repositories-connect-name-hint" })}
          value={typed}
          invalid={refused}
          onChange={(value) => {
            setTyped(value);
            setRefused(false);
          }}
        />
        <Button size="sm" variant="primary" type="submit">
          {text({ id: "repositories-connect-next" })}
        </Button>
      </div>
      {refused ? (
        <Notice
          tone="danger"
          inline
          role="status"
          detail={text({ id: "repositories-connect-name-invalid" })}
        />
      ) : null}
    </form>
  );
}

/** The roster of what the tenant's portal installations grant, a row choosing its repository. */
function ConnectListed(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly workers: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
  readonly onChoose: (named: RepositoryNamed) => void;
}): ReactNode {
  const text = useCopyText();
  const state = useReachable(
    props.partition.tenant,
    props.installations,
    props.workers,
  );
  const drawn = useRowsDrawn(
    state.state === "Ready" ? state.value.repositories : undefined,
  );
  return (
    <>
      <p className="text-sm text-ink-3">
        {text({ id: "repositories-connect-listed" })}
      </p>
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <SearchableRoster
          label={text({ id: "repositories-filter" })}
          rows={repositoryChoices(
            drawn,
            props.bound,
            state.value.workerless ?? [],
          )}
          textOf={(choice) => choice.repository.fullName}
          keyOf={(choice) => choice.repository.url}
          renderRow={(choice) => (
            <RepositoryChoiceRow
              choice={choice}
              onChoose={(chosen) => {
                const named = repositoryConnectNamed(
                  chosen.repository.fullName,
                );
                if (named !== undefined) props.onChoose(named);
              }}
            />
          )}
        />
      ) : null}
      {state.state === "Ready" && state.value.truncated ? (
        <Notice tone="parked" inline detail={text(repositoriesTruncated)} />
      ) : null}
    </>
  );
}

/** The first step: which repository this is for, before any app is named. */
function ConnectChoose(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly workers: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
  readonly onChoose: (named: RepositoryNamed) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <>
      <h3 className="text-md font-strong text-ink-1">
        {text({ id: "repositories-connect-which" })}
      </h3>
      <ConnectNamed onChoose={props.onChoose} />
      {props.installations.length === 0 ? null : <ConnectListed {...props} />}
    </>
  );
}

function AddRepositoryBody(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly workers: readonly ForgeInstallationResponse[];
  readonly bound: readonly ProjectRepositoryResponse[];
  readonly runner: WorkRunner;
  readonly asked: RepositoryConnectAsked;
  readonly returned: ForgeReturnWord | undefined;
  readonly onClose: () => void;
  readonly onBound: () => void;
}): ReactNode {
  const [chosen, setChosen] = useState(props.asked.repository);
  if (chosen === undefined)
    return (
      <ConnectChoose
        partition={props.partition}
        installations={props.installations}
        workers={props.workers}
        bound={props.bound}
        onChoose={setChosen}
      />
    );
  return (
    <ConnectRepository
      key={repositoryNamedLabel(chosen)}
      partition={props.partition}
      named={chosen}
      arrival={props.asked.arrival}
      returned={
        props.asked.repository !== undefined &&
        repositoryNamedSame(props.asked.repository, chosen)
          ? props.returned
          : undefined
      }
      runner={props.runner}
      onAnother={() => {
        setChosen(undefined);
      }}
      onDone={props.onClose}
      onBound={props.onBound}
    />
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
  /** Whether this reader can connect a repository here at all. */
  readonly addable: boolean;
  /** What the page's address asked of the flow when the picker opened. */
  readonly asked: RepositoryConnectAsked;
  /** The word the person came back from the forge with, where they did. */
  readonly returned: ForgeReturnWord | undefined;
  /** The page's own state, because the page draws the presses that open it. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Told of a bind the route accepted, the picker staying open over what it came to. */
  readonly onBound: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <Dialog
      title={text({ id: "repositories-add" })}
      open={props.open && props.addable}
      onOpenChange={props.onOpenChange}
    >
      <AddRepositoryBody
        partition={props.partition}
        installations={props.installations}
        workers={props.workers}
        bound={props.bound}
        runner={props.runner}
        asked={props.asked}
        returned={props.returned}
        onClose={() => {
          props.onOpenChange(false);
        }}
        onBound={props.onBound}
      />
    </Dialog>
  );
}
