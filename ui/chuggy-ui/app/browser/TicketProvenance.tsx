/**
 * Where this ticket came from: the brief a person wrote, the authoring the
 * retained draft holds, and the configuration it was released under, which is
 * named where the wire names it and drawn as its revision where it is not.
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
import { configurationLabel } from "../core/labels.ts";
import { usePanelResource } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";

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

/** How a brief reaches the reference it lands on, which is the whole of what
 * its two modes differ in. */
function briefLandingName(
  finalization: NonNullable<TicketBriefBody["finalization"]>,
): string {
  switch (finalization.mode) {
    case "Push":
      return "lands on";
    case "PullRequest":
      return "proposed into";
  }
}

/**
 * What a person asked for. A ticket released before the brief was on the wire
 * carries none and says so rather than drawing empty fields, and where the
 * work lands is drawn only where the brief names a second reference — the
 * branch above it is the answer whenever it does not.
 */
function Brief(props: { readonly brief: TicketBriefBody }): ReactNode {
  const { intent, links, branch, finalization } = props.brief;
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
      {finalization?.target === undefined ? null : (
        <Field name={briefLandingName(finalization)}>
          {finalization.target}
        </Field>
      )}
    </>
  );
}

export function TicketBrief(props: {
  readonly state: PanelState<DraftResponse>;
}): ReactNode {
  return (
    <DataPanel title="brief" state={props.state}>
      {(draft) => {
        const released = configurationLabel(
          draft.configurationRevision,
          draft.configurationVersion,
        );
        return (
          <dl className="fields">
            {draft.brief === undefined ? (
              <Field name="intent, links, branch, landing">
                <span className="panel-absent">
                  this ticket was released before a brief was kept for one
                </span>
              </Field>
            ) : (
              <Brief brief={draft.brief} />
            )}
            <Field name="released under">
              <span title={released.title}>{released.text}</span>
            </Field>
            <Field name="draft">
              {draft.state} at version {draft.authoringVersion}
            </Field>
          </dl>
        );
      }}
    </DataPanel>
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
  readonly version: DraftResponse["configurationVersion"];
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
          <dl className="fields">
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
    </DataPanel>
  );
}

export function TicketProvenance(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<DraftResponse>;
}): ReactNode {
  return (
    <>
      <DataPanel title="provenance" state={props.state}>
        {(draft) => <Authoring draft={draft} />}
      </DataPanel>
      {props.state.state === "Ready" ? (
        <TicketConfiguration
          partition={props.partition}
          revision={props.state.value.configurationRevision}
          version={props.state.value.configurationVersion}
        />
      ) : null}
    </>
  );
}
