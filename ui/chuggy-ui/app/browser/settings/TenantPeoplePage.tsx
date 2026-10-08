/**
 * A workspace's people: one row a person, saying what they hold and nothing
 * they do not, under how many there are and the one action inviting someone
 * new. The subjects the plane says are no account are not among the people:
 * they stand in a second table under their own heading, drawn only where
 * there are any.
 *
 * The list answers only a reader holding some authority over the workspace's
 * people, so its absence is this reader's standing rather than a fault: they
 * are told who manages people and offered nothing to change. The abilities are
 * read beside the list, and until they are answered the tables are drawn with
 * no control; where they are not answered beside a list that was, their line
 * is drawn under it.
 */

import { useId } from "react";
import type { ReactNode } from "react";

import type {
  AccessTenantAbilities,
  AccessTenantPeople,
  AccessTenantPerson,
} from "../../../../../src/contract/accessPlane.ts";
import {
  tenantInvitationOffered,
  tenantPeopleCountLine,
  tenantPeopleOtherIssuersLine,
  tenantPeopleParted,
  tenantPeopleTruncated,
  tenantPeopleWithheld,
  tenantPersonEditOffered,
} from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Table } from "../ui/Table.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { TenantInvite } from "./TenantInvite.tsx";
import { TenantPersonRow } from "./TenantPersonRow.tsx";
import { useTenantAbilities, useTenantPeople } from "./tenantPeopleResource.ts";

import "./tenantPeople.css";

const cardClassName = "bg-surface-1 border-edge rounded-2 min-w-0 border";

/** One of the page's two tables, the same columns in each so they line up. */
function TenantPeopleTable(props: {
  readonly caption: string;
  readonly named: string;
  readonly tenant: string;
  readonly people: readonly AccessTenantPerson[];
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const editable = tenantPersonEditOffered(props.abilities, props.projects);
  return (
    <div className={`people-table ${cardClassName}`}>
      <Table caption={props.caption}>
        <thead>
          <tr>
            <th scope="col">{props.named}</th>
            <th scope="col" className="people-col-held">
              Workspace
            </th>
            <th scope="col" className="people-col-projects">
              Projects
            </th>
            {editable ? (
              <th scope="col" className="people-col-edit">
                <span className="visually-hidden">Edit</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {props.people.map((person) => (
            <TenantPersonRow
              key={person.subject}
              tenant={props.tenant}
              person={person}
              projects={props.projects}
              abilities={props.abilities}
              editable={editable}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** A table under the line that heads it, and beside that line the action the
 * table has. */
function TenantPeopleSection(props: {
  readonly heading: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const labelled = useId();
  return (
    <section aria-labelledby={labelled} className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 id={labelled} className="text-md font-medium">
          {props.heading}
        </h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function TenantPeopleListed(props: {
  readonly tenant: string;
  readonly listed: AccessTenantPeople;
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const { tenant, listed, abilities } = props;
  const parted = tenantPeopleParted(listed.people);
  const otherIssuers = tenantPeopleOtherIssuersLine(listed.otherIssuers);
  const table = { tenant, projects: listed.projects, abilities };
  return (
    <>
      <TenantPeopleSection
        heading={tenantPeopleCountLine(parted.people.length)}
        action={
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
        {parted.people.length === 0 ? null : (
          <TenantPeopleTable
            caption="People"
            named="Person"
            people={parted.people}
            {...table}
          />
        )}
      </TenantPeopleSection>
      {parted.identities.length === 0 ? null : (
        <TenantPeopleSection heading="Other identities">
          <TenantPeopleTable
            caption="Other identities"
            named="Identity"
            people={parted.identities}
            {...table}
          />
        </TenantPeopleSection>
      )}
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
  const read = useTenantAbilities(tenant);
  const abilities = read.state === "Ready" ? read.value : undefined;
  return (
    <SettingsPage title="People">
      <div className="@container grid min-w-0 gap-5">
        {people.state === "Ready" ? (
          <TenantPeopleListed
            tenant={tenant}
            listed={people.value}
            abilities={abilities}
          />
        ) : (
          <div className={`${cardClassName} px-4 py-3`}>
            {people.state === "Absent" ? (
              <Notice tone="parked" inline detail={tenantPeopleWithheld} />
            ) : (
              <PanelUnready state={people} />
            )}
          </div>
        )}
        {people.state !== "Ready" || read.state === "Pending" ? null : (
          <PanelUnready state={read} />
        )}
      </div>
    </SettingsPage>
  );
}
