/**
 * The site's workspaces: one row a workspace, saying who administers it and
 * whom they may invite, under how many there are and the one action that
 * makes another. A creation's line stands over the list until the action is
 * pressed again.
 *
 * The list and the action are for a reader the site's abilities say may make
 * a workspace, and the list is read only for them. Those abilities answer
 * nothing to a reader who may do nothing on the site, so their absence is this
 * reader's standing rather than a fault, and the page says who creates
 * workspaces instead.
 *
 * The site's workspace links are read beside the workspaces, and only a read
 * that answered with a list lets one be made: a plane that keeps no links, a
 * read not yet answered and one that failed all leave the action as it is
 * without them.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessSiteAbilities,
  AccessSiteTenant,
} from "../../../../../src/contract/accessPlane.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  siteWorkspaceInvitesLabel,
  siteWorkspaceOffered,
  siteWorkspacesCountLine,
  siteWorkspacesWithheld,
  siteWorkspaceUnnamedLine,
} from "../../core/siteWorkspaces.ts";
import { Notice } from "../ui/Notice.tsx";
import {
  SettingsListing,
  SettingsListingCut,
  SettingsListingNone,
  settingsListingNone,
  SettingsListingSection,
  SettingsListingTable,
  SettingsListingUnread,
  SettingsListingWithheld,
} from "./SettingsListing.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { SiteWorkspaceNew } from "./SiteWorkspaceCreation.tsx";
import {
  useSiteWorkspaceLinks,
  useSiteWorkspaces,
} from "./siteWorkspacesResource.ts";
import { TenantPersonWho } from "./TenantPersonRow.tsx";
import { useSiteAbilities } from "./tenantPermissionsResource.ts";

/** Who administers one workspace, a line a person, then the count of those
 * the answer does not name. */
function SiteWorkspaceAdmins(props: {
  readonly listed: AccessSiteTenant;
  readonly unnamed: string | undefined;
}): ReactNode {
  return (
    <ul className="grid min-w-0 gap-1">
      {props.listed.administrators.map((person) => (
        <li key={person.subject}>
          <TenantPersonWho person={person} />
        </li>
      ))}
      {props.unnamed === undefined ? null : (
        <li className="text-sm text-ink-3">{props.unnamed}</li>
      )}
    </ul>
  );
}

function SiteWorkspaceRow(props: {
  readonly listed: AccessSiteTenant;
}): ReactNode {
  const listed = props.listed;
  const unnamed = siteWorkspaceUnnamedLine(listed);
  const none = listed.administrators.length === 0 && unnamed === undefined;
  return (
    <tr>
      <th scope="row">
        <span
          className="people-name block font-strong text-ink-1"
          title={listed.tenant}
        >
          {listed.tenant}
        </span>
      </th>
      <td data-none={settingsListingNone(none)}>
        {none ? (
          <SettingsListingNone />
        ) : (
          <SiteWorkspaceAdmins listed={listed} unnamed={unnamed} />
        )}
      </td>
      <td
        className={
          listed.createAccounts ? "people-beside" : "people-beside text-ink-3"
        }
      >
        {siteWorkspaceInvitesLabel(listed.createAccounts)}
      </td>
    </tr>
  );
}

function SiteWorkspacesTable(props: {
  readonly tenants: readonly AccessSiteTenant[];
}): ReactNode {
  return (
    <SettingsListingTable caption="Workspaces">
      <thead>
        <tr>
          <th scope="col" className="w-[28%]">
            Workspace
          </th>
          <th scope="col">Admins</th>
          <th scope="col" className="w-[14em]">
            Invites
          </th>
        </tr>
      </thead>
      <tbody>
        {props.tenants.map((listed) => (
          <SiteWorkspaceRow key={listed.tenant} listed={listed} />
        ))}
      </tbody>
    </SettingsListingTable>
  );
}

/** The list for a reader who may make a workspace, the line the last creation
 * left held here so it outlives the read the creation set off. */
function SiteWorkspacesListed(props: {
  readonly tenant: string;
  readonly abilities: AccessSiteAbilities;
}): ReactNode {
  const listed = useSiteWorkspaces(props.tenant);
  const read = useSiteWorkspaceLinks(props.tenant);
  const links = read.state === "Ready";
  const [created, setCreated] = useState<string | undefined>(undefined);
  return (
    <>
      {created === undefined ? null : (
        <Notice tone="pass" inline role="status" detail={created} />
      )}
      {listed.state === "Ready" ? (
        <>
          <SettingsListingSection
            heading={siteWorkspacesCountLine(listed.value.tenants.length)}
            action={
              <SiteWorkspaceNew
                tenant={props.tenant}
                abilities={props.abilities}
                links={links}
                onSaid={setCreated}
              />
            }
          >
            {listed.value.tenants.length === 0 ? null : (
              <SiteWorkspacesTable tenants={listed.value.tenants} />
            )}
          </SettingsListingSection>
          {listed.value.truncated ? <SettingsListingCut /> : null}
        </>
      ) : (
        <SettingsListingUnread
          state={listed}
          withheld={siteWorkspacesWithheld}
        />
      )}
    </>
  );
}

function SiteWorkspaces(props: {
  readonly tenant: string;
  readonly read: PanelState<AccessSiteAbilities>;
}): ReactNode {
  const read = props.read;
  if (read.state !== "Ready")
    return (
      <SettingsListingUnread state={read} withheld={siteWorkspacesWithheld} />
    );
  if (!siteWorkspaceOffered(read.value))
    return <SettingsListingWithheld line={siteWorkspacesWithheld} />;
  return <SiteWorkspacesListed tenant={props.tenant} abilities={read.value} />;
}

export function SiteWorkspacesPage(): ReactNode {
  const tenant = useSettingsTenant();
  return (
    <SettingsPage title="Workspaces">
      <SettingsListing>
        <SiteWorkspaces tenant={tenant} read={useSiteAbilities(tenant)} />
      </SettingsListing>
    </SettingsPage>
  );
}
