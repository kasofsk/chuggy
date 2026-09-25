/**
 * Where this ticket came from: the brief, a summary of the live revision and
 * the draft beside it, and the configuration the live revision pins — its
 * settings, the brief and instructions each role is briefed with, and its
 * declared evaluation stages.
 *
 * A configuration is named where the wire names it and drawn as its revision
 * where it is not. Dependencies cannot change once a ticket is released, so
 * the summary reads them off the draft even where a Pending ticket's draft has
 * moved past its release in every other way.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { Tabs } from "radix-ui";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketBriefBody } from "../../../../src/contract/brief.ts";
import type {
  ConfigurationResponse,
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { apiConfiguration } from "../core/apiRoutes.ts";
import { briefLandingLine, landingLabel } from "../core/codeLabels.ts";
import type {
  ConfigurationBrief,
  ConfigurationEvaluation,
  ConfigurationRole,
  ConfigurationSettings,
} from "../core/configurationView.ts";
import {
  configurationViewOf,
  practiceLabel,
} from "../core/configurationView.ts";
import { agoFigure } from "../core/figures.ts";
import type { PanelState } from "../core/freshness.ts";
import { configurationLabel, digestShortened } from "../core/labels.ts";
import { draftReleaseOf, draftUnreleasedLabel } from "../core/ticketEdit.ts";
import { usePanelResource } from "./api.ts";
import { DataSection, PanelUnready } from "./DataPanel.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Freshness } from "./Freshness.tsx";
import { Panel } from "./ui/Panel.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./ticket/ticket.css";

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
    <DataSection state={props.state}>
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
    </DataSection>
  );
}

/** One cell of a summary grid: a small key above a value, and an optional
 * dim line under it for what the value alone does not say. */
function SummaryCell(props: {
  readonly name: string;
  readonly value: ReactNode;
  readonly meta?: ReactNode;
  readonly large?: boolean;
}): ReactNode {
  return (
    <div className="ticket-config-cell">
      <span className="eyebrow">{props.name}</span>
      <span
        className={
          props.large === true
            ? "ticket-config-value-lg"
            : "ticket-config-value"
        }
      >
        {props.value}
      </span>
      {props.meta === undefined ? null : (
        <span className="ticket-config-meta">{props.meta}</span>
      )}
    </div>
  );
}

const absentMark = <span className="ticket-config-absent">—</span>;

/** The live revision and when it released, the draft beside it, its
 * dependencies, and where the finished work lands. */
function ProvenanceSummary(props: {
  readonly draft: DraftResponse;
  readonly ticket: TicketResponse | undefined;
  readonly nowMs: number;
}): ReactNode {
  const ticket = props.ticket;
  const dependencies = props.draft.authoring.dependencies;
  const finalization = ticket?.brief?.finalization;
  const branch = ticket?.brief?.branch;
  return (
    <div className="ticket-provenance-summary">
      <SummaryCell
        name="Live"
        value={
          ticket?.revision === undefined
            ? absentMark
            : `Revision ${String(ticket.revision)}`
        }
        meta={
          ticket?.releasedAt === undefined ? undefined : (
            <>
              released{" "}
              <Figure figure={agoFigure(ticket.releasedAt, props.nowMs)} />
            </>
          )
        }
      />
      <SummaryCell
        name="Draft"
        value={draftUnreleasedLabel(draftReleaseOf(props.draft))}
      />
      <SummaryCell
        name="Dependencies"
        value={dependencies.length === 0 ? "None" : dependencies.join(", ")}
      />
      <SummaryCell
        name="Lands"
        value={
          finalization === undefined
            ? absentMark
            : landingLabel(finalization.mode)
        }
        meta={branch === undefined ? undefined : <code>{branch}</code>}
      />
    </div>
  );
}

function ConfigurationChips(props: {
  readonly items: readonly string[];
}): ReactNode {
  return (
    <div className="ticket-config-chips">
      {props.items.map((item) => (
        <span key={item} className="ticket-config-chip">
          {item}
        </span>
      ))}
    </div>
  );
}

function ConfigurationText(props: {
  readonly heading?: string;
  readonly lines: readonly string[];
}): ReactNode {
  if (props.lines.length === 0) return null;
  return (
    <div className="ticket-config-text">
      {props.heading === undefined ? null : (
        <h3 className="eyebrow">{props.heading}</h3>
      )}
      {props.lines.map((line, index) => (
        <p key={`${String(index)}:${line}`} className="ticket-config-doc">
          {line}
        </p>
      ))}
    </div>
  );
}

