/**
 * The project's repositories: what it binds, and what it could bind from the
 * tenant's own connected accounts.
 *
 * The bindings below are the live ones, which are what a ticket may name; a
 * retired one is not listed, and its page is reached only by its address. A
 * binding is added from what those installations grant rather than from a
 * typed address. A binding the project holds no configuration for
 * is drawn as deferred, with its configuration step offered again on its row,
 * and one the worker app cannot be said to reach says why on its row, with the
 * installation's page on GitHub where its selection is what is missing.
 * Each binding offers Unbind unless the abilities read refuses this reader
 * `administer`, which is the permit the retirement route asks.
 * The line under Add says why it is withheld, or that a connected account
 * lacks the worker app. The accounts are the tenant's, and
 * the step that line names is taken from here where this reader can take it:
 * Connect GitHub where the workspace holds no account, and the worker app's
 * install where one it holds lacks that app, each returning to this page. A
 * return from the forge that did not simply connect says so in one line above
 * it, until the person leaves.
 *
 * THE PICKER HAS AN ADDRESS, this page's own at the anchor
 * `ui/chuggy-ui/app/core/projectRepositories.ts` names, and a grant made on
 * the forge from the picker returns to it: the page opens with the picker open
 * and its roster read, unless the return brought a word to read first. The
 * address loses the anchor, in the entry it is in, when the picker closes and
 * when a bind is accepted, so neither a reload nor Back opens the picker and
 * reads its roster again.
 *
 * ADD IS DRAWN A SECOND TIME UNDER AN EMPTY ROSTER'S LINE, where adding is the
 * one thing left to do, and opens the dialog the one in the head opens. The
 * line over it says how a repository comes to be listed there: made on GitHub
 * and granted to both apps. `ui/chuggy-ui/app/core/projectRepositories.ts`
 * decides when.
 */

import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ForgeInstallationResponse,
  ProjectRepositoryListedResponse,
} from "../../../../src/contract/responses.ts";
import { instantFigure } from "../core/figures.ts";
import {
  forgePortalInstallations,
  forgeWorkerInstallations,
} from "../core/forgeInstallation.ts";
import type { ForgeReturnWord } from "../core/forgeReturn.ts";
import { projectAbilityRefused } from "../core/projectAbilities.ts";
import {
  repositoryAddClosedPath,
  repositoryAddHow,
  repositoryAddLeads,
  repositoryAddOpened,
  repositoryLabel,
  repositoryOffersLine,
} from "../core/projectRepositories.ts";
import type {
  RepositoryOffersLine,
  RepositoryOffersStep,
} from "../core/projectRepositories.ts";
import {
  projectForgeAppsQuery,
  projectRepositoriesQuery,
} from "../core/projectQueries.ts";
import { forgeInstallationsQuery } from "../core/tenantQueries.ts";
import type { WorkRunner } from "../core/workRunner.ts";
import { usePanelState } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { currentAnchor, currentPath } from "./ports.ts";
import { useProjectAbilities } from "./projectAbilities.tsx";
import { AddRepository } from "./repositories/AddRepository.tsx";
import { BindingConfigurations } from "./repositories/BindingConfigurations.tsx";
import { BindingWorkerReach } from "./repositories/BindingWorkerReach.tsx";
import { ConnectGithub } from "./repositories/ConnectGithub.tsx";
import {
  ForgeReturned,
  useForgeReturned,
} from "./repositories/ForgeReturned.tsx";
import { InstallLink } from "./repositories/InstallLink.tsx";
import { repositoryRoutePath } from "./repositories/RepositoryPage.tsx";
import {
  UnbindAsked,
  UnbindPress,
  useRepositoryUnbinding,
} from "./repositories/UnbindRepository.tsx";
import type { RepositoryUnbinding } from "./repositories/UnbindRepository.tsx";
import { ScreenTitle } from "./shell/slots.tsx";
import { Button } from "./ui/Button.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Table } from "./ui/Table.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import { useWorkRunner } from "./workRunner.tsx";

/** This page's own address, which its parameters are read from. */
const repositoriesRoutePath = "/$tenant/$project/repositories";

function BindingRow(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryListedResponse;
  readonly nowMs: number;
  /** The listing's unbinding, where it has a column of them. */
  readonly unbinding: RepositoryUnbinding | undefined;
}): ReactNode {
  const binding = props.binding;
  return (
    <tr>
      <th scope="row">
        <span className="flex items-center gap-2">
          <Tooltip text={binding.repository}>
            <Link
              to={repositoryRoutePath}
              params={{ ...props.partition, repository: binding.repository }}
            >
              {repositoryLabel(binding.repository)}
            </Link>
          </Tooltip>
          {binding.configured ? null : (
            <BindingConfigurations
              partition={props.partition}
              repository={binding.repository}
            />
          )}
          {binding.workerReach === undefined ? null : (
            <BindingWorkerReach reach={binding.workerReach} />
          )}
        </span>
      </th>
      <td>
        <Figure figure={instantFigure(binding.boundAt, props.nowMs)} />
      </td>
      {props.unbinding === undefined ? null : (
        <td className="text-end">
          <UnbindPress
            repository={binding.repository}
            unbinding={props.unbinding}
          />
        </td>
      )}
    </tr>
  );
}

/**
 * The listing's unbinding, where it has a column of them: the abilities read
 * did not refuse this reader the permit it asks, and a binding is listed.
 */
