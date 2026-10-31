/**
 * Where this ticket came from: the brief, a summary of the live revision and
 * the draft beside it, and the configuration the live revision runs under — its
 * settings, the brief and instructions each role is briefed with, and its
 * declared evaluation stages.
 *
 * What a ticket runs under is the configuration it pinned with its overrides
 * applied. A field it overrode is drawn as the override and marked so, in the
 * place the panel has for it, and listed under the panel by name where the
 * panel has none; the foot stays the pinned document's, which no override
 * changes.
 *
 * A configuration is named where the wire names it and drawn as its revision
 * where it is not. The summary's dependencies are the live revision's, which
 * a Pending ticket's draft may have been revised past.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { Tabs } from "radix-ui";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { TicketBriefBody } from "../../../../src/contract/brief.ts";
import type { ConfigurationFollowing } from "../../../../src/contract/configurationDocument.ts";
import { configurationFollowingOf } from "../../../../src/contract/configurationSelection.ts";
import type {
  ConfigurationResponse,
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { apiConfiguration } from "../core/apiRoutes.ts";
import { briefLandingLine, landingLabel } from "../core/codeLabels.ts";
import { ticketFollowingSentence } from "../core/codeSentences.ts";
import type {
  ConfigurationBrief,
  ConfigurationEvaluation,
  ConfigurationRole,
  ConfigurationSettings,
  ConfigurationView,
} from "../core/configurationView.ts";
import { practiceLabel } from "../core/configurationView.ts";
import {
  configurationCatalogOf,
  configurationCatalogSelected,
  configurationCatalogWorkload,
} from "../core/configurationCatalog.ts";
import type {
  CatalogPlanStage,
  CatalogWorkload,
  CatalogSelected,
  ConfigurationCatalog,
} from "../core/configurationCatalog.ts";
import { workloadsEffectiveCanonicalOf } from "../core/workloadOverrides.ts";
import { agoFigure } from "../core/figures.ts";
import { overrideFieldOf, overriddenViewOf } from "../core/ticketOverrides.ts";
import type { OverrideField } from "../core/ticketOverrides.ts";
import type { PanelState } from "../core/freshness.ts";
import { repositoryLabel } from "../core/projectRepositories.ts";
import {
  configurationLabel,
  creatorLabel,
  digestShortened,
} from "../core/labels.ts";
import { draftReleaseOf, draftUnreleasedLabel } from "../core/ticketEdit.ts";
import { usePanelResource } from "./api.ts";
import { useCreatorEmails } from "./creatorEmails.ts";
import { DataSection, PanelUnready } from "./DataPanel.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Freshness } from "./Freshness.tsx";
import { Identity } from "./ui/Identity.tsx";
import { Panel } from "./ui/Panel.tsx";
import { ProjectImage } from "./ProjectImage.tsx";
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
 * What a person asked for, its images drawn as images, each from the project's
 * own read of it. A ticket released before the brief was on the wire carries
 * none and says so rather than drawing empty fields, and one released before a
 * landing was recorded draws no landing at all.
 */
function Brief(props: {
  readonly partition: PartitionIdentity;
  readonly brief: TicketBriefBody;
}): ReactNode {
  const { intent, links, images, checks, repository, branch, finalization } =
    props.brief;
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
      {images === undefined || images.length === 0 ? null : (
        <Field name="images">
          <ul className="flex flex-wrap gap-2">
            {images.map((artifact, at) => (
              <li key={artifact}>
                <ProjectImage
                  partition={props.partition}
                  artifact={artifact}
                  alt={`Brief image ${String(at + 1)}`}
                  className="rounded-2 border-edge block max-h-(--height-clip) max-w-full border"
                />
              </li>
            ))}
          </ul>
        </Field>
      )}
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
      <Field name="repository">{repository ?? "none"}</Field>
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

/** The member who filed the ticket, drawn only where the wire names one. */
function FiledBy(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse;
}): ReactNode {
  const emails = useCreatorEmails(props.partition);
  const creator = props.ticket.creator;
  if (creator === undefined) return null;
  return (
    <Field name="filed by">
      <Identity label={creatorLabel(creator, emails)} />
    </Field>
  );
}

