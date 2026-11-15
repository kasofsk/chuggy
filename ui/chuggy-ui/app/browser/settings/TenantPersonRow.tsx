/**
 * One person in a workspace as one table row: who they are, what they hold in
 * the workspace as chips, the projects they hold a role on as a line each, and
 * the Edit that opens their editor where the reader may change anything.
 * Nothing a person does not hold is drawn, so a row is read without knowing
 * what the reader may grant.
 *
 * The chips and the project lines are drawn here for an invite link's row
 * too, which carries what a person would hold.
 */

import type { ReactNode } from "react";

import type {
  AccessAuthorityPerson,
  AccessTenantAbilities,
  AccessTenantPerson,
} from "../../../../../src/contract/accessPlane.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { Copy } from "../../core/copy.ts";
import {
  tenantHeldEveryProject,
  tenantHeldEveryProjectLine,
  tenantHeldProjectLines,
  tenantHeldWords,
  tenantPersonName,
} from "../../core/tenantPeople.ts";
import type { TenantHeldProjectLine } from "../../core/tenantPeople.ts";
import { Identity } from "../ui/Identity.tsx";
import { Pill } from "../ui/Pill.tsx";
import type { TableRow } from "../ui/Table.tsx";
import { SettingsListingNone } from "./SettingsListing.tsx";
import { TenantPersonEditor } from "./TenantPersonEditor.tsx";

import "./tenantPeople.css";

/** Who one person is on one line: their address or their subject, then
 * quietly their login, that they are no account, and that they are the reader. */
export function TenantPersonWho(props: {
  readonly person: AccessAuthorityPerson;
}): ReactNode {
  const text = useCopyText();
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
        <span className="text-sm text-ink-3">
          {text({ id: "permissions-person-unaccounted" })}
        </span>
      ) : null}
      {props.person.mine ? (
        <span className="text-sm text-ink-3">
          {text({ id: "permissions-person-mine" })}
        </span>
      ) : null}
    </span>
  );
}

/** A row's own heading: the name strong with the reader marked beside it, and
 * the GitHub login under it. */
function TenantPersonNamed(props: {
  readonly person: AccessTenantPerson;
}): ReactNode {
  const text = useCopyText();
  const named = tenantPersonName(props.person);
  return (
    <span className="grid min-w-0">
      <span className="flex min-w-0 items-baseline gap-2">
        {named.subject ? (
          <span className="tabular-cut">
            <Identity label={{ text: named.name, title: named.name }} />
          </span>
        ) : (
          <span
            className="tabular-cut font-strong text-ink-1"
            title={named.name}
          >
            {named.name}
          </span>
        )}
        {props.person.mine ? (
          <span className="shrink-0 text-sm font-regular text-ink-3">
            {text({ id: "permissions-person-mine" })}
          </span>
        ) : null}
      </span>
      {named.githubLogin === undefined ? null : (
        <span className="truncate text-sm font-regular text-ink-3">
          {named.githubLogin}
        </span>
      )}
    </span>
  );
}

/** What is held in the workspace as a chip a word, or the listing's none-mark. */
export function TenantHeldWords(props: {
  readonly held: readonly Copy[];
}): ReactNode {
  const text = useCopyText();
  if (props.held.length === 0) return <SettingsListingNone />;
  return (
    <ul className="flex flex-wrap gap-1">
      {props.held.map((word) => (
        <li key={word.id} className="flex">
          <Pill tone="neutral">{text(word)}</Pill>
        </li>
      ))}
    </ul>
  );
}

/** The projects a role is held on as a line each, under the one line that
 * says every project is, or the listing's none-mark. */
export function TenantHeldProjects(props: {
  readonly every: boolean;
  readonly lines: readonly TenantHeldProjectLine[];
}): ReactNode {
  const text = useCopyText();
  const lines = props.lines;
  if (!props.every && lines.length === 0) return <SettingsListingNone />;
  return (
    <div className="grid min-w-0 font-regular">
      {props.every ? <span>{text(tenantHeldEveryProjectLine)}</span> : null}
      {lines.length === 0 ? null : (
        <dl className="people-projects">
          {lines.map((line) => (
            <div key={line.project} className="contents">
              <dt className="truncate">{line.project}</dt>
              <dd className="text-ink-3">{line.roles.map(text).join(", ")}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** The columns of a table of people, the editor's last where the reader has one. */
export type TenantPersonColumn = "person" | "held" | "projects" | "edit";

/** One person's row, its editor drawn only where the table has a column of
 * them, which is the reader's to have and not this person's. */
export function tenantPersonRow(props: {
  readonly tenant: string;
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
  readonly editable: boolean;
}): TableRow<TenantPersonColumn> {
  const person = props.person;
  const held = tenantHeldWords(person);
  const every = tenantHeldEveryProject(person);
  const lines = tenantHeldProjectLines(person, props.projects);
  const empty: TenantPersonColumn[] = [];
  if (held.length === 0) empty.push("held");
  if (!every && lines.length === 0) empty.push("projects");
  return {
    key: person.subject,
    cells: {
      person: <TenantPersonNamed person={person} />,
      held: <TenantHeldWords held={held} />,
      projects: <TenantHeldProjects every={every} lines={lines} />,
      edit: props.editable ? (
        <TenantPersonEditor
          tenant={props.tenant}
          person={person}
          projects={props.projects}
          abilities={props.abilities}
        />
      ) : null,
    },
    empty,
  };
}
