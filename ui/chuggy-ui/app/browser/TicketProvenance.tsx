/**
 * Where this ticket came from: the brief it runs and the configuration it was
 * released under, both read off the ticket itself, and the authoring the
 * retained draft holds. A configuration is named where the wire names it and
 * drawn as its revision where it is not. The live revision is named with the
 * draft version it was released from, and a draft revised since says it holds
 * changes no update has released, which is why the brief is never drawn from
 * the draft: a Pending ticket's draft may be ahead of what the ticket runs.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketBriefBody } from "../../../../src/contract/brief.ts";
import type {
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { apiConfiguration } from "../core/apiRoutes.ts";
import { briefLandingLine } from "../core/codeLabels.ts";
import type { PanelState } from "../core/freshness.ts";
import { configurationLabel } from "../core/labels.ts";
import {
  draftReleaseLine,
  draftReleaseOf,
  ticketRevisionLine,
} from "../core/ticketEdit.ts";
import { usePanelResource } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

function Field(props: {
  readonly name: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="legacy-field">
      <dt>{props.name}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/**
 * What a person asked for. A ticket released before the brief was on the wire
 * carries none and says so rather than drawing empty fields, and one released
 * before a landing was recorded draws no landing at all.
 */
function Brief(props: { readonly brief: TicketBriefBody }): ReactNode {
  const { intent, links, checks, branch, finalization } = props.brief;
  return (
    <>
      <Field name="intent">
        <p className="whitespace-pre-wrap">{intent}</p>
      </Field>
      <Field name="links">
        {links.length === 0 ? (
          "none"
        ) : (
          <ul>
            {links.map((link) => (
              <li key={link}>
                <a href={link} rel="noopener noreferrer" target="_blank">
                  {link}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field name="checks">
        {checks === undefined || checks.length === 0 ? (
          "none"
        ) : (
          <ul>
            {checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        )}
      </Field>
      <Field name="branch">{branch ?? "none"}</Field>
      {finalization === undefined ? null : (
        <Field name="landing">{briefLandingLine(finalization)}</Field>
      )}
    </>
  );
}

/** The configuration the ticket's last release or update pinned, as a label
 * that keeps the revision on hover. */
function ReleasedUnder(props: { readonly ticket: TicketResponse }): ReactNode {
  const revision = props.ticket.configurationRevision;
  if (revision === undefined) return null;
  const released = configurationLabel(
    revision,
    props.ticket.configurationVersion,
  );
  return (
    <Field name="released under">
      <Tooltip text={released.title}>
        <span>{released.text}</span>
      </Tooltip>
    </Field>
  );
}

export function TicketBrief(props: {
  readonly state: PanelState<TicketResponse>;
}): ReactNode {
  return (
    <DataPanel title="brief" state={props.state}>
      {(ticket) => (
        <dl className="legacy-fields">
          {ticket.brief === undefined ? (
            <Field name="brief">
              <span className="panel-absent">
                this ticket was released before a brief was kept for one
              </span>
            </Field>
          ) : (
            <Brief brief={ticket.brief} />
          )}
          <ReleasedUnder ticket={ticket} />
        </dl>
      )}
    </DataPanel>
  );
}

/** The revision field waits on the ticket read, which carries the revision. */
function Authoring(props: {
  readonly draft: DraftResponse;
  readonly revision: number | undefined;
}): ReactNode {
  const authoring = props.draft.authoring;
  const release = draftReleaseOf(props.draft);
  return (
    <dl className="legacy-fields">
      {props.revision === undefined ? null : (
        <Field name="live">{ticketRevisionLine(props.revision, release)}</Field>
      )}
      <Field name="draft">{draftReleaseLine(release)}</Field>
      <Field name="dependencies">
        {authoring.dependencies.length === 0
          ? "none"
          : authoring.dependencies.join(", ")}
      </Field>
      <Field name="evaluation stages">
        {authoring.program.length === 0
          ? "none"
          : authoring.program
              .map((stage) => `${String(stage.evaluators.length)}×`)
              .join(" then ")}
      </Field>
    </dl>
  );
}

function TicketConfiguration(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
  readonly version: TicketResponse["configurationVersion"];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const label = configurationLabel(props.revision, props.version);
  const state = usePanelResource(
    props.partition,
    "Configuration",
    props.revision,
    (ports) => apiConfiguration(ports, props.partition, props.revision),
  );
  return (
    <DataPanel title={`configuration ${label.text}`} state={state}>
      {(configuration) => (
        <div className="configuration">
          <dl className="legacy-fields">
            <Field name="revision">
              <code>{label.title}</code>
            </Field>
            <Field name="digest">
              <code>{configuration.digest}</code>
            </Field>
            {configuration.parent === undefined ? null : (
              <Field name="parent">{configuration.parent}</Field>
            )}
          </dl>
          <Disclosure
            open={open}
            onOpenChange={setOpen}
            label={open ? "hide canonical" : "show canonical"}
          >
            <pre className="canonical">{configuration.canonical}</pre>
          </Disclosure>
        </div>
      )}
    </DataPanel>
  );
}

export function TicketProvenance(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<DraftResponse>;
  /** The ticket, absent until it is read. */
  readonly ticket: TicketResponse | undefined;
}): ReactNode {
  const released = props.ticket?.configurationRevision;
  return (
    <>
      <DataPanel title="provenance" state={props.state}>
        {(draft) => (
          <Authoring draft={draft} revision={props.ticket?.revision} />
        )}
      </DataPanel>
      {released === undefined ? null : (
        <TicketConfiguration
          partition={props.partition}
          revision={released}
          version={props.ticket?.configurationVersion}
        />
      )}
    </>
  );
}