function useBindingUnbinding(
  partition: PartitionIdentity,
  listed: boolean,
): RepositoryUnbinding | undefined {
  const refused = projectAbilityRefused(
    useProjectAbilities(partition),
    "administer",
  );
  const unbinding = useRepositoryUnbinding(partition, listed && !refused);
  return refused ? undefined : unbinding;
}

/** The bindings, or the line that says there are none, with the one thing to
 * do about it under it where the page offers one. */
function BindingTable(props: {
  readonly partition: PartitionIdentity;
  readonly bindings: readonly ProjectRepositoryListedResponse[];
  readonly action: ReactNode;
}): ReactNode {
  const nowMs = useNowMs();
  const unbinding = useBindingUnbinding(
    props.partition,
    props.bindings.length > 0,
  );
  if (props.bindings.length === 0)
    return props.action === undefined ? (
      <EmptyState label="No repository bound" />
    ) : (
      <div className="grid justify-items-start gap-3">
        <EmptyState label="No repository bound" />
        <Notice tone="info" inline detail={repositoryAddHow} />
        {props.action}
      </div>
    );
  return (
    <>
      <Table caption="Bound repositories">
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Bound</th>
            {unbinding === undefined ? null : (
              <th scope="col">
                <span className="visually-hidden">Unbind</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {props.bindings.map((binding) => (
            <BindingRow
              key={binding.repository}
              partition={props.partition}
              binding={binding}
              nowMs={nowMs}
              unbinding={unbinding}
            />
          ))}
        </tbody>
      </Table>
      {unbinding === undefined ? null : <UnbindAsked unbinding={unbinding} />}
    </>
  );
}

function OffersStep(props: {
  readonly tenant: string;
  readonly step: RepositoryOffersStep;
}): ReactNode {
  switch (props.step) {
    case "Connect":
      return (
        <ConnectGithub
          tenant={props.tenant}
          returnPath={currentPath()}
          variant="primary"
        />
      );
    case "InstallWorker":
      return (
        <InstallLink
          tenant={props.tenant}
          returnPath={currentPath()}
          app="worker"
        />
      );
  }
}

function OffersLine(props: {
  readonly tenant: string;
  readonly line: RepositoryOffersLine | undefined;
}): ReactNode {
  const line = props.line;
  if (line === undefined) return null;
  return (
    <>
      <Notice tone="parked" inline detail={line.status} />
      {line.step === undefined ? null : (
        <div className="flex">
          <OffersStep tenant={props.tenant} step={line.step} />
        </div>
      )}
    </>
  );
}

/**
 * Whether the picker is open, which the address it was drawn at decides first.
 * A close, and a bind told through `bound`, take the picker's anchor off the
 * address in the entry it is in, where the address carries it.
 */
function usePicker(returned: ForgeReturnWord | undefined): {
  readonly open: boolean;
  readonly opened: (open: boolean) => void;
  readonly bound: () => void;
} {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() =>
    repositoryAddOpened(currentAnchor(), returned),
  );
  const left = (): void => {
    const path = repositoryAddClosedPath(currentPath(), currentAnchor());
    if (path !== undefined)
      void navigate({ href: path, replace: true, resetScroll: false });
  };
  return {
    open,
    opened: (next) => {
      setOpen(next);
      if (!next) left();
    },
    bound: left,
  };
}

function RepositoriesSection(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bindings: readonly ProjectRepositoryListedResponse[] | undefined;
  readonly line: RepositoryOffersLine | undefined;
  readonly returned: ForgeReturnWord | undefined;
  readonly unready: ReactNode;
  readonly runner: WorkRunner;
}): ReactNode {
  const bindings = props.bindings?.filter(
    (binding) => binding.retiredAt === undefined,
  );
  const picker = usePicker(props.returned);
  const leads = repositoryAddLeads({
    bindings,
    installations: props.installations,
    line: props.line,
  });
  return (
    <Panel
      variant="section"
      title="Repositories"
      about="What this project binds. A ticket names one of these."
      meta={
        <AddRepository
          partition={props.partition}
          installations={forgePortalInstallations(props.installations)}
          workers={forgeWorkerInstallations(props.installations)}
          bound={bindings ?? []}
          runner={props.runner}
          open={picker.open}
          onOpenChange={picker.opened}
          onBound={picker.bound}
        />
      }
    >
      <ForgeReturned word={props.returned} />
      <OffersLine tenant={props.partition.tenant} line={props.line} />
      {props.unready}
      {bindings === undefined ? null : (
        <BindingTable
          partition={props.partition}
          bindings={bindings}
          action={
            leads ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  picker.opened(true);
                }}
              >
                Add
              </Button>
            ) : undefined
          }
        />
      )}
    </Panel>
  );
}

export function RepositoriesPage(): ReactNode {
  const params = useParams({ from: repositoriesRoutePath });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const accounts = usePanelState(forgeInstallationsQuery(partition.tenant));
  const apps = usePanelState(projectForgeAppsQuery(partition));
  const bindings = usePanelState(projectRepositoriesQuery(partition));
  const returned = useForgeReturned(partition.tenant);
  const runner = useWorkRunner(partition, "Reader");
  return (
    <div className="grid min-w-0 max-w-settings gap-4">
      <ScreenTitle>Repositories</ScreenTitle>
      <RepositoriesSection
        partition={partition}
        installations={
          accounts.state === "Ready" ? accounts.value.installations : []
        }
        bindings={
          bindings.state === "Ready" ? bindings.value.repositories : undefined
        }
        line={repositoryOffersLine(accounts, apps)}
        returned={returned}
        unready={<PanelUnready state={bindings} />}
        runner={runner}
      />
    </div>
  );
}
