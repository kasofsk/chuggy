/**
 * The project's repositories: the forge accounts this tenant has connected,
 * and the repositories this project binds.
 *
 * An account is a row per account and not per installation, because what
 * onboarding needs to know is whether both of this deployment's apps are on it;
 * a missing one is what the Connect action is for. The bindings below are what
 * a ticket may name, and a binding is added from what those installations
 * grant rather than from a typed address.
 */

import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ForgeInstallationResponse,
  ProjectRepositoryResponse,
} from "../../../../src/contract/responses.ts";
import {
  apiForgeInstallations,
  apiProjectRepositories,
} from "../core/apiRoutes.ts";
import { instantFigure } from "../core/figures.ts";
import {
  forgeAccountRows,
  forgePortalInstallations,
} from "../core/forgeInstallation.ts";
import type { ForgeAccountRow } from "../core/forgeInstallation.ts";
import { repositoryLabel } from "../core/projectRepositories.ts";
import { forgeAppStandingTone } from "../core/tones.ts";
import { usePanelResource } from "./api.ts";
import { PanelUnready } from "./DataPanel.tsx";
import { useNowMs } from "./Freshness.tsx";
import { currentPath } from "./ports.ts";
import {
  AddRepository,
  projectRepositoriesResource,
} from "./repositories/AddRepository.tsx";
import { ConnectAccount } from "./repositories/ConnectAccount.tsx";
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

/** This page's own address, which its reads and its one navigation are from. */
const repositoriesRoutePath = "/$tenant/$project/repositories";

function AccountRow(props: { readonly row: ForgeAccountRow }): ReactNode {
  const row = props.row;
  return (
    <tr>
      <th scope="row">{row.account}</th>
      <td>{row.kind}</td>
      <td>
        <Pill tone={forgeAppStandingTone(row.portal)}>{row.portal}</Pill>
      </td>
      <td>
        <Pill tone={forgeAppStandingTone(row.worker)}>{row.worker}</Pill>
      </td>
    </tr>
  );
}

function AccountTable(props: {
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
          <AccountRow key={row.account} row={row} />
        ))}
      </tbody>
    </Table>
  );
}

function BindingRow(props: {
  readonly binding: ProjectRepositoryResponse;
  readonly nowMs: number;
}): ReactNode {
  const binding = props.binding;
  return (
    <tr>
      <th scope="row">
        <Tooltip text={binding.repository}>
          <span>{repositoryLabel(binding.repository)}</span>
        </Tooltip>
      </th>
      <td>
        <Figure figure={instantFigure(binding.boundAt, props.nowMs)} />
      </td>
    </tr>
  );
}

function BindingTable(props: {
  readonly bindings: readonly ProjectRepositoryResponse[];
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
            binding={binding}
            nowMs={nowMs}
          />
        ))}
      </tbody>
    </Table>
  );
}

/**
 * What the setup landing came back saying: one word, and the row beside it is
 * the rest of the answer.
 *
 * THE WORD IS AN EVENT AND NOT A PROPERTY OF THE ADDRESS. It is taken on the
 * first draw and the parameter cleared behind it, so a reload — or an address
 * somebody typed — does not redraw an answer to a claim that never happened.
 */
function ConnectedNotice(props: {
  readonly connected: string | undefined;
}): ReactNode {
  const navigate = useNavigate({ from: repositoriesRoutePath });
  const [taken] = useState(props.connected);
  const standing = props.connected !== undefined;
  useEffect(() => {
    if (!standing) return;
    void navigate({ search: { connected: undefined }, replace: true });
  }, [standing, navigate]);
  if (taken === undefined) return null;
  return <Notice tone="info" inline role="status" detail={taken} />;
}

function AccountsSection(props: {
  readonly partition: PartitionIdentity;
  readonly connected: string | undefined;
  readonly installations: readonly ForgeInstallationResponse[] | undefined;
  readonly unready: ReactNode;
}): ReactNode {
  return (
    <Panel
      variant="section"
      title="Accounts"
      about="The forge accounts this tenant has connected, and the apps each holds."
      meta={
        <ConnectAccount
          partition={props.partition}
          returnPath={currentPath()}
        />
      }
    >
      <ConnectedNotice connected={props.connected} />
      {props.unready}
      {props.installations === undefined ? null : (
        <AccountTable rows={forgeAccountRows(props.installations)} />
      )}
    </Panel>
  );
}

function RepositoriesSection(props: {
  readonly partition: PartitionIdentity;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly bindings: readonly ProjectRepositoryResponse[] | undefined;
  readonly unready: ReactNode;
}): ReactNode {
  const bindings = props.bindings;
  return (
    <Panel
      variant="section"
      title="Repositories"
      about="What this project binds. A ticket names one of these."
      meta={
        <AddRepository
          partition={props.partition}
          installations={forgePortalInstallations(props.installations)}
          bound={bindings ?? []}
        />
      }
    >
      {props.unready}
      {bindings === undefined ? null : <BindingTable bindings={bindings} />}
    </Panel>
  );
}

export function RepositoriesPage(): ReactNode {
  const params = useParams({ from: repositoriesRoutePath });
  const search = useSearch({ from: repositoriesRoutePath });
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
      <AccountsSection
        partition={partition}
        connected={search.connected}
        installations={
          accounts.state === "Ready" ? accounts.value.installations : undefined
        }
        unready={<PanelUnready state={accounts} />}
      />
      <RepositoriesSection
        partition={partition}
        installations={
          accounts.state === "Ready" ? accounts.value.installations : []
        }
        bindings={
          bindings.state === "Ready" ? bindings.value.repositories : undefined
        }
        unready={<PanelUnready state={bindings} />}
      />
    </div>
  );
}