export function TicketBrief(props: {
  readonly partition: PartitionIdentity;
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
            <Brief partition={props.partition} brief={ticket.brief} />
          )}
          <FiledBy partition={props.partition} ticket={ticket} />
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
  readonly overridden?: boolean;
}): ReactNode {
  return (
    <div className="ticket-config-cell">
      <span className="eyebrow">
        {props.name}
        {props.overridden === true ? <OverriddenMark /> : null}
      </span>
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

/** What a field the ticket overrode carries beside its name. */
function OverriddenMark(): ReactNode {
  return (
    <>
      {" "}
      <span className="ticket-config-chip">Overridden</span>
    </>
  );
}

/** The fields a ticket overrode, which the panel marks where it draws them. */
type ConfigurationOverridden = ReadonlySet<OverrideField>;

/** The live revision and when it released, the draft beside it, its
 * dependencies, the repository the work happens in, and where the finished
 * work lands. */
function ProvenanceSummary(props: {
  readonly draft: DraftResponse;
  readonly ticket: TicketResponse | undefined;
  readonly nowMs: number;
}): ReactNode {
  const ticket = props.ticket;
  const dependencies = ticket?.dependencies;
  const finalization = ticket?.brief?.finalization;
  const branch = ticket?.brief?.branch;
  const repository = ticket?.brief?.repository;
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
        value={
          dependencies === undefined
            ? absentMark
            : dependencies.length === 0
              ? "None"
              : dependencies.join(", ")
        }
      />
      <SummaryCell
        name="Repository"
        value={
          repository === undefined ? (
            absentMark
          ) : (
            <span title={repository}>{repositoryLabel(repository)}</span>
          )
        }
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
  readonly overridden?: boolean;
}): ReactNode {
  if (props.lines.length === 0) return null;
  return (
    <div className="ticket-config-text">
      {props.heading === undefined ? null : (
        <h3 className="eyebrow">
          {props.heading}
          {props.overridden === true ? <OverriddenMark /> : null}
        </h3>
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
  readonly overridden: ConfigurationOverridden;
  /** Whether this is the work role, whose instructions a ticket may override. */
  readonly work: boolean;
}): ReactNode {
  const { role, overridden } = props;
  return (
    <article className="ticket-config-role">
      <ConfigurationText
        heading="Motivation"
        lines={props.brief.motivation}
        overridden={overridden.has("brief.motivation")}
      />
      <ConfigurationText
        heading="Acceptance criteria"
        lines={props.brief.acceptanceCriteria}
        overridden={overridden.has("brief.acceptanceCriteria")}
      />
      <ConfigurationText
        heading="Constraints"
        lines={props.brief.constraints}
        overridden={overridden.has("brief.constraints")}
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
        <ConfigurationText
          heading="Instructions"
          lines={role.instructions}
          overridden={props.work && overridden.has("work.instructions")}
        />
      )}
      {role.practices === undefined || role.practices.length === 0 ? null : (
        <div className="ticket-config-text">
          <h3 className="eyebrow">
            Practices
            {overridden.has("practices") ? <OverriddenMark /> : null}
          </h3>
          <ConfigurationChips items={role.practices.map(practiceLabel)} />
        </div>
      )}
    </article>
  );
}

/** The fields drawn under Instructions, which decide what its caption may say. */
const instructionsOverridable: readonly OverrideField[] = [
  "brief.motivation",
  "brief.acceptanceCriteria",
  "brief.constraints",
  "practices",
  "work.instructions",
];

function ConfigurationInstructionsBar(props: {
  readonly tabs: ReactNode;
  readonly overridden: ConfigurationOverridden;
}): ReactNode {
  const configured = instructionsOverridable.every(
    (field) => !props.overridden.has(field),
  );
  return (
    <div className="ticket-config-heading-bar">
      <span className="panel-title">Instructions</span>
      {props.tabs}
      <span className="ticket-config-heading-caption">
        {configured
          ? "As configured · a run's exact prompt is in its conversation"
          : "As configured with this ticket's overrides · a run's exact prompt is in its conversation"}
      </span>
    </div>
  );
}

const instructionTabs = ["Work", "Review"] as const;

/** Work and Review tabs only where a review run is briefed from the review
 * block; the evaluation stages are the review otherwise, and Work is drawn
 * alone. */
function ConfigurationInstructions(props: {
  readonly brief: ConfigurationBrief;
  readonly work: ConfigurationRole;
  readonly review: ConfigurationRole | undefined;
  readonly overridden: ConfigurationOverridden;
}): ReactNode {
  const { review, overridden } = props;
  if (review === undefined)
    return (
      <div className="ticket-config-instructions">
        <ConfigurationInstructionsBar tabs={null} overridden={overridden} />
        <ConfigurationRoleBody
          brief={props.brief}
          role={props.work}
          overridden={overridden}
          work
        />
      </div>
    );
  return (
    <Tabs.Root className="ticket-config-instructions" defaultValue="Work">
      <ConfigurationInstructionsBar
        overridden={overridden}
        tabs={
          <Tabs.List
            className="ticket-config-tabs"
            aria-label="Instructions for"
          >
            {instructionTabs.map((tab) => (
              <Tabs.Trigger key={tab} value={tab} className="ticket-config-tab">
                {tab}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        }
      />
      {instructionTabs.map((tab) => (
        <Tabs.Content key={tab} value={tab}>
          <ConfigurationRoleBody
            brief={props.brief}
            role={tab === "Work" ? props.work : review}
            overridden={overridden}
            work={tab === "Work"}
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

/** The evaluation's heading, and how its stages run, which a version 1 configuration and a catalog plan share. */
function EvaluationHead(): ReactNode {
  return (
    <div className="ticket-config-heading-bar">
      <span className="panel-title">Evaluation</span>
      <span className="ticket-config-heading-caption">
        Stages run in order · a failed stage ends evaluation
      </span>
    </div>
  );
}

function ConfigurationEvaluations(props: {
  readonly evaluations: readonly ConfigurationEvaluation[];
}): ReactNode {
  if (props.evaluations.length === 0) return null;
  return (
    <div className="ticket-config-evaluations">
      <EvaluationHead />
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

function yesOrNoOrAbsent(value: boolean | undefined): ReactNode {
  if (value === undefined) return absentMark;
  return value ? "Yes" : "No";
}

function ConfigurationSettingsGrid(props: {
  readonly settings: ConfigurationSettings;
  readonly overridden: ConfigurationOverridden;
}): ReactNode {
  const settings = props.settings;
  const mode = props.overridden.has("worker.mode");
  return (
    <div className="ticket-config-settings">
      <SummaryCell
        name="Model"
        overridden={mode}
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
        overridden={mode}
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
      <SummaryCell
        name="Tools"
        overridden={mode}
        value={joinedOrAbsent(settings.tools)}
      />
      <SummaryCell
        name="Credentials"
        value={joinedOrAbsent(settings.credentials)}
      />
      <SummaryCell name="Access" value={settings.access ?? absentMark} />
      <SummaryCell
        name="Setup"
        overridden={props.overridden.has("worker.setup")}
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
        value={yesOrNoOrAbsent(settings.completesTask)}
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
  /** Whether the ticket overrode any of it, so the foot says it is the
   * pinned document's and not what the ticket runs. */
  readonly overridden: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="ticket-config-foot">
      {props.overridden ? <span>Pinned ·</span> : null}
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
        label={props.overridden ? "Pinned canonical JSON" : "Canonical JSON"}
        look={{ variant: "quiet", size: "sm" }}
      >
        <pre className="ticket-config-canonical">{props.canonical}</pre>
      </Disclosure>
    </div>
  );
}

/** Whether the panel draws an overridden field in a place of its own: a
 * settings cell is always drawn, and a text only where it holds a line. */
function configurationPanelPlaces(
  view: ConfigurationView,
  field: OverrideField,
): boolean {
  switch (field) {
    case "worker.mode":
    case "worker.setup":
      return true;
    case "worker.files":
      return false;
    case "practices":
      return [view.work.practices, view.review?.practices].some(
        (practices) => practices !== undefined && practices.length > 0,
      );
    case "brief.motivation":
      return view.brief.motivation.length > 0;
    case "brief.acceptanceCriteria":
      return view.brief.acceptanceCriteria.length > 0;
    case "brief.constraints":
      return view.brief.constraints.length > 0;
    case "work.instructions":
      return (view.work.instructions?.length ?? 0) > 0;
  }
}

/** The overrides the panel has no place for, each by its field name with its
 * value, so nothing the ticket runs under is missing from its page. */
function ConfigurationOverridesUnplaced(props: {
  readonly fields: readonly OverrideField[];
  readonly overrides: TicketResponse["overrides"];
}): ReactNode {
  if (props.fields.length === 0) return null;
  return (
    <div className="ticket-config-text">
      <span className="panel-title">Also overridden</span>
      {props.fields.map((field) => (
        <div key={field}>
          <h3 className="eyebrow">
            <code>{field}</code>
            <OverriddenMark />
          </h3>
          <pre className="ticket-config-canonical">
            {JSON.stringify(overrideFieldOf(props.overrides, field), null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** One workload of a catalog: the lines it runs, or its prompt under the file it was read from. */
function CatalogWorkloadBody(props: {
  readonly name: string;
  readonly workload: CatalogWorkload | undefined;
  /** The fields the ticket overrode of it, none where it overrode nothing. */
  readonly overridden: readonly string[] | undefined;
}): ReactNode {
  const { workload } = props;
  if (workload === undefined)
    return <p className="text-ink-3 text-sm">{`No workload ${props.name}`}</p>;
  const mark =
    props.overridden === undefined ? null : (
      <span className="eyebrow">
        <OverriddenMark />
        {props.overridden.join(", ")}
      </span>
    );
  if (workload.runner === "Commands")
    return (
      <div className="ticket-config-evaluation-runs">
        {mark}
        <span className="ticket-config-evaluation-runs-label">Runs</span>
        {workload.commands.map((line) => (
          <code key={line} className="ticket-config-command">
            {line}
          </code>
        ))}
      </div>
    );
  return (
    <>
      {mark}
      <ConfigurationText
        heading={workload.promptPath ?? "Prompt"}
        lines={workload.prompt === undefined ? [] : workload.prompt.split("\n")}
      />
    </>
  );
}

/** The fields a ticket overrode of one workload, none where it overrode none. */
function catalogOverriddenOf(
  overrides: CatalogOverrides,
  name: string,
): readonly string[] | undefined {
  const override = overrides?.[name];
  return override === undefined ? undefined : Object.keys(override);
}

/** What a selected entry is: the ticket's own choice, or the catalog's default it left standing. */
function catalogChosenMeta(
  name: string | undefined,
  defaulted: string | undefined,
) {
  return name === undefined
    ? undefined
    : name === defaulted
      ? "Default"
      : "Selected";
}

/** A catalog ticket's workload overrides, by the name of the workload each replaces. */
type CatalogOverrides = NonNullable<TicketResponse["overrides"]>["workloads"];

function CatalogStageRow(props: {
  readonly catalog: ConfigurationCatalog;
  readonly overrides: CatalogOverrides;
  readonly index: number;
  readonly stage: CatalogPlanStage;
}): ReactNode {
  const { catalog, stage } = props;
  return (
    <div className="ticket-config-evaluation-row">
      <span className="ticket-config-evaluation-label">
        {`Stage ${String(props.index + 1)} · ${stage.name}`}
      </span>
      <div className="ticket-config-evaluation-body">
        {stage.evaluators.length > 1 ? (
          <span className="text-ink-3 text-sm">
            Evaluators run side by side
          </span>
        ) : null}
        {stage.evaluators.map((name, position) => {
          const workload = configurationCatalogWorkload(catalog, name);
          return (
            <div key={position}>
              <span className="eyebrow">
                {[name, workload?.purpose, workload?.model]
                  .filter((part) => part !== undefined)
                  .join(" · ")}
              </span>
              <CatalogWorkloadBody
                name={name}
                workload={workload}
                overridden={catalogOverriddenOf(props.overrides, name)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The cells of a catalog ticket's summary: what it selected, and what that runs. */
function CatalogSummary(props: {
  readonly catalog: ConfigurationCatalog;
  readonly overrides: CatalogOverrides;
  readonly selected: CatalogSelected;
  /** The revision the ticket runs on, resolved from its choice and then its catalog's. */
  readonly following: ConfigurationFollowing;
  readonly work: CatalogWorkload | undefined;
}): ReactNode {
  const { catalog, overrides, selected, work } = props;
  const { defaults } = catalog;
  const finalizer = catalog.finalizers.find(
    (held) => held.name === selected.finalization,
  );
  return (
    <div className="ticket-config-settings">
      <SummaryCell
        name="Work"
        large
        value={selected.work}
        meta={catalogChosenMeta(selected.work, defaults.work)}
        overridden={catalogOverriddenOf(overrides, selected.work) !== undefined}
      />
      <SummaryCell
        name="Model"
        value={work?.model ?? absentMark}
        overridden={
          catalogOverriddenOf(overrides, selected.work)?.includes("worker") ===
          true
        }
      />
      <SummaryCell
        name="Evaluation"
        value={selected.evaluation}
        meta={catalogChosenMeta(selected.evaluation, defaults.evaluation)}
      />
      <SummaryCell
        name="Finalizer"
        value={selected.finalization ?? absentMark}
        meta={
          finalizer === undefined
            ? undefined
            : finalizer.approvalRequired
              ? "Approved first"
              : "Lands unapproved"
        }
      />
      <SummaryCell
        name="Version"
        value={props.following}
        meta={selected.configuration === undefined ? "Default" : "Selected"}
      />
    </div>
  );
}

/**
 * A catalog as one ticket runs it: the work, evaluation plan and finalizer its
 * selection names, each its catalog's default where it named none, with the
 * work's prompt and every stage's evaluators.
 */
function CatalogBody(props: {
  readonly configuration: ConfigurationResponse;
  readonly catalog: ConfigurationCatalog;
  readonly overrides: CatalogOverrides;
  readonly selection: TicketResponse["selection"];
}): ReactNode {
  const { catalog, configuration, overrides } = props;
  const selected = configurationCatalogSelected(catalog, props.selection);
  const work = configurationCatalogWorkload(catalog, selected.work);
  return (
    <div className="ticket-config">
      <CatalogSummary
        catalog={catalog}
        overrides={overrides}
        selected={selected}
        following={configurationFollowingOf(props.selection, catalog.defaults)}
        work={work}
      />
      <div className="ticket-config-instructions">
        <CatalogWorkloadBody
          name={selected.work}
          workload={work}
          overridden={catalogOverriddenOf(overrides, selected.work)}
        />
      </div>
      <div className="ticket-config-evaluations">
        <EvaluationHead />
        <div className="ticket-config-evaluation-grid">
          {(catalog.plans.get(selected.evaluation) ?? []).map(
            (stage, index) => (
              <CatalogStageRow
                key={index}
                catalog={catalog}
                overrides={overrides}
                index={index}
                stage={stage}
              />
            ),
          )}
        </div>
      </div>
      <ConfigurationFoot
        revision={configuration.revision}
        digest={configuration.digest}
        canonical={configuration.canonical}
        overridden={overrides !== undefined}
      />
    </div>
  );
}

/** A configuration as a ticket runs it, or as it stands where nothing overrides or selects from it. */
export function ConfigurationBody(props: {
  readonly configuration: ConfigurationResponse;
  readonly overrides: TicketResponse["overrides"];
  readonly selection: TicketResponse["selection"];
}): ReactNode {
  const configuration = props.configuration;
  const catalog = configurationCatalogOf(
    workloadsEffectiveCanonicalOf(
      configuration.canonical,
      props.overrides?.workloads,
    ),
  );
  if (catalog !== undefined)
    return (
      <CatalogBody
        configuration={configuration}
        catalog={catalog}
        overrides={props.overrides?.workloads}
        selection={props.selection}
      />
    );
  const { view, overridden: fields } = overriddenViewOf(
    configuration.canonical,
    props.overrides,
  );
  const overridden = new Set(fields);
  return (
    <div className="ticket-config">
      <ConfigurationSettingsGrid
        settings={view.settings}
        overridden={overridden}
      />
      <ConfigurationInstructions
        brief={view.brief}
        work={view.work}
        review={view.review}
        overridden={overridden}
      />
      <ConfigurationEvaluations evaluations={view.evaluations} />
      <ConfigurationOverridesUnplaced
        fields={fields.filter(
          (field) => !configurationPanelPlaces(view, field),
        )}
        overrides={props.overrides}
      />
      <ConfigurationFoot
        revision={configuration.revision}
        digest={configuration.digest}
        canonical={configuration.canonical}
        overridden={fields.length > 0}
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
  readonly overrides: TicketResponse["overrides"];
  readonly selection: TicketResponse["selection"];
  readonly following: TicketResponse["following"];
}): ReactNode {
  const stays = ticketFollowingSentence(props.following);
  const state = usePanelResource(
    props.partition,
    "Configuration",
    props.revision,
    (ports) => apiConfiguration(ports, props.partition, props.revision),
    undefined,
    "Streamed",
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
      {stays === undefined ? null : (
        <p className="ticket-config-following">{stays}</p>
      )}
      <PanelUnready state={state} />
      {state.state === "Ready" ? (
        <ConfigurationBody
          configuration={state.value}
          overrides={props.overrides}
          selection={props.selection}
        />
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
          overrides={props.ticket?.overrides}
          selection={props.ticket?.selection}
          following={props.ticket?.following}
        />
      )}
    </>
  );
}
