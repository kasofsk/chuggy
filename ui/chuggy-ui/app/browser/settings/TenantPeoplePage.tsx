/**
 * A workspace's people: one row a person, their workspace roles, whether they
 * hold hosted runs and their roles on each of the workspace's projects, and one
 * action inviting someone new, each change offered only where the reader's
 * abilities say they may make it.
 *
 * The list answers only a reader holding some authority over the workspace's
 * people, so its absence is this reader's standing rather than a fault: they
 * are told who manages people and offered nothing to change. The abilities are
 * read beside the list, and until they are answered the table is drawn with no
 * control; where they are not answered beside a list that was, their line is
 * drawn under it. The reader is always in a list they were answered, so there
 * is no empty state.
 */

import type { ReactNode } from "react";

import type {
  AccessTenantAbilities,
  AccessTenantPeople,
} from "../../../../../src/contract/accessPlane.ts";
import {
  tenantInvitationOffered,
  tenantPeopleOtherIssuersLine,
  tenantPeopleTruncated,
  tenantPeopleWithheld,
} from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Panel } from "../ui/Panel.tsx";
import { Table } from "../ui/Table.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { TenantInvite } from "./TenantInvite.tsx";
import { TenantPersonRow } from "./TenantPersonRow.tsx";
import { useTenantAbilities, useTenantPeople } from "./tenantPeopleResource.ts";

function TenantPeopleTable(props: {
  readonly tenant: string;
  readonly listed: AccessTenantPeople;
  readonly abilities: AccessTenantAbilities | undefined;
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
              abilities={props.abilities}
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
  const tenant = useSettingsTenant();
  const people = useTenantPeople(tenant);
  const listed = people.state === "Ready" ? people.value : undefined;
  const read = useTenantAbilities(tenant);
  const abilities = read.state === "Ready" ? read.value : undefined;
  return (
    <SettingsPage title="People">
      <Panel
        variant="section"
        title="People"
        about="Who is in this workspace, and the roles each holds."
        meta={
          listed === undefined ||
          abilities === undefined ||
          !tenantInvitationOffered(abilities) ? undefined : (
            <TenantInvite
              tenant={tenant}
              projects={listed.projects}
              abilities={abilities}
            />
          )
        }
      >
        {people.state === "Absent" ? (
          <Notice tone="parked" inline detail={tenantPeopleWithheld} />
        ) : (
          <PanelUnready state={people} />
        )}
        {listed === undefined ? null : (
          <TenantPeopleTable
            tenant={tenant}
            listed={listed}
            abilities={abilities}
          />
        )}
        {listed === undefined || read.state === "Pending" ? null : (
          <PanelUnready state={read} />
        )}
      </Panel>
    </SettingsPage>
  );
}