/** What one role — work or review — is briefed with beyond the shared brief:
 * its own instructions or, run by the worker itself, its commands, and the
 * practices it is held to. */
function ConfigurationRoleBody(props: {
  readonly brief: ConfigurationBrief;
  readonly role: ConfigurationRole;
}): ReactNode {
  const role = props.role;
  return (
    <article className="ticket-config-role">
      <ConfigurationText heading="Motivation" lines={props.brief.motivation} />
      <ConfigurationText
        heading="Acceptance criteria"
        lines={props.brief.acceptanceCriteria}
      />
      <ConfigurationText
        heading="Constraints"
        lines={props.brief.constraints}
      />
      {role.instructions === undefined ? (
        role.commands === undefined ? null : (
          <div className="ticket-config-text">
            <h3 className="eyebrow">Runs</h3>
            {role.commands.map((line, index) => (
              <code
                key={`${String(index)}:${line}`}
                className="ticket-config-command"
              >
                {line}
              </code>
            ))}
          </div>
        )
      ) : (
        <ConfigurationText heading="Instructions" lines={role.instructions} />
      )}
      {role.practices === undefined || role.practices.length === 0 ? null : (
        <div className="ticket-config-text">
          <h3 className="eyebrow">Practices</h3>
          <ConfigurationChips items={role.practices.map(practiceLabel)} />
        </div>
      )}
    </article>
  );
}

const instructionTabs = ["Work", "Review"] as const;

