/**
 * Where this ticket came from: the brief's images, a summary of the live revision and
 * the draft beside it, and the configuration the live revision runs under,
 * broken out into its work, its evaluation and its finalization.
 *
 * What a ticket runs under is the configuration it pinned with its overrides
 * applied. A field it overrode is drawn as the override and marked so, in the
 * place the panel has for it, and listed under the panel by name where the
 * panel has none; the foot stays the pinned document's, which no override
 * changes.
 *
 * A configuration is named where the wire names it and drawn as its revision
 * where it is not.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { Tabs } from "radix-ui";
import { stringify } from "yaml";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { BriefFinalizationMode } from "../../../../src/contract/rosters.ts";
import type { ConfigurationFollowing } from "../../../../src/contract/configurationDocument.ts";
import { configurationFollowingOf } from "../../../../src/contract/configurationSelection.ts";
import type {
  ConfigurationResponse,
  DraftResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import { configurationQuery } from "../core/configurationQueries.ts";
import { briefLandingOf } from "../core/briefLanding.ts";
import { briefLandingLine } from "../core/codeLabels.ts";
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
  CatalogFinalizer,
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
import { configurationLabel, digestShortened } from "../core/labels.ts";
import { draftReleaseOf, draftUnreleasedLabel } from "../core/ticketEdit.ts";
import { usePanelState } from "./api.ts";
import { TicketFiledBy } from "./ticket/TicketMeta.tsx";
import { DataSection, PanelUnready } from "./DataPanel.tsx";
import { Disclosure } from "./ui/Disclosure.tsx";
import { Figure } from "./ui/Figure.tsx";
import { Freshness } from "./Freshness.tsx";
import { Panel } from "./ui/Panel.tsx";
import { MarkdownReport } from "./ui/MarkdownReport.tsx";
import { ProjectImage } from "./ProjectImage.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";

import "./ticket/ticket.css";

/**
 * The images a person attached to the brief, each drawn from the project's own
 * read of it. The brief's other fields are the status row's and the
 * instructions' to draw.
 */
