/**
 * The site's workspaces: for now the one card that makes one, a person
 * invited into a workspace of their own, at a form's width.
 *
 * The form is drawn only for a reader the site's abilities say may make a
 * workspace. Those abilities answer nothing to a reader who may do nothing on
 * the site, so their absence is this reader's standing rather than a fault,
 * and the page says who creates workspaces instead.
 */

import type { ReactNode } from "react";

import type { AccessSiteAbilities } from "../../../../../src/contract/accessPlane.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  siteWorkspaceOffered,
  siteWorkspacesWithheld,
} from "../../core/siteWorkspaces.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import {
  SiteWorkspaceAnswered,
  SiteWorkspaceCreate,
  SiteWorkspaceFields,
  useSiteWorkspaceCreation,
} from "./SiteWorkspaceCreation.tsx";
import { useSiteAbilities } from "./tenantPermissionsResource.ts";

function SiteWorkspaceCard(props: {
  readonly abilities: AccessSiteAbilities;
}): ReactNode {
  const creating = useSiteWorkspaceCreation(props.abilities);
  return (
    <div className="max-w-measure">
      <Panel
        variant="section"
        title="New workspace"
        foot={
          <>
            <div className="min-w-0 grow">
              <SiteWorkspaceAnswered creating={creating} />
            </div>
            <SiteWorkspaceCreate creating={creating} />
          </>
        }
      >
        <div className="pt-4">
          <SiteWorkspaceFields
            abilities={props.abilities}
            creating={creating}
          />
        </div>
      </Panel>
    </div>
  );
}

function SiteWorkspaces(props: {
  readonly read: PanelState<AccessSiteAbilities>;
}): ReactNode {
  const read = props.read;
  if (read.state === "Ready" && siteWorkspaceOffered(read.value))
    return <SiteWorkspaceCard abilities={read.value} />;
  return (
    <div className="bg-surface-1 border-edge rounded-2 min-w-0 border px-4 py-3">
      {read.state === "Ready" || read.state === "Absent" ? (
        <Notice tone="parked" inline detail={siteWorkspacesWithheld} />
      ) : (
        <PanelUnready state={read} />
      )}
    </div>
  );
}

export function SiteWorkspacesPage(): ReactNode {
  const tenant = useSettingsTenant();
  return (
    <SettingsPage title="Workspaces">
      <SiteWorkspaces read={useSiteAbilities(tenant)} />
    </SettingsPage>
  );
}
