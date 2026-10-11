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
 *
 * The workspace's invite links are read beside the people, and only a read
 * that answered with a list draws anything: a plane that keeps no links, a
 * read not yet answered and one that failed all leave the page as it is
 * without them, with no way to make a link and no section of them.
 */

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
  tenantPeopleWithheld,
  tenantPersonEditOffered,
} from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  SettingsListing,
  SettingsListingCut,
  SettingsListingSection,
  SettingsListingTable,
  SettingsListingUnread,
} from "./SettingsListing.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { TenantInvite } from "./TenantInvite.tsx";
import { TenantInviteLinks } from "./TenantInviteLinks.tsx";
import { TenantPersonRow } from "./TenantPersonRow.tsx";
import {
  useTenantAbilities,
  useTenantInviteLinks,
  useTenantPeople,
} from "./tenantPeopleResource.ts";

import "./tenantPeople.css";

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
    <SettingsListingTable caption={props.caption}>
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
    </SettingsListingTable>
  );
}

function TenantPeopleListed(props: {
  readonly tenant: string;
  readonly listed: AccessTenantPeople;
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const { tenant, listed, abilities } = props;
  const read = useTenantInviteLinks(tenant);
  const links = read.state === "Ready" ? read.value.links : undefined;
  const parted = tenantPeopleParted(listed.people);
  const otherIssuers = tenantPeopleOtherIssuersLine(listed.otherIssuers);
  const table = { tenant, projects: listed.projects, abilities };
  return (
    <>
      <SettingsListingSection
        heading={tenantPeopleCountLine(parted.people.length)}
        action={
          abilities === undefined ||
          !tenantInvitationOffered(abilities) ? undefined : (
            <TenantInvite
              tenant={tenant}
              projects={listed.projects}
              abilities={abilities}
              links={links !== undefined}
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
      </SettingsListingSection>
      {links === undefined ? null : (
        <TenantInviteLinks
          tenant={tenant}
          links={links}
          abilities={abilities}
        />
      )}
      {parted.identities.length === 0 ? null : (
        <SettingsListingSection heading="Other identities">
          <TenantPeopleTable
            caption="Other identities"
            named="Identity"
            people={parted.identities}
            {...table}
          />
        </SettingsListingSection>
      )}
      {otherIssuers === undefined ? null : (
        <Notice tone="info" inline detail={otherIssuers} />
      )}
      {listed.truncated ? <SettingsListingCut /> : null}
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
      <SettingsListing>
        {people.state === "Ready" ? (
          <TenantPeopleListed
            tenant={tenant}
            listed={people.value}
            abilities={abilities}
          />
        ) : (
          <SettingsListingUnread
            state={people}
            withheld={tenantPeopleWithheld}
          />
        )}
        {people.state !== "Ready" || read.state === "Pending" ? null : (
          <PanelUnready state={read} />
        )}
      </SettingsListing>
    </SettingsPage>
  );
}
