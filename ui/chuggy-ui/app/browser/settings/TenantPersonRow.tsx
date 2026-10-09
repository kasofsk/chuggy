/**
 * One person in a workspace as one table row: who they are, what they hold in
 * the workspace as chips, the projects they hold a role on as a line each, and
 * the Edit that opens their editor where the reader may change anything.
 * Nothing a person does not hold is drawn, so a row is read without knowing
 * what the reader may grant.
 */

import type { ReactNode } from "react";

import type {
  AccessAuthorityPerson,
  AccessTenantAbilities,
  AccessTenantPerson,
} from "../../../../../src/contract/accessPlane.ts";
import {
  tenantPersonEveryProject,
  tenantPersonEveryProjectLine,
  tenantPersonHeld,
  tenantPersonName,
  tenantPersonProjectLines,
} from "../../core/tenantPeople.ts";
import type { TenantPersonProjectLine } from "../../core/tenantPeople.ts";
import { Identity } from "../ui/Identity.tsx";
import { Pill } from "../ui/Pill.tsx";
import {
  SettingsListingNone,
  settingsListingNone,
} from "./SettingsListing.tsx";
import { TenantPersonEditor } from "./TenantPersonEditor.tsx";

import "./tenantPeople.css";

/** Who one person is on one line: their address or their subject, then
 * quietly their login, that they are no account, and that they are the reader. */
export function TenantPersonWho(props: {
  readonly person: AccessAuthorityPerson;
}): ReactNode {
  const named = tenantPersonName(props.person);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 wrap-anywhere">
      {named.subject ? (
        <Identity label={{ text: named.name, title: named.name }} />
      ) : (
        <span>{named.name}</span>
      )}
      {named.githubLogin === undefined ? null : (
        <span className="text-sm text-ink-3">{named.githubLogin}</span>
      )}
      {named.noAccount ? (
        <span className="text-sm text-ink-3">No account</span>
      ) : null}
      {props.person.mine ? (
        <span className="text-sm text-ink-3">You</span>
      ) : null}
    </span>
  );
}

/** A row's own heading: the name strong with the reader marked beside it, and
 * the GitHub login under it. */
function TenantPersonNamed(props: {
  readonly person: AccessTenantPerson;
}): ReactNode {
  const named = tenantPersonName(props.person);
  return (
    <span className="grid min-w-0">
      <span className="flex min-w-0 items-baseline gap-2">
        {named.subject ? (
          <span className="people-name">
            <Identity label={{ text: named.name, title: named.name }} />
          </span>
        ) : (
          <span
            className="people-name font-strong text-ink-1"
            title={named.name}
          >
            {named.name}
          </span>
        )}
        {props.person.mine ? (
          <span className="shrink-0 text-sm text-ink-3">You</span>
        ) : null}
      </span>
      {named.githubLogin === undefined ? null : (
        <span className="truncate text-sm text-ink-3">{named.githubLogin}</span>
      )}
    </span>
  );
}

function TenantPersonHeld(props: {
  readonly held: readonly string[];
}): ReactNode {
  if (props.held.length === 0) return <SettingsListingNone />;
  return (
    <ul className="flex flex-wrap gap-1">
      {props.held.map((word) => (
        <li key={word} className="flex">
          <Pill tone="neutral">{word}</Pill>
        </li>
      ))}
    </ul>
  );
}

function TenantPersonProjects(props: {
  readonly every: boolean;
  readonly lines: readonly TenantPersonProjectLine[];
}): ReactNode {
  const lines = props.lines;
  if (!props.every && lines.length === 0) return <SettingsListingNone />;
  return (
    <div className="grid min-w-0">
      {props.every ? <span>{tenantPersonEveryProjectLine}</span> : null}
      {lines.length === 0 ? null : (
        <dl className="people-projects">
          {lines.map((line) => (
            <div key={line.project} className="contents">
              <dt className="truncate">{line.project}</dt>
              <dd className="text-ink-3">{line.roles}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function TenantPersonRow(props: {
  readonly tenant: string;
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
  /** Whether the table has a column of editors, which is the reader's to have and not this person's. */
  readonly editable: boolean;
}): ReactNode {
  const person = props.person;
  const held = tenantPersonHeld(person);
  const every = tenantPersonEveryProject(person);
  const lines = tenantPersonProjectLines(person, props.projects);
  return (
    <tr>
      <th scope="row">
        <TenantPersonNamed person={person} />
      </th>
      <td data-none={settingsListingNone(held.length === 0)}>
        <TenantPersonHeld held={held} />
      </td>
      <td data-none={settingsListingNone(!every && lines.length === 0)}>
        <TenantPersonProjects every={every} lines={lines} />
      </td>
      {props.editable ? (
        <td className="people-edit">
          <TenantPersonEditor
            tenant={props.tenant}
            person={person}
            projects={props.projects}
            abilities={props.abilities}
          />
        </td>
      ) : null}
    </tr>
  );
}
