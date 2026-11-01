/**
 * The tenant's accounts: the forge accounts it has connected, and the apps
 * each holds.
 *
 * An account is a row per account and not per installation, because what
 * onboarding needs to know is whether both of this deployment's apps are on
 * it. Connect GitHub claims both where they are and goes on to the install of
 * one that is missing, once for each. It is the panel's one action until an
 * account is connected or the person comes back from the forge owning none
 * that holds the portal app; then Add account installs the portal app, and an
 * account without the worker app offers its install on its own row, as an app
 * whose installation has not accepted what the app now asks for offers the
 * installation's own page on the forge. A return
 * from the forge that did not simply connect says so in one line on the
 * panel, until the person leaves.
 * Where Connect or Add is withheld the line under them says why, and a reader
 * the accounts are not shown to is told who connects them and offered nothing
 * to connect with.
 */

import type { ReactNode } from "react";

import type { ForgeAppName } from "../../../../../src/contract/rosters.ts";
import type { ForgeInstallationResponse } from "../../../../../src/contract/responses.ts";
import {
  forgeAccountInstallationId,
  forgeAccountRows,
} from "../../core/forgeInstallation.ts";
import type {
  ForgeAccountRow,
  ForgeAppStanding,
} from "../../core/forgeInstallation.ts";
import { forgeAccountsWithheld } from "../../core/projectRepositories.ts";
import {
  forgeAppStandingTone,
  forgeInstallationPermissionsTone,
} from "../../core/tones.ts";
import {
  forgeInstallationPermissionsQuery,
  forgeInstallationsQuery,
} from "../../core/tenantQueries.ts";
import { usePanelState } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { currentPath } from "../ports.ts";
import { ConnectGithub } from "../repositories/ConnectGithub.tsx";
import {
  ForgeReturned,
  useForgeReturned,
} from "../repositories/ForgeReturned.tsx";
import { InstallLink } from "../repositories/InstallLink.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Pill } from "../ui/Pill.tsx";
import { Table } from "../ui/Table.tsx";
import { buttonLookClassName } from "../ui/Button.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";

/** An installed app as its installation stands, which says more than
 * Installed only once the forge has answered that it is behind. */
function InstalledApp(props: {
  readonly tenant: string;
  readonly installationId: string;
}): ReactNode {
  const read = usePanelState(
    forgeInstallationPermissionsQuery(props.tenant, props.installationId),
  );
  if (read.state !== "Ready" || read.value.permissions !== "Behind")
    return <Pill tone={forgeAppStandingTone("Installed")}>Installed</Pill>;
  return (
    <>
      <Pill tone={forgeInstallationPermissionsTone(read.value.permissions)}>
        Update pending
      </Pill>
      <a
        href={read.value.settingsUrl}
        className={buttonLookClassName({ size: "sm" })}
        rel="noopener noreferrer"
        target="_blank"
      >
        Review on GitHub
      </a>
    </>
  );
}

function AppStanding(props: {
  readonly tenant: string;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly account: string;
  readonly app: ForgeAppName;
  readonly standing: ForgeAppStanding;
}): ReactNode {
  const installationId = forgeAccountInstallationId(
    props.installations,
    props.account,
    props.app,
  );
  if (installationId === undefined)
    return (
      <Pill tone={forgeAppStandingTone(props.standing)}>{props.standing}</Pill>
    );
  return <InstalledApp tenant={props.tenant} installationId={installationId} />;
}

function AccountRow(props: {
  readonly tenant: string;
  readonly installations: readonly ForgeInstallationResponse[];
  readonly row: ForgeAccountRow;
}): ReactNode {
  const row = props.row;
  return (
    <tr>
      <th scope="row">{row.account}</th>
      <td>{row.kind}</td>
      <td>
        <span className="flex items-center gap-2">
          <AppStanding
            tenant={props.tenant}
            installations={props.installations}
            account={row.account}
            app="portal"
            standing={row.portal}
          />
        </span>
      </td>
      <td>
        <span className="flex items-center gap-2">
          <AppStanding
            tenant={props.tenant}
            installations={props.installations}
            account={row.account}
            app="worker"
            standing={row.worker}
          />
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
  readonly installations: readonly ForgeInstallationResponse[];
}): ReactNode {
  const rows = forgeAccountRows(props.installations);
  if (rows.length === 0) return <EmptyState label="No account connected" />;
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
        {rows.map((row) => (
          <AccountRow
            key={row.account}
            tenant={props.tenant}
            installations={props.installations}
            row={row}
          />
        ))}
      </tbody>
    </Table>
  );
}

/** The listing answers only a workspace admin, so its absence is this reader's
 * standing rather than a fault, and a claim they started would be refused. */
export function TenantAccountsPage(): ReactNode {
  const tenant = useSettingsTenant();
  const returned = useForgeReturned(tenant);
  const accounts = usePanelState(forgeInstallationsQuery(tenant));
  const installations =
    accounts.state === "Ready" ? accounts.value.installations : undefined;
  const withheld = accounts.state === "Absent";
  const adding =
    (installations !== undefined && installations.length > 0) ||
    returned?.standing === "Uninstalled";
  return (
    <SettingsPage title="Accounts">
      <Panel
        variant="section"
        title="Accounts"
        about="Connected accounts and their apps"
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
        <ForgeReturned word={returned} />
        {withheld ? (
          <Notice tone="parked" inline detail={forgeAccountsWithheld} />
        ) : (
          <PanelUnready state={accounts} />
        )}
        {installations === undefined ? null : (
          <AccountTable tenant={tenant} installations={installations} />
        )}
      </Panel>
    </SettingsPage>
  );
}
