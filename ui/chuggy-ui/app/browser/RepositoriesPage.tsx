/**
 * The project's repositories: what it binds, and what it could bind from the
 * tenant's own connected accounts.
 *
 * The bindings below are what a ticket may name, except a retired one, which
 * is drawn as retired because it is still bound and no longer read; a binding
 * is added from what those installations grant rather than from a typed
 * address. A live binding the project holds no configuration for is drawn as
 * deferred, with its configuration step offered again on its row.
 * Where Add or Create is withheld the line under them says why. The accounts
 * themselves are the tenant's and are connected from its own accounts page —
 * one place connects an account, and this page points at it rather than
 * carrying a second control.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ForgeInstallationResponse,
  ProjectRepositoryListedResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiForgeApps,
  apiForgeInstallations,
  apiProjectRepositories,
} from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import { forgePortalInstallations } from "../core/forgeInstallation.ts";
import {
  repositoryLabel,
  repositoryOffersPointsAtAccounts,
  repositoryOffersWithheld,
} from "../core/projectRepositories.ts";
import { usePanelResource, usePanelTenantResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import {
  AddRepository,
  projectRepositoriesResource,
} from "./repositories/AddRepository.tsx";
import { BindingConfigurations } from "./repositories/BindingConfigurations.tsx";
import { CreateRepository } from "./repositories/CreateRepository.tsx";
import { forgeAppsResource } from "./repositories/InstallLink.tsx";
import { repositoryRoutePath } from "./repositories/RepositoryPage.tsx";
import {
  forgeInstallationsResource,
  tenantAccountsRoutePath,
} from "./settings/TenantAccountsPage.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Notice } from "./ui/Notice.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Pill } from "./ui/Pill.tsx";
import { Table } from "./ui/Table.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

/** This page's own address, which its parameters are read from. */
const repositoriesRoutePath = "/$tenant/$project/repositories";

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

function RepositoriesSection(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bindings: readonly ProjectRepositoryListedResponse[] | undefined;
  readonly withheld: string | undefined;
  readonly pointsAtAccounts: boolean;
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
      {props.pointsAtAccounts ? (
        <Link
          to={tenantAccountsRoutePath}
          params={{ tenant: props.partition.tenant }}
        >
          Accounts
        </Link>
      ) : null}
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
  const accounts = usePanelTenantResource(
    partition.tenant,
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
      <RepositoriesSection
        partition={partition}
        installations={
          accounts.state === "Ready" ? accounts.value.installations : []
        }
        bindings={
          bindings.state === "Ready" ? bindings.value.repositories : undefined
        }
        withheld={repositoryOffersWithheld(accounts, apps)}
        pointsAtAccounts={repositoryOffersPointsAtAccounts(accounts)}
        unready={<PanelUnready state={bindings} />}
      />
    </div>
  );
}
