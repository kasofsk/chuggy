/**
 * The tenant's accounts: the forge accounts it has connected, and the apps
 * each holds.
 *
 * An account is a row per account and not per installation, because what
 * onboarding needs to know is whether both of this deployment's apps are on
 * it. Connect GitHub claims both where they are, and is the panel's one
 * action until an account is connected or the person comes back from the
 * forge owning none that holds the portal app; then Add account installs the
 * portal app, and an account without the worker app offers its install on its
 * own row. A return from the forge that did not simply connect says so in one
 * line on the panel, until the person leaves.
 * Where Connect or Add is withheld the line under them says why, and a reader
 * the accounts are not shown to is told who connects them and offered nothing
 * to connect with.
 */

import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { apiForgeInstallations } from "../../core/apiRoutes.ts";
import { forgeAccountRows } from "../../core/forgeInstallation.ts";
import type { ForgeAccountRow } from "../../core/forgeInstallation.ts";
import { forgeReturnTake } from "../../core/forgeReturn.ts";
import type { ForgeReturnStanding } from "../../core/forgeReturn.ts";
import { forgeAccountsWithheld } from "../../core/projectRepositories.ts";
import { forgeAppStandingTone } from "../../core/tones.ts";
import { usePanelTenantResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { currentPath, transientStore } from "../ports.ts";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { ConnectGithub } from "../repositories/ConnectGithub.tsx";
import { InstallLink } from "../repositories/InstallLink.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Notice } from "../ui/Notice.tsx";
import type { NoticeTone } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Table } from "../ui/Table.tsx";

/** This page's own address, which its reads take their tenant from. */
export const tenantAccountsRoutePath = "/tenants/$tenant/settings/accounts";

/** No frame names this read, so a fresh visit is what reaches it. */
export const forgeInstallationsResource = "forge-installations";

function AccountRow(props: {
  readonly tenant: string;
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
              tenant={props.tenant}
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
  readonly tenant: string;
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
          <AccountRow key={row.account} tenant={props.tenant} row={row} />
        ))}
      </tbody>
    </Table>
  );
}

function tenantAccountsReturnTone(standing: ForgeReturnStanding): NoticeTone {
  switch (standing) {
    case "Failed":
      return "danger";
    case "Unfinished":
    case "Uninstalled":
      return "parked";
  }
}

/** The listing answers only a workspace admin, so its absence is this reader's
 * standing rather than a fault, and a claim they started would be refused. */
export function TenantAccountsPage(): ReactNode {
  const params = useParams({ from: tenantAccountsRoutePath });
  const tenant = params.tenant;
  const [returned] = useState(() => forgeReturnTake(transientStore, tenant));
  const accounts = usePanelTenantResource(
    tenant,
    forgeInstallationsResource,
    (ports) => apiForgeInstallations(ports, tenant),
  );
  const installations =
    accounts.state === "Ready" ? accounts.value.installations : undefined;
  const withheld = accounts.state === "Absent";
  const adding =
    (installations !== undefined && installations.length > 0) ||
    returned?.standing === "Uninstalled";
  return (
    <ProjectlessFrame>
      <div className="grid min-w-0 max-w-settings gap-4">
        <h1 className="text-md font-strong text-ink-1 truncate">Accounts</h1>
        <Panel
          variant="section"
          title="Accounts"
          about="The forge accounts this workspace has connected, and the apps each holds."
          meta={
            <span className="flex items-center gap-2">
              {withheld ? null : (
                <ConnectGithub tenant={tenant} returnPath={currentPath()} />
              )}
              {adding ? (
                <InstallLink
                  tenant={tenant}
                  returnPath={currentPath()}
                  app="portal"
                  label="Add account"
                />
              ) : null}
            </span>
          }
        >
          {returned === undefined ? null : (
            <Notice
              tone={tenantAccountsReturnTone(returned.standing)}
              inline
              detail={returned.status}
            />
          )}
          {withheld ? (
            <Notice tone="parked" inline detail={forgeAccountsWithheld} />
          ) : (
            <PanelUnready state={accounts} />
          )}
          {installations === undefined ? null : (
            <AccountTable
              tenant={tenant}
              rows={forgeAccountRows(installations)}
            />
          )}
        </Panel>
      </div>
    </ProjectlessFrame>
  );
}
