/**
 * The project's repositories: the forge accounts this tenant has connected,
 * and the repositories this project binds.
 *
 * An account is a row per account and not per installation, because what
 * onboarding needs to know is whether both of this deployment's apps are on it.
 * Connect GitHub claims both where they are, and is the panel's one action
 * until an account is connected; then Add account installs the portal app on
 * another, and an account without the worker app offers its install on its own
 * row. The bindings below are what a ticket may name, except a retired one,
 * which is drawn as retired because it is still bound and no longer read; a
 * binding is added from what those installations grant rather than from a
 * typed address. A live binding the project holds no configuration for is
 * drawn as deferred, with its configuration step offered again on its row.
 * Where Add or Create is withheld the line under them says why, and a reader
 * the accounts are not shown to is told who connects them and offered nothing
 * to connect with.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ForgeInstallationResponse,
  ForgeInstallationsResponse,
  ProjectRepositoryListedResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiForgeApps,
  apiForgeInstallations,
  apiProjectRepositories,
} from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import type { PanelState } from "../core/freshness.ts";
import {
  forgeAccountRows,
  forgePortalInstallations,
} from "../core/forgeInstallation.ts";
import type { ForgeAccountRow } from "../core/forgeInstallation.ts";
import {
  forgeAccountsWithheld,
  repositoryLabel,
  repositoryOffersWithheld,
} from "../core/projectRepositories.ts";
import { forgeAppStandingTone } from "../core/tones.ts";
import { usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { currentPath } from "./ports.ts";
import {
  AddRepository,
  projectRepositoriesResource,
} from "./repositories/AddRepository.tsx";
import { BindingConfigurations } from "./repositories/BindingConfigurations.tsx";
import { ConnectGithub } from "./repositories/ConnectGithub.tsx";
import { CreateRepository } from "./repositories/CreateRepository.tsx";
import { forgeAppsResource, InstallLink } from "./repositories/InstallLink.tsx";
import { repositoryRoutePath } from "./repositories/RepositoryPage.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** No frame names this read, so the partition's own refetch is what reaches it. */
export const forgeInstallationsResource = "forge-installations";

/** This page's own address, which its parameters are read from. */
const repositoriesRoutePath = "/$tenant/$project/repositories";

function AccountRow(props: {
  readonly partition: PartitionIdentity;
  readonly row: ForgeAccountRow;
}): ReactNode {
  const row = props.row;
  return (
    <tr>
      <th scope="row">{row.account}</th>
      <td>{row.kind}</td>
      <td>
        <Pill tone={forgeAppStandingTone(row.portal)}>{row.portal}</Pill>
      </td>
      <td>
        <span className="flex items-center gap-2">
          <Pill tone={forgeAppStandingTone(row.worker)}>{row.worker}</Pill>
          {row.worker === "Missing" ? (
            <InstallLink
              partition={props.partition}
              returnPath={currentPath()}
              app="worker"
            />
          ) : null}
        </span>
      </td>
    </tr>
  );
}

function AccountTable(props: {
  readonly partition: PartitionIdentity;
  readonly rows: readonly ForgeAccountRow[];
}): ReactNode {
  if (props.rows.length === 0)
    return <EmptyState label="No account connected" />;
  return (
    <Table caption="Connected accounts">
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col">Kind</th>
          <th scope="col">Portal</th>
          <th scope="col">Worker</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <AccountRow key={row.account} partition={props.partition} row={row} />
        ))}
      </tbody>
    </Table>
  );
}

function BindingRow(props: {
  readonly partition: PartitionIdentity;
  readonly binding: ProjectRepositoryListedResponse;
  readonly nowMs: number;
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
          {binding.retiredAt === undefined ? undefined : (
            <Pill tone="retired">Retired</Pill>
          )}
          {binding.retiredAt !== undefined || binding.configured ? null : (
            <BindingConfigurations
              partition={props.partition}
              repository={binding.repository}
            />
          )}
        </span>
      </th>
      <td>
        <Figure figure={instantFigure(binding.boundAt, props.nowMs)} />
      </td>
    </tr>
  );
}

