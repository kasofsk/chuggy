/**
 * Where this ticket came from: the brief a person wrote, the authoring the
 * retained draft holds, and the configuration revision it was released under.
 *
 * The draft is the record of what was released, so a ticket whose draft the
 * API will not show reads as an absence with its reason rather than as a page
 * with two empty panels.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketBriefBody } from "../../../../src/contract/brief.ts";
import type { DraftResponse } from "../../../../src/contract/responses.ts";
import { apiConfiguration } from "../core/apiRoutes.ts";
import type { PanelState } from "../core/freshness.ts";
import { projectResourceKey } from "../core/projectQueryKeys.ts";
import { usePanelQuery } from "./api.ts";
import { Panel } from "./Panel.tsx";

function Field(props: {
  readonly name: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="field">
      <dt>{props.name}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/**
 * What a person asked for. A ticket released before the brief was on the wire
 * carries none, and says so rather than drawing empty fields.
 */
function Brief(props: { readonly brief: TicketBriefBody }): ReactNode {
  const { intent, links, branch } = props.brief;
  return (
    <>
      <Field name="intent">
        <p className="intent">{intent}</p>
      </Field>
      <Field name="links">
        {links.length === 0 ? (
          "none"
        ) : (
          <ul className="links">
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
      <Field name="branch">{branch ?? "none"}</Field>
    </>
  );
}

export function TicketBrief(props: {
  readonly state: PanelState<DraftResponse>;
}): ReactNode {
  return (
    <Panel title="brief" state={props.state}>
      {(draft) => (
        <dl className="fields">
          {draft.brief === undefined ? (
            <Field name="intent, links, branch">
              <span className="panel-absent">
                this ticket was released before a brief was kept for one
              </span>
            </Field>
          ) : (
            <Brief brief={draft.brief} />
          )}
          <Field name="released under">{draft.configurationRevision}</Field>
          <Field name="draft">
            {draft.state} at version {draft.authoringVersion}
          </Field>
        </dl>
      )}
    </Panel>
  );
}

function pricingLabel(
  pricing: DraftResponse["authoring"]["finalizationPricing"],
): string {
  return pricing === "DeadlineOnly"
    ? "deadline only"
    : `budgeted ${String(pricing.value)}`;
}

function Authoring(props: { readonly draft: DraftResponse }): ReactNode {
  const authoring = props.draft.authoring;
  return (
    <dl className="fields">
      <Field name="dependencies">
        {authoring.dependencies.length === 0
          ? "none"
          : authoring.dependencies.join(", ")}
      </Field>
      <Field name="evaluation stages">
        {authoring.program.length === 0
          ? "none"
          : authoring.program
              .map((stage) => `${String(stage.fanout)}× ${stage.combinator}`)
              .join(" then ")}
      </Field>
      <Field name="work fanout">{authoring.workFanout}</Field>
      <Field name="rework">{authoring.reworkPolicy.value}</Field>
      <Field name="finalization">
        {pricingLabel(authoring.finalizationPricing)}
      </Field>
      <Field name="resume pricing">{authoring.resumePricing}</Field>
      <Field name="finalizer">{authoring.finalizer}</Field>
    </dl>
  );
}

function TicketConfiguration(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const state = usePanelQuery(
    projectResourceKey(props.partition, "Configuration", props.revision),
    (ports) => apiConfiguration(ports, props.partition, props.revision),
  );
  return (
    <Panel title={`configuration ${props.revision}`} state={state}>
      {(configuration) => (
        <div className="configuration">
          <dl className="fields">
            <Field name="digest">
              <code>{configuration.digest}</code>
            </Field>
            {configuration.parent === undefined ? null : (
              <Field name="parent">{configuration.parent}</Field>
            )}
          </dl>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? "hide canonical" : "show canonical"}
          </button>
          {open ? (
            <pre className="canonical">{configuration.canonical}</pre>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function TicketProvenance(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<DraftResponse>;
}): ReactNode {
  return (
    <>
      <Panel title="provenance" state={props.state}>
        {(draft) => <Authoring draft={draft} />}
      </Panel>
      {props.state.state === "Ready" ? (
        <TicketConfiguration
          partition={props.partition}
          revision={props.state.value.configurationRevision}
        />
      ) : null}
    </>
  );
}
