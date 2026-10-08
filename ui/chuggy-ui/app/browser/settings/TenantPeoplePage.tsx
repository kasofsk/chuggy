/**
 * A workspace's people: one row a person, their workspace roles and their
 * roles on each of the workspace's projects edited in place, and one action
 * inviting someone new.
 *
 * The list answers only a workspace admin, so its absence is this reader's
 * standing rather than a fault: they are told who manages people and offered
 * nothing to change. That the list was answered is the whole of what tells the
 * page it may offer a change. The reader is always in a list they were
 * answered, so there is no empty state.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { AccessTenantPeople } from "../../../../../src/contract/accessPlane.ts";
import { apiTenantPeople } from "../../core/accessRoutes.ts";
import {
  tenantPeopleOtherIssuersLine,
  tenantPeopleTruncated,
  tenantPeopleWithheld,
} from "../../core/tenantPeople.ts";
import { usePanelTenantResource } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Table } from "../ui/Table.tsx";
import { TenantInvite } from "./TenantInvite.tsx";
import { TenantPersonRow, tenantPeopleResource } from "./TenantPersonRow.tsx";

/** This page's own address, which its reads take their tenant from. */
export const tenantPeopleRoutePath = "/tenants/$tenant/settings/people";

function TenantPeopleTable(props: {
  readonly tenant: string;
  readonly listed: AccessTenantPeople;
}): ReactNode {
  const listed = props.listed;
  const otherIssuers = tenantPeopleOtherIssuersLine(listed.otherIssuers);
  return (
    <>
      <Table caption="People">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Workspace</th>
            <th scope="col">Hosted runs</th>
            <th scope="col">Projects</th>
          </tr>
        </thead>
        <tbody>
          {listed.people.map((person) => (
            <TenantPersonRow
              key={person.subject}
              tenant={props.tenant}
              person={person}
              projects={listed.projects}
            />
          ))}
        </tbody>
      </Table>
      {otherIssuers === undefined ? null : (
        <Notice tone="info" inline detail={otherIssuers} />
      )}
      {listed.truncated ? (
        <Notice tone="parked" inline detail={tenantPeopleTruncated} />
      ) : null}
    </>
  );
}

export function TenantPeoplePage(): ReactNode {
  const params = useParams({ from: tenantPeopleRoutePath });
  const tenant = params.tenant;
  const people = usePanelTenantResource(tenant, tenantPeopleResource, (ports) =>
    apiTenantPeople(ports, tenant),
  );
  const listed = people.state === "Ready" ? people.value : undefined;
  return (
    <ProjectlessFrame>
      <div className="grid min-w-0 max-w-settings gap-4">
        <h1 className="text-md font-strong text-ink-1 truncate">People</h1>
        <Panel
          variant="section"
          title="People"
          about="Who is in this workspace, and the roles each holds."
          meta={
            listed === undefined ? undefined : (
              <TenantInvite tenant={tenant} projects={listed.projects} />
            )
          }
        >
          {people.state === "Absent" ? (
            <Notice tone="parked" inline detail={tenantPeopleWithheld} />
          ) : (
            <PanelUnready state={people} />
          )}
          {listed === undefined ? null : (
            <TenantPeopleTable tenant={tenant} listed={listed} />
          )}
        </Panel>
      </div>
    </ProjectlessFrame>
  );
}