function ConfigurationInstructions(props: {
  readonly brief: ConfigurationBrief;
  readonly work: ConfigurationRole;
  readonly review: ConfigurationRole;
}): ReactNode {
  return (
    <Tabs.Root className="ticket-config-instructions" defaultValue="Work">
      <div className="ticket-config-instructions-bar">
        <span className="panel-title">Instructions</span>
        <Tabs.List className="ticket-config-tabs" aria-label="Instructions for">
          {instructionTabs.map((tab) => (
            <Tabs.Trigger key={tab} value={tab} className="ticket-config-tab">
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <span className="ticket-config-instructions-caption">
          As configured · a run's exact prompt is in its conversation
        </span>
      </div>
      {instructionTabs.map((tab) => (
        <Tabs.Content key={tab} value={tab}>
          <ConfigurationRoleBody
            brief={props.brief}
            role={tab === "Work" ? props.work : props.review}
          />
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

function ConfigurationEvaluationRow(props: {
  readonly index: number;
  readonly evaluation: ConfigurationEvaluation;
}): ReactNode {
  const evaluation = props.evaluation;
  const label = `Stage ${String(props.index + 1)}${
    evaluation.purpose === undefined ? "" : ` · ${evaluation.purpose}`
  }`;
  return (
    <div className="ticket-config-evaluation-row">
      <span className="ticket-config-evaluation-label">{label}</span>
      <div className="ticket-config-evaluation-body">
        {evaluation.checks === undefined ? null : (
          <div className="ticket-config-evaluation-runs">
            <span className="ticket-config-evaluation-runs-label">Runs</span>
            {evaluation.checks.map((check) => (
              <code key={check} className="ticket-config-command">
                {check}
              </code>
            ))}
          </div>
        )}
        {evaluation.instructions === undefined ? null : (
          <ConfigurationText lines={evaluation.instructions} />
        )}
        {evaluation.practices === undefined ||
        evaluation.practices.length === 0 ? null : (
          <ConfigurationChips items={evaluation.practices.map(practiceLabel)} />
        )}
      </div>
    </div>
  );
}

function ConfigurationEvaluations(props: {
  readonly evaluations: readonly ConfigurationEvaluation[];
}): ReactNode {
  if (props.evaluations.length === 0) return null;
  return (
    <div className="ticket-config-evaluations">
      <span className="panel-title">Evaluation</span>
      <div className="ticket-config-evaluation-grid">
        {props.evaluations.map((evaluation, index) => (
          <ConfigurationEvaluationRow
            key={index}
            index={index}
            evaluation={evaluation}
          />
        ))}
      </div>
    </div>
  );
}

function joinedOrAbsent(items: readonly string[] | undefined): ReactNode {
  return items === undefined || items.length === 0
    ? absentMark
    : items.join(" · ");
}

function ConfigurationSettingsGrid(props: {
  readonly settings: ConfigurationSettings;
}): ReactNode {
  const settings = props.settings;
  return (
    <div className="ticket-config-settings">
      <SummaryCell
        name="Model"
        large
        value={settings.model.label}
        meta={
          settings.model.argument === undefined ? undefined : (
            <code>{settings.model.argument}</code>
          )
        }
      />
      <SummaryCell
        name="Agent"
        value={settings.agent ?? absentMark}
        meta={settings.agentDetail}
      />
      <SummaryCell
        name="Worker"
        value={
          settings.worker === undefined ? (
            absentMark
          ) : (
            <Tooltip text={settings.worker.full}>
              <code>{settings.worker.short}</code>
            </Tooltip>
          )
        }
      />
      <SummaryCell name="Tools" value={joinedOrAbsent(settings.tools)} />
      <SummaryCell
        name="Credentials"
        value={joinedOrAbsent(settings.credentials)}
      />
      <SummaryCell name="Access" value={settings.access ?? absentMark} />
      <SummaryCell
        name="Setup"
        value={
          settings.setup === undefined ? (
            absentMark
          ) : (
            <code>{settings.setup.join(" · ")}</code>
          )
        }
      />
      <SummaryCell
        name="Completes task"
        value={
          settings.completesTask === undefined
            ? absentMark
            : settings.completesTask
              ? "Yes"
              : "No"
        }
      />
    </div>
  );
}

/** The name and version chip a repository import carries, or the bare
 * revision an authored one has no label for. */
function ConfigurationHeaderLabel(props: {
  readonly revision: string;
  readonly version: TicketResponse["configurationVersion"];
}): ReactNode {
  const label = configurationLabel(props.revision, props.version);
  return props.version === undefined ? (
    <code className="ticket-config-name">{label.text}</code>
  ) : (
    <>
      <code className="ticket-config-name">{props.version.name}</code>{" "}
      <span className="ticket-config-chip">{`#${String(props.version.number)}`}</span>
    </>
  );
}

/** The digest this document hashes to and the revision it is filed under,
 * kept legible where the settings grid above has already drawn everything
 * either one would otherwise be needed to tell apart. */
function ConfigurationFoot(props: {
  readonly revision: string;
  readonly digest: string;
  readonly canonical: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="ticket-config-foot">
      <span>Digest</span>
      <Tooltip text={props.digest}>
        <code>{digestShortened(props.digest)}</code>
      </Tooltip>
      <span>·</span>
      <span>revision</span>
      <code>{props.revision}</code>
      <span className="grow" />
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        label="Canonical JSON"
        look={{ variant: "quiet", size: "sm" }}
      >
        <pre className="ticket-config-canonical">{props.canonical}</pre>
      </Disclosure>
    </div>
  );
}

function ConfigurationBody(props: {
  readonly configuration: ConfigurationResponse;
}): ReactNode {
  const configuration = props.configuration;
  const view = configurationViewOf(configuration.canonical);
  return (
    <div className="ticket-config">
      <ConfigurationSettingsGrid settings={view.settings} />
      <ConfigurationInstructions
        brief={view.brief}
        work={view.work}
        review={view.review}
      />
      <ConfigurationEvaluations evaluations={view.evaluations} />
      <ConfigurationFoot
        revision={configuration.revision}
        digest={configuration.digest}
        canonical={configuration.canonical}
      />
    </div>
  );
}

/** The configuration the live revision pins, read by its own revision so a
 * panel that never reads the ticket still reads the right one. */
function ConfigurationPanel(props: {
  readonly partition: PartitionIdentity;
  readonly revision: string;
  readonly version: TicketResponse["configurationVersion"];
}): ReactNode {
  const state = usePanelResource(
    props.partition,
    "Configuration",
    props.revision,
    (ports) => apiConfiguration(ports, props.partition, props.revision),
  );
  return (
    <Panel
      variant="section"
      title={
        <span className="ticket-config-title">
          Configuration{" "}
          <ConfigurationHeaderLabel
            revision={props.revision}
            version={props.version}
          />
        </span>
      }
      meta={
        state.state === "Ready" ? (
          <Freshness observedAtMs={state.observedAtMs} />
        ) : undefined
      }
    >
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <ConfigurationBody configuration={state.value} />
      ) : null}
    </Panel>
  );
}

export function TicketProvenance(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<DraftResponse>;
  /** The ticket, absent until it is read. */
  readonly ticket: TicketResponse | undefined;
  readonly nowMs: number;
}): ReactNode {
  const released = props.ticket?.configurationRevision;
  return (
    <>
      <DataSection state={props.state}>
        {(draft) => (
          <ProvenanceSummary
            draft={draft}
            ticket={props.ticket}
            nowMs={props.nowMs}
          />
        )}
      </DataSection>
      {released === undefined ? null : (
        <ConfigurationPanel
          partition={props.partition}
          revision={released}
          version={props.ticket?.configurationVersion}
        />
      )}
    </>
  );
}