function BindingTable(props: {
  readonly partition: PartitionIdentity;
  readonly bindings: readonly ProjectRepositoryListedResponse[];
}): ReactNode {
  const nowMs = useNowMs();
  if (props.bindings.length === 0)
    return <EmptyState label="No repository bound" />;
  return (
    <Table caption="Bound repositories">
      <thead>
        <tr>
          <th scope="col">Repository</th>
          <th scope="col">Bound</th>
        </tr>
      </thead>
      <tbody>
        {props.bindings.map((binding) => (
          <BindingRow
            key={binding.repository}
            partition={props.partition}
            binding={binding}
            nowMs={nowMs}
          />
        ))}
      </tbody>
    </Table>
  );
}

/** The listing answers only a workspace admin, so its absence is this reader's
 * standing rather than a fault, and a claim they started would be refused. */
function AccountsSection(props: {
  readonly partition: PartitionIdentity;
  readonly accounts: PanelState<ForgeInstallationsResponse>;
}): ReactNode {
  const accounts = props.accounts;
  const installations =
    accounts.state === "Ready" ? accounts.value.installations : undefined;
  const withheld = accounts.state === "Absent";
  return (
    <Panel
      variant="section"
      title="Accounts"
      about="The forge accounts this workspace has connected, and the apps each holds."
      meta={
        <span className="flex items-center gap-2">
          {withheld ? null : (
            <ConnectGithub
              partition={props.partition}
              returnPath={currentPath()}
            />
          )}
          {installations === undefined || installations.length === 0 ? null : (
            <InstallLink
              partition={props.partition}
              returnPath={currentPath()}
              app="portal"
              label="Add account"
            />
          )}
        </span>
      }
    >
      {withheld ? (
        <Notice tone="parked" inline detail={forgeAccountsWithheld} />
      ) : (
        <PanelUnready state={accounts} />
      )}
      {installations === undefined ? null : (
        <AccountTable
          partition={props.partition}
          rows={forgeAccountRows(installations)}
        />
      )}
    </Panel>
  );
}

function RepositoriesSection(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bindings: readonly ProjectRepositoryListedResponse[] | undefined;
  readonly withheld: string | undefined;
  readonly unready: ReactNode;
}): ReactNode {
  const bindings = props.bindings;
  return (
    <Panel
      variant="section"
      title="Repositories"
      about="What this project binds. A ticket names one of these."
      meta={
        <span className="flex items-center gap-2">
          <AddRepository
            partition={props.partition}
            installations={forgePortalInstallations(props.installations)}
            bound={bindings ?? []}
          />
          <CreateRepository
            partition={props.partition}
            installations={props.installations}
          />
        </span>
      }
    >
      {props.withheld === undefined ? null : (
        <Notice tone="parked" inline detail={props.withheld} />
      )}
      {props.unready}
      {bindings === undefined ? null : (
        <BindingTable partition={props.partition} bindings={bindings} />
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
  const accounts = usePanelResource(
    partition,
    "Project",
    forgeInstallationsResource,
    (ports) => apiForgeInstallations(ports, partition.tenant),
  );
  const apps = usePanelResource(
    partition,
    "Project",
    forgeAppsResource,
    (ports) => apiForgeApps(ports),
  );
  const bindings = usePanelResource(
    partition,
    "Project",
    projectRepositoriesResource,
    (ports) => apiProjectRepositories(ports, partition),
  );
  return (
    <div className="grid min-w-0 max-w-settings gap-4">
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">
          Repositories
        </h1>
      </TopBarSlot>
      <AccountsSection partition={partition} accounts={accounts} />
      <RepositoriesSection
        partition={partition}
        installations={
          accounts.state === "Ready" ? accounts.value.installations : []
        }
        bindings={
          bindings.state === "Ready" ? bindings.value.repositories : undefined
        }
        withheld={repositoryOffersWithheld(accounts, apps)}
        unready={<PanelUnready state={bindings} />}
      />
    </div>
  );
}