export function TicketBriefImages(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<TicketResponse>;
}): ReactNode {
  const images =
    props.state.state === "Ready" ? props.state.value.brief?.images : undefined;
  if (images === undefined || images.length === 0) return null;
  return (
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

/** The live revision and when it released, the draft beside it, who filed
 * the ticket and the configuration its last release pinned. */
function RevisionSummary(props: {
  readonly partition: PartitionIdentity;
  readonly draft: DraftResponse;
  readonly ticket: TicketResponse | undefined;
  readonly nowMs: number;
}): ReactNode {
  const ticket = props.ticket;
  const revision = ticket?.configurationRevision;
  const released =
    revision === undefined
      ? undefined
      : configurationLabel(revision, ticket?.configurationVersion);
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
        name="Filed by"
        value={
          ticket?.creator === undefined ? (
            absentMark
          ) : (
            <TicketFiledBy
              partition={props.partition}
              creator={ticket.creator}
            />
          )
        }
      />
      <SummaryCell
        name="Released under"
        value={
          released === undefined ? (
            absentMark
          ) : (
            <Tooltip text={released.title}>
              <span>{released.text}</span>
            </Tooltip>
          )
        }
      />
    </div>
  );
}

/** A definition as the YAML it is written in, or its JSON where YAML cannot
 * say it. */
function definitionYaml(definition: unknown): string {
  try {
    return stringify(definition);
  } catch {
    return JSON.stringify(definition, null, 2);
  }
}

/**
 * One task definition — the work, an evaluation stage — folded to a line that
 * names its major details, opened onto the rest of them, then its prompt
 * behind a control of its own, then the definition as YAML with every option
 * it carries.
 */
function ConfigurationTask(props: {
  readonly title: string;
  /** What the folded line says beside the title. */
  readonly summary: ReactNode;
  readonly definition: unknown;
  /** The prompt, left folded until asked for; absent where there is none. */
  readonly prompt?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  return (
    <div className="ticket-config-task">
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        chevron
        look={{ variant: "quiet", size: "sm" }}
        label={
          <span className="ticket-config-task-label">
            <strong>{props.title}</strong>
            <span className="ticket-config-task-line">{props.summary}</span>
          </span>
        }
      >
        <div className="ticket-config-task-body">
          {props.children}
          {props.prompt === undefined ? null : (
            <Disclosure
              open={promptOpen}
              onOpenChange={setPromptOpen}
              label={promptOpen ? "Hide prompt" : "View prompt"}
              look={{ variant: "quiet", size: "sm" }}
            >
              <div className="ticket-config-instructions">{props.prompt}</div>
            </Disclosure>
          )}
          <Disclosure
            open={yamlOpen}
            onOpenChange={setYamlOpen}
            label="YAML"
            look={{ variant: "quiet", size: "sm" }}
          >
            <pre className="ticket-config-canonical">
              {definitionYaml(props.definition)}
            </pre>
          </Disclosure>
        </div>
      </Disclosure>
    </div>
  );
}

/** The folded line's parts joined, the mark of an override after them. */
function taskSummary(
  parts: readonly ReactNode[],
  overridden: boolean,
): ReactNode {
  const shown = parts.filter(
    (part) => part !== undefined && part !== null && part !== "",
  );
  return (
    <>
      {shown.map((part, at) => (
        <span key={at}>
          {at === 0 ? null : " · "}
          {part}
        </span>
      ))}
      {overridden ? <OverriddenMark /> : null}
    </>
  );
}

/** The first command and how many more follow it, as a folded line says them. */
function commandsSummary(commands: readonly string[]): ReactNode {
  const first = commands[0];
  if (first === undefined) return undefined;
  return (
    <>
      <code>{first}</code>
      {commands.length > 1 ? ` +${String(commands.length - 1)}` : null}
    </>
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
      <MarkdownReport text={props.lines.join("\n\n")} bare />
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
          ? "As configured · Exact prompt in the run's conversation"
          : "With overrides · Exact prompt in the run's conversation"}
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
  return (
    <ConfigurationTask
      title={`Stage ${String(props.index + 1)}`}
      summary={taskSummary(
        [
          evaluation.checks === undefined ? "Review" : "Commands",
          commandsSummary(evaluation.checks ?? []),
        ],
        false,
      )}
      definition={evaluation}
      prompt={
        evaluation.instructions === undefined ? undefined : (
          <ConfigurationText lines={evaluation.instructions} />
        )
      }
    >
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
        {evaluation.practices === undefined ||
        evaluation.practices.length === 0 ? null : (
          <ConfigurationChips items={evaluation.practices.map(practiceLabel)} />
        )}
      </div>
    </ConfigurationTask>
  );
}

/** One of the three things a configuration decides — work, evaluation,
 * finalization — under a heading of its own. */
function ConfigurationSubsection(props: {
  readonly title: "Work" | "Evaluation" | "Finalization";
  readonly caption?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section
      className="ticket-config-sub"
      data-stage={props.title.toLowerCase()}
    >
      <div className="ticket-config-heading-bar">
        <h3 className="panel-title">{props.title}</h3>
        {props.caption === undefined ? null : (
          <span className="ticket-config-heading-caption">{props.caption}</span>
        )}
      </div>
      {props.children}
    </section>
  );
}

/** The landing a ticket's brief names. */
type ConfigurationLanding = {
  readonly mode: BriefFinalizationMode;
  readonly target?: string | undefined;
};

/** The landing a ticket takes, as the one line its brief or its finalizer says it. */
function FinalizationLanding(props: {
  readonly landing: ConfigurationLanding;
}): ReactNode {
  return <SummaryCell name="Method" value={briefLandingLine(props.landing)} />;
}

function ConfigurationEvaluations(props: {
  readonly evaluations: readonly ConfigurationEvaluation[];
}): ReactNode {
  if (props.evaluations.length === 0) return null;
  return (
    <ConfigurationSubsection title="Evaluation">
      <div className="ticket-config-evaluation-grid">
        {props.evaluations.map((evaluation, index) => (
          <ConfigurationEvaluationRow
            key={index}
            index={index}
            evaluation={evaluation}
          />
        ))}
      </div>
    </ConfigurationSubsection>
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

/** One workload of a catalog beyond its prompt: what it carries, and the lines
 * it runs. */
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
  const facts: readonly (readonly [string, ReactNode])[] = [
    ["Runner", workload.runner],
    ["Agent", workload.agent],
    ["Model", workload.model],
    ["Effort", workload.effort],
    ["Access", workload.access],
    [
      "Prompt file",
      workload.promptPath === undefined ? undefined : (
        <code>{workload.promptPath}</code>
      ),
    ],
    [
      "Arguments",
      workload.agentArguments.length === 0 ? undefined : (
        <code>{workload.agentArguments.join(" ")}</code>
      ),
    ],
  ];
  return (
    <>
      {mark}
      <div className="ticket-config-settings">
        {facts.map(([name, value]) =>
          value === undefined ? null : (
            <SummaryCell key={name} name={name} value={value} />
          ),
        )}
      </div>
      {workload.runner === "Commands" ? (
        <div className="ticket-config-evaluation-runs">
          <span className="ticket-config-evaluation-runs-label">Runs</span>
          {workload.commands.map((line) => (
            <code key={line} className="ticket-config-command">
              {line}
            </code>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** A workload's prompt, under the file it was read from. */
function catalogPromptOf(workload: CatalogWorkload | undefined): ReactNode {
  if (workload?.prompt === undefined) return undefined;
  return (
    <ConfigurationText
      heading={workload.promptPath ?? "Prompt"}
      lines={[workload.prompt]}
    />
  );
}

/** What a workload says of itself on a folded line. */
function catalogWorkloadSummary(
  workload: CatalogWorkload | undefined,
): readonly ReactNode[] {
  if (workload === undefined) return [];
  return [
    workload.runner,
    workload.runner === "Commands" ? undefined : workload.agent,
    workload.model,
    workload.effort,
    workload.promptPath === undefined ? undefined : (
      <code>{workload.promptPath}</code>
    ),
    commandsSummary(workload.commands),
  ];
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

/** A stage's folded line: each evaluator by name with what it is. */
function catalogStageSummary(
  evaluators: readonly {
    readonly name: string;
    readonly workload: CatalogWorkload | undefined;
  }[],
  overrides: CatalogOverrides,
): ReactNode {
  return taskSummary(
    evaluators.map(({ name, workload }) => (
      <span key={name}>
        {name}
        {workload === undefined ? null : (
          <>
            {" ("}
            {taskSummary(catalogWorkloadSummary(workload), false)}
            {")"}
          </>
        )}
      </span>
    )),
    evaluators.some(
      ({ name }) => catalogOverriddenOf(overrides, name) !== undefined,
    ),
  );
}

function CatalogStageRow(props: {
  readonly catalog: ConfigurationCatalog;
  readonly overrides: CatalogOverrides;
  readonly index: number;
  readonly stage: CatalogPlanStage;
}): ReactNode {
  const { catalog, stage } = props;
  const evaluators = stage.evaluators.map((name) => ({
    name,
    workload: configurationCatalogWorkload(catalog, name),
  }));
  return (
    <ConfigurationTask
      title={`Stage ${String(props.index + 1)} · ${stage.name}`}
      summary={catalogStageSummary(evaluators, props.overrides)}
      definition={Object.fromEntries(
        evaluators.map(({ name, workload }) => [name, workload?.definition]),
      )}
      prompt={
        evaluators.some(({ workload }) => workload?.prompt !== undefined) ? (
          <>
            {evaluators.map(({ name, workload }) => (
              <div key={name}>
                <span className="eyebrow">{name}</span>
                {catalogPromptOf(workload)}
              </div>
            ))}
          </>
        ) : undefined
      }
    >
      <div className="ticket-config-evaluation-body">
        {stage.evaluators.length > 1 ? (
          <span className="text-ink-3 text-sm">
            Evaluators run side by side
          </span>
        ) : null}
        {evaluators.map(({ name, workload }) => (
          <div key={name}>
            <span className="eyebrow">{name}</span>
            <CatalogWorkloadBody
              name={name}
              workload={workload}
              overridden={catalogOverriddenOf(props.overrides, name)}
            />
          </div>
        ))}
      </div>
    </ConfigurationTask>
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
      {selected.finalization === undefined ? null : (
        <SummaryCell
          name="Finalizer"
          value={selected.finalization}
          meta={
            finalizer === undefined
              ? undefined
              : finalizer.approvalRequired
                ? "Approved first"
                : "No approval needed"
          }
        />
      )}
      <SummaryCell
        name="Version"
        value={props.following}
        meta={selected.configuration === undefined ? "Default" : "Selected"}
      />
    </div>
  );
}

/** The finalizer a catalog ticket lands through: whether a person approves
 * first, and the landing it takes where the brief names none. */
function CatalogFinalizerBody(props: {
  readonly name: string | undefined;
  readonly defaulted: string | undefined;
  readonly finalizer: CatalogFinalizer | undefined;
  /** The landing the ticket's brief names, which is what lands the work where
   * the catalog names no finalizer. */
  readonly landing: ConfigurationLanding | undefined;
}): ReactNode {
  const { finalizer } = props;
  const landing = props.landing ?? finalizer?.landing;
  return (
    <div className="ticket-config-settings">
      {landing === undefined ? (
        <SummaryCell name="Method" value={absentMark} />
      ) : (
        <FinalizationLanding landing={landing} />
      )}
      {props.name === undefined ? null : finalizer === undefined ? (
        <SummaryCell name="Finalizer" value={`No finalizer ${props.name}`} />
      ) : (
        <SummaryCell
          name="Finalizer"
          value={finalizer.name}
          meta={[
            catalogChosenMeta(props.name, props.defaulted),
            finalizer.approvalRequired
              ? "Approved first"
              : "No approval needed",
          ]
            .filter((part) => part !== undefined)
            .join(" · ")}
        />
      )}
    </div>
  );
}

/** The stages of the evaluation plan a ticket runs, one under another. */
function CatalogStages(props: {
  readonly catalog: ConfigurationCatalog;
  readonly overrides: CatalogOverrides;
  readonly evaluation: string;
}): ReactNode {
  return (
    <div className="ticket-config-evaluation-grid">
      {(props.catalog.plans.get(props.evaluation) ?? []).map((stage, index) => (
        <CatalogStageRow
          key={index}
          catalog={props.catalog}
          overrides={props.overrides}
          index={index}
          stage={stage}
        />
      ))}
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
  readonly landing: ConfigurationLanding | undefined;
}): ReactNode {
  const { catalog, configuration, overrides } = props;
  const selected = configurationCatalogSelected(catalog, props.selection);
  const work = configurationCatalogWorkload(catalog, selected.work);
  const finalizer = catalog.finalizers.find(
    (held) => held.name === selected.finalization,
  );
  return (
    <div className="ticket-config">
      <CatalogSummary
        catalog={catalog}
        overrides={overrides}
        selected={selected}
        following={configurationFollowingOf(props.selection, catalog.defaults)}
        work={work}
      />
      <ConfigurationSubsection title="Work">
        <ConfigurationTask
          title={selected.work}
          summary={taskSummary(
            catalogWorkloadSummary(work),
            catalogOverriddenOf(overrides, selected.work) !== undefined,
          )}
          definition={work?.definition}
          prompt={catalogPromptOf(work)}
        >
          <CatalogWorkloadBody
            name={selected.work}
            workload={work}
            overridden={catalogOverriddenOf(overrides, selected.work)}
          />
        </ConfigurationTask>
      </ConfigurationSubsection>
      <ConfigurationSubsection title="Evaluation">
        <CatalogStages
          catalog={catalog}
          overrides={overrides}
          evaluation={selected.evaluation}
        />
      </ConfigurationSubsection>
      <ConfigurationSubsection title="Finalization">
        <CatalogFinalizerBody
          name={selected.finalization}
          defaulted={catalog.defaults.finalization}
          finalizer={finalizer}
          landing={props.landing}
        />
      </ConfigurationSubsection>
      <ConfigurationFoot
        revision={configuration.revision}
        digest={configuration.digest}
        canonical={configuration.canonical}
        overridden={overrides !== undefined}
      />
    </div>
  );
}

/** A version 1 configuration's work: its settings and commands, and the
 * instructions it briefs the run with as the prompt. */
function LegacyWorkTask(props: {
  readonly view: ConfigurationView;
  readonly overridden: ConfigurationOverridden;
}): ReactNode {
  const { view, overridden } = props;
  return (
    <ConfigurationTask
      title="Work"
      summary={taskSummary(
        [
          view.work.commands === undefined ? "Agent" : "Commands",
          view.work.commands === undefined ? view.settings.agent : undefined,
          view.settings.model.label,
          commandsSummary(view.work.commands ?? []),
        ],
        ["worker.mode", "worker.setup", "work.instructions"].some((field) =>
          overridden.has(field as OverrideField),
        ),
      )}
      definition={{
        settings: view.settings,
        brief: view.brief,
        work: view.work,
        review: view.review,
      }}
      prompt={
        view.work.instructions === undefined &&
        view.review === undefined ? undefined : (
          <ConfigurationInstructions
            brief={view.brief}
            work={view.work}
            review={view.review}
            overridden={overridden}
          />
        )
      }
    >
      <ConfigurationSettingsGrid
        settings={view.settings}
        overridden={overridden}
      />
      {view.work.commands === undefined ? null : (
        <div className="ticket-config-evaluation-runs">
          <span className="ticket-config-evaluation-runs-label">Runs</span>
          {view.work.commands.map((line) => (
            <code key={line} className="ticket-config-command">
              {line}
            </code>
          ))}
        </div>
      )}
    </ConfigurationTask>
  );
}

/** A configuration as a ticket runs it, or as it stands where nothing overrides or selects from it. */
export function ConfigurationBody(props: {
  readonly configuration: ConfigurationResponse;
  readonly overrides: TicketResponse["overrides"];
  readonly selection: TicketResponse["selection"];
  /** The landing a version 1 ticket's brief names, which its configuration has no place for. */
  readonly landing?:
    | {
        readonly mode: BriefFinalizationMode;
        readonly target?: string | undefined;
      }
    | undefined;
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
        landing={props.landing}
      />
    );
  const { view, overridden: fields } = overriddenViewOf(
    configuration.canonical,
    props.overrides,
  );
  const overridden = new Set(fields);
  return (
    <div className="ticket-config">
      <ConfigurationSubsection title="Work">
        <LegacyWorkTask view={view} overridden={overridden} />
      </ConfigurationSubsection>
      <ConfigurationEvaluations evaluations={view.evaluations} />
      {props.landing === undefined ? null : (
        <ConfigurationSubsection title="Finalization">
          <div className="ticket-config-settings">
            <FinalizationLanding landing={props.landing} />
          </div>
        </ConfigurationSubsection>
      )}
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
  readonly landing: ConfigurationLanding | undefined;
}): ReactNode {
  const stays = ticketFollowingSentence(props.following);
  const state = usePanelState(
    configurationQuery(props.partition, props.revision, "Streamed"),
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
          landing={props.landing}
        />
      ) : null}
    </Panel>
  );
}

/** The revisions the ticket has had: the live one, the draft beside it, who
 * filed it and what it was released under. */
export function TicketRevisions(props: {
  readonly partition: PartitionIdentity;
  readonly state: PanelState<DraftResponse>;
  /** The ticket, absent until it is read. */
  readonly ticket: TicketResponse | undefined;
  readonly nowMs: number;
}): ReactNode {
  return (
    <DataSection state={props.state}>
      {(draft) => (
        <RevisionSummary
          partition={props.partition}
          draft={draft}
          ticket={props.ticket}
          nowMs={props.nowMs}
        />
      )}
    </DataSection>
  );
}

/** The configuration the live revision pins, drawn once the ticket is read. */
export function TicketConfiguration(props: {
  readonly partition: PartitionIdentity;
  readonly ticket: TicketResponse | undefined;
}): ReactNode {
  const ticket = props.ticket;
  if (ticket?.configurationRevision === undefined) return null;
  return (
    <ConfigurationPanel
      partition={props.partition}
      revision={ticket.configurationRevision}
      version={ticket.configurationVersion}
      overrides={ticket.overrides}
      selection={ticket.selection}
      following={ticket.following}
      landing={briefLandingOf(ticket.brief?.finalization)}
    />
  );
}
