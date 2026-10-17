/**
 * What a launched worker is actually handed: the pinned ticket configuration
 * read back by revision, the blessed practices in scope for its role, the
 * bounded runtime facts the adapter gathered, and the one authority it runs
 * under.
 *
 * COMPOSITION IS PURE AND ITS READS ARE GATHERED FIRST. `BriefingView` is every
 * input, and `composeTaskInvocation` is a synchronous function of it, so the
 * launch path awaits its ports before it decides and never inside the decision.
 *
 * THE SAME BRIEF REACHES BOTH ROLES. Motivation, acceptance criteria and
 * constraints are one value on the configuration and are rendered by both
 * templates, so a review tests the work against the claim the work set out to
 * satisfy rather than against a second description of it. Only the
 * purpose-specific block and the scoped practices differ between them.
 *
 * A RETRY RENDERS THE SAME CONFIGURATION BECAUSE IT IS CONTENT-ADDRESSED.
 * `PinnedConfigurationPort` can only be asked for a named revision — there is
 * no call on it that means "current" — and what comes back is refused unless
 * its own revision and digest are the ones the durable execution row pinned at
 * registration. So a moving ticket row cannot reach a second attempt, and a
 * silently rewritten revision is a refusal rather than a different prompt. The
 * project's other repositories are read as they stand at each prepare instead,
 * because the plane holds a repository a pod names to the live bindings when
 * it asks.
 *
 * A STAGE THAT NAMES COMMANDS BRIEFS NOBODY. Its block carries a command list
 * instead of instructions, and composition resolves that list into the
 * invocation's own worker mode. The worker runs the list it is handed and never
 * reads the configuration, so a later source of command lines is folded in here
 * rather than by a second path into the worker.
 *
 * SO A COMMANDED STAGE IS TOLD NOTHING AN AGENT WOULD HAVE READ. It carries no
 * practices, no report, no dependency's delivery and no failed landing. The
 * failed evaluation's reports are gated on the carrier, because they are
 * documents rather than lines and would otherwise take a reworked commanded
 * stage past the carrier the invocation has; the work reports are a review's,
 * and no commanded stage is one.
 *
 * THE TICKET'S OWN CHECK LINES ARE THE SECOND SOURCE, AND THEY FOLLOW. They are
 * appended to the first evaluation stage the configuration commands, so the
 * configuration's list runs whatever the ticket says and a ticket can only
 * widen what its change is held to, never change what its work is. The brief is
 * frozen at release and this fold reads nothing else, so a retry of the same
 * stage runs the same list in the same order.
 *
 * AUTHORITY IS NEVER COMPOSED FROM PROSE. `./taskAuthority.ts` holds the whole
 * of it, the requests folded into it are structured data, and a rendered
 * briefing has no authority field for a later block to raise. The template's
 * own request leads that fold and takes completion authority away: a briefed
 * worker reports a manifest and the scheduler submits the completion, so no
 * grant and no authored block can leave a worker able to conclude a task
 * itself.
 *
 * A RUNTIME FACT CANNOT FORGE A SECTION, AND NEITHER CAN A TICKET. Every line
 * rendered here is refused if it carries a control character, so neither a
 * handoff from an earlier agent nor the intent a human stated can open a
 * heading of its own, and either could gain nothing by it if it could —
 * headings are not read back and authority is not prose.
 *
 * A RENDERED BRIEFING CARRIES A SEAL, AND THE SEAL IS A COMPILE-TIME CLAIM. Its
 * value is not exported, so a literal assembled out of headings and lines is
 * not a `RenderedBriefing`: the compiler refuses it for the missing field, and
 * no expression outside this module supplies one. It is not a runtime check,
 * because a module already holding a briefing this module rendered can spread
 * it into a value carrying the same seal. Nothing reads the seal back, so such
 * a value is inert — what a launch acts on is the authority beside the
 * briefing, and `./taskAuthority.ts` holds that behind a key of its own.
 *
 * WHAT IS RETAINED IS `BriefingProvenance` AND NOTHING ELSE. It holds the
 * template version, the pinned revision and digest, the resolved practice
 * identities and each rendered section's identity and size. There is no field
 * on it that can hold a rendered prompt, a credential or source material,
 * which is how the retention rule is kept rather than remembered.
 *
 * A PRIOR WORK REPORT IS A DOCUMENT AND NOT A LINE, so it is admitted under
 * `resultReportCharsMax` — the bound the manifest that carried it and the row
 * that retained it are both written against — rather than under the bound one
 * authored criterion has. It is held to the same printable rule as the row it
 * came from, so what a manifest may carry a briefing may render.
 *
 * A DEPENDENCY'S REPORT IS A DOCUMENT AS WELL, AND ALL OF THEM SHARE ONE ROOM.
 * Every job of a ticket is told what its dependencies delivered, each report
 * admitted whole while it fits the room the ones before it left, and the rest
 * named as not carried, so the section stays bounded however many dependencies
 * a ticket names.
 *
 * WHAT COMPOSITION HANDS OVER IS BOUNDED AS ONE VALUE, NOT LIST BY LIST. Every
 * input has a bound of its own, and their sum is larger than an exec
 * environment string holds — which is how a launched fabric carries the task —
 * so a briefing that renders and an authored worker configuration beside it can
 * together make a container that cannot start. `taskInvocationBytesMax` is the
 * bound the carrier actually has, and `EnvelopeTooLong` is the refusal that
 * replaces the failure to launch.
 *
 * A REFUSAL IS `TicketConfigIncompatible` AND THE FAULT SAYS WHICH. The reason
 * vocabulary is the model's and is closed; `BriefingFault` is this module's
 * bounded diagnostic beside it, and `./executionSchedulerRun.ts` writes it into
 * the ended attempt's evidence beside the label — so a blocked ticket can be
 * explained without widening what `TicketGraph` understands.
 */

import {
  briefChecksMax,
  briefImagesMax,
  briefIntentCharsMax,
  briefLinksMax,
} from "../contract/brief.ts";
import {
  projectRepositoriesAnsweredMax,
  resultReportCharsMax,
  textCodePointsCount,
} from "../contract/http.ts";
import { workerPlaneRoutes } from "../contract/workerPlane.ts";
import { commandLinesMax } from "../contract/workerTask.ts";
import {
  dependencyDeliveriesMax,
  type DependencyDelivery,
} from "./dependencyDelivery.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { ConfigurationPin } from "./projectDecision.ts";
import { resultTextControlCharacter } from "./resultManifest.ts";
import type { Partition } from "./projectStore.ts";
import {
  schedulerIdentityCharsMax,
  type ExecutionId,
} from "./schedulerIdentity.ts";
import {
  authoredTaskConfigurationReadiness,
  allPracticeIds,
  blockCommandLines,
  briefingLinesMax,
  firstCommandedCheckStage,
  taskConfigurationLineFault,
  taskConfigurationLineUnreadable,
  type AuthoredTaskConfiguration,
  type PracticeId,
  type StageBlock,
  type TaskConfigurationFault,
  type TaskConfigurationReadFault,
  type TicketBrief,
  type WorkerConfiguration,
} from "./taskConfiguration.ts";
export {
  authoredTaskConfigurationReadiness,
  allPracticeIds,
  blockCommandLines,
  briefingLinesMax,
  firstCommandedCheckStage,
  type AgentEvaluationBlock,
  type AuthoredTaskConfiguration,
  type CommandEvaluationBlock,
  type CommandWorkBlock,
  type CommandsWorkerMode,
  type EvaluationBlock,
  type PracticeId,
  type PurposeBlock,
  type StageBlock,
  type TaskConfigurationFault,
  type TaskConfigurationReadFault,
  type TicketBrief,
  type WorkBlock,
  type WorkerConfiguration,
  type WorkerMode,
} from "./taskConfiguration.ts";
import {
  briefingDependencyLines,
  briefingDependencyName,
  briefingDependencyPreface,
  briefingDependencyReportLine,
  briefingDependencyReportUncarried,
  briefingFailedLandingLines,
  briefingHeading,
  briefingLabels,
  briefingRequiredResult,
  briefingReworkPreface,
  briefingRoleInstructions,
  briefingSectionOrder,
  briefingTemplateVersion,
  type BriefingCarrier,
  type BriefingSectionId,
  type FailedLanding,
  type TaskPurpose,
} from "./briefingTemplate.ts";
export type {
  BriefingCarrier,
  FailedLanding,
  TaskPurpose,
} from "./briefingTemplate.ts";
import { projectArtifactMediaTypeOf } from "./projectArtifact.ts";
import type { ProjectArtifactId } from "./finalizerPreparation.ts";
import {
  briefIntentLines,
  type BriefIntent,
  type DraftBrief,
} from "./ticketBrief.ts";
import type { PinnedWorkloadTask } from "./workloadTask.ts";
export type { PinnedWorkloadTask } from "./workloadTask.ts";
import {
  resolveTaskAuthority,
  taskAuthorityGrant,
  type AuthorityRequest,
  type PolicyAuthorityGrant,
  type TaskAuthority,
} from "./taskAuthority.ts";

/** Which roles a practice speaks to, which is what makes one shared list serve both. */
export type PracticeScope = "Work" | "Review" | "Check" | "Both";

/** One blessed practice: what it tells an agent to do, and whose briefing it belongs in. */
export interface BlessedPractice {
  readonly practice: PracticeId;
  readonly scope: PracticeScope;
  readonly instruction: string;
}

/** The finite trusted catalog a configured practice name is resolved through. */
export type PracticeCatalog = ReadonlyMap<PracticeId, BlessedPractice>;

/** The practices this tree blesses, whose wording is authored like the templates' and revisable like it. */
const blessedPractices: readonly BlessedPractice[] = [
  {
    practice: "RegressionCoverage",
    scope: "Work",
    instruction:
      "Add or extend a test that fails without this change and passes with it.",
  },
  {
    practice: "ChangedCallPaths",
    scope: "Review",
    instruction:
      "Walk every call path the change reaches, including the callers the diff does not show.",
  },
  {
    practice: "AcceptanceCriteria",
    scope: "Both",
    instruction:
      "Take the acceptance criteria one at a time and say which of them the change meets.",
  },
];

/** The finite catalog a configured practice name is resolved through, keyed by identity. */
export const blessedPracticeCatalog: PracticeCatalog = new Map(
  blessedPractices.map((practice) => [practice.practice, practice]),
);

/** One immutable authored configuration revision, as the release pinned it. */
export interface PinnedTaskConfiguration
  extends ConfigurationPin, AuthoredTaskConfiguration {}

/** What one task is briefed from: a version 1 configuration whole, or the one workload of a catalog it runs. */
export type PinnedConfiguration = PinnedTaskConfiguration | PinnedWorkloadTask;

/** Whether a pinned read is the one workload of a catalog rather than a version 1 configuration. */
export function pinnedWorkloadTaskOf(
  configuration: PinnedConfiguration,
): configuration is PinnedWorkloadTask {
  return "workload" in configuration;
}

/** Adds the immutable storage identity to an authored briefing that parsed successfully. */
export function pinnedTaskConfigurationReadiness(
  value: unknown,
  pin: ConfigurationPin,
):
  | {
      readonly readiness: "Ready";
      readonly configuration: PinnedTaskConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: TaskConfigurationFault;
    } {
  const authored = authoredTaskConfigurationReadiness(value);
  return authored.readiness === "Incomplete"
    ? authored
    : {
        readiness: "Ready",
        configuration: { ...pin, ...authored.configuration },
      };
}

/** What the adapter observed of the world, which is data and never authored prompt text. */
export interface RuntimeFacts {
  readonly workspace?: string;
  readonly changedFiles: readonly string[];
  readonly handoff: readonly string[];
}

/**
 * What reading the repositories an execution's project binds live beside the
 * one its own bundle pins found, which its pod may read and never deliver to,
 * an outage kept apart from a project that binds no other.
 */
export type ReadOnlyRepositoriesRead =
  | {
      readonly read: "Repositories";
      readonly repositories: readonly RepositoryId[];
    }
  | { readonly read: "Unavailable" };

export interface ReadOnlyRepositoriesPort {
  repositories(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<ReadOnlyRepositoriesRead>;
}

/** The bounded summaries earlier work tasks reported for a review to understand, not verify. */
export interface PriorWorkReports {
  readonly reports: readonly string[];
}

/** The bounded reports of the failed executions of the evaluation a work task follows. */
export interface PriorEvaluationReports {
  readonly reports: readonly string[];
}

/** What reading the failed evaluation's reports found, an outage kept apart from a first attempt. */
export type PriorEvaluationReportsRead =
  | { readonly read: "Reports"; readonly reports: PriorEvaluationReports }
  | { readonly read: "Unavailable" };

export interface PriorEvaluationReportsPort {
  reports(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<PriorEvaluationReportsRead>;
}

/**
 * What reading a failed landing found: the landing a work task follows, none
 * for a task its bundle pins no `FinalizationAttempt` for, or an outage.
 */
export type FailedLandingRead =
  | { readonly read: "Landing"; readonly landing?: FailedLanding }
  | { readonly read: "Unavailable" };

export interface FailedLandingPort {
  landing(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<FailedLandingRead>;
}

/** What reading the pinned work reports found, an outage kept apart from no prior work. */
export type PriorWorkReportsRead =
  | { readonly read: "Reports"; readonly reports: PriorWorkReports }
  | { readonly read: "Unavailable" };

export interface PriorWorkReportsPort {
  reports(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<PriorWorkReportsRead>;
}

/** The most work reports a review is briefed with; a list past it is refused, not truncated. */
export const priorWorkReportsMax = 8;

/** The most failed evaluation reports a work task is briefed with, refused past it the same way. */
export const priorEvaluationReportsMax = priorWorkReportsMax;

/** The most changed files a runtime context may name before it stops being context. */
export const runtimeChangedFilesMax = 64;

/** The most handoff lines runtime context may carry. */
export const runtimeHandoffLinesMax = 32;

/** The most read-only repositories a briefing names, which is as many as a project's binding listing answers. */
export const readOnlyRepositoriesMax = projectRepositoriesAnsweredMax;

/**
 * The room a briefing gives its dependencies' reports together, which is the
 * room one report has: a ticket's dependencies tell it as much as one earlier
 * work task would, however many there are.
 */
export const dependencyReportsCharsMax = resultReportCharsMax;

/**
 * The bytes one environment string carries into an exec, which is `execve`'s
 * `MAX_ARG_STRLEN`. It is the smallest carrier a launched task has, so it is
 * the one composition is written against; a fabric that hands its worker the
 * task another way has more room and needs none of it.
 */
export const taskEnvelopeBytesMax = 131_072;

/** The identities and addresses a fabric adds around the invocation it was handed. */
export const taskEnvelopeFabricIdentitiesMax = 32;

/** The room those keep, so what a fabric adds cannot take the envelope past the carrier. */
export const taskEnvelopeFabricBytesMax =
  taskEnvelopeFabricIdentitiesMax * schedulerIdentityCharsMax;

/** What one composed invocation may weigh, which is what is left of the carrier. */
export const taskInvocationBytesMax =
  taskEnvelopeBytesMax - taskEnvelopeFabricBytesMax;

/** Why a briefing could not be composed, each of them a fact about the pinned configuration. */
export type BriefingFault =
  | "RevisionMismatch"
  | "DigestMismatch"
  | "UnknownPractice"
  | "DuplicatePractice"
  | "EmptyBrief"
  | "EmptyLine"
  | "TextTooLong"
  | "ReportTooLong"
  | "EnvelopeTooLong"
  | "TextUnreadable"
  | "TooManyLines"
  | "StageNotCovered";

/** Every fault, so a suite iterates rather than restates. */
export const allBriefingFaults: readonly BriefingFault[] = [
  "RevisionMismatch",
  "DigestMismatch",
  "UnknownPractice",
  "DuplicatePractice",
  "EmptyBrief",
  "EmptyLine",
  "TextTooLong",
  "ReportTooLong",
  "EnvelopeTooLong",
  "TextUnreadable",
  "TooManyLines",
  "StageNotCovered",
];

/** What one line has to be to render: present, bounded, and free of anything a terminal eats. */
function briefingLineFault(line: string): BriefingFault | undefined {
  return taskConfigurationLineFault(line);
}

/** What one list has to be to render, which is bounded and made of renderable lines. */
function briefingLinesFault(
  lines: readonly string[],
  linesMax: number,
): BriefingFault | undefined {
  if (lines.length > linesMax) return "TooManyLines";
  for (const line of lines) {
    const fault = briefingLineFault(line);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

/**
 * The first fault in any of these lists, so one loop covers every authored
 * slot. A slot the block being read has no list for is skipped.
 */
function briefingListsFault(
  lists: readonly (readonly [readonly string[] | undefined, number])[],
): BriefingFault | undefined {
  for (const [lines, linesMax] of lists) {
    const fault =
      lines === undefined ? undefined : briefingLinesFault(lines, linesMax);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

/** Whether a practice scoped this way belongs in a briefing written for this role. */
function practiceInScope(scope: PracticeScope, purpose: TaskPurpose): boolean {
  return scope === "Both" || scope === purpose;
}

/**
 * The practices in scope for one role, or the fault the configured list earned.
 * The refusal names no configured string, because an unknown name is arbitrary
 * text and a retained diagnostic is bounded.
 */
export type PracticesResolved =
  | {
      readonly resolved: "Practices";
      readonly practices: readonly BlessedPractice[];
    }
  | { readonly resolved: "Refused"; readonly fault: BriefingFault };

/** Resolves every configured practice name through the catalog, keeping the ones this role reads. */
export function resolvePractices(
  catalog: PracticeCatalog,
  purpose: TaskPurpose,
  named: readonly string[],
): PracticesResolved {
  const seen = new Set<string>();
  const found: BlessedPractice[] = [];
  for (const name of named) {
    if (seen.has(name)) {
      return { resolved: "Refused", fault: "DuplicatePractice" };
    }
    seen.add(name);
    const identity = allPracticeIds.find((known) => known === name);
    const blessed = identity === undefined ? undefined : catalog.get(identity);
    if (blessed === undefined) {
      return { resolved: "Refused", fault: "UnknownPractice" };
    }
    if (practiceInScope(blessed.scope, purpose)) found.push(blessed);
  }
  found.sort(
    (left, right) =>
      allPracticeIds.indexOf(left.practice) -
      allPracticeIds.indexOf(right.practice),
  );
  return { resolved: "Practices", practices: found };
}

/** What reading a pinned revision found, keeping a definitive absence apart from an outage. */
export type ConfigurationRead =
  | {
      readonly read: "Configuration";
      readonly configuration: PinnedConfiguration;
    }
  | { readonly read: "Missing" }
  | {
      readonly read: "Incompatible";
      readonly fault: TaskConfigurationReadFault;
    }
  | { readonly read: "Unavailable" };

/** The task a pinned read is for: its ticket, its kind, and an evaluation's stage index and evaluator key. */
export interface PinnedConfigurationTask extends ConfigurationPin {
  readonly ticket: number;
  readonly taskKind: "Work" | "Evaluation";
  readonly stage?: number;
  readonly evaluator?: number;
}

/**
 * The immutable authoring revisions, behind a typed port. Every call names the
 * revision it wants, so there is no way to spell a read of the current one,
 * and the task it is read for: a version 1 configuration is answered with its
 * ticket's released overrides applied, and a catalog with the workload that
 * task runs under its ticket's selection.
 */
export interface PinnedConfigurationPort {
  configuration(
    partition: Partition,
    task: PinnedConfigurationTask,
  ): Promise<ConfigurationRead>;
}

/** What gathering the runtime facts found, an outage kept apart from an empty context. */
export type RuntimeFactsRead =
  | { readonly read: "Facts"; readonly facts: RuntimeFacts }
  | { readonly read: "Unavailable" };

/** What the fabric can observe about one execution's workspace, behind a typed port. */
export interface RuntimeFactsPort {
  facts(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<RuntimeFactsRead>;
}

/** Everything composition reads, gathered before it runs so nothing is awaited inside it. */
export interface BriefingView {
  readonly purpose: TaskPurpose;
  readonly stage?: number;
  readonly pin: ConfigurationPin;
  readonly configuration: PinnedConfiguration;
  readonly runtime: RuntimeFacts;
  readonly readOnlyRepositories: readonly RepositoryId[];
  /** What each of the ticket's dependencies delivered, in the order they ascend. */
  readonly dependencyDeliveries: readonly DependencyDelivery[];
  readonly priorWorkReports: PriorWorkReports;
  readonly priorEvaluationReports: PriorEvaluationReports;
  readonly failedLanding?: FailedLanding;
  readonly brief?: DraftBrief;
  readonly grant: PolicyAuthorityGrant;
}

/** The block one role reads, which is the only part of a configuration the two roles differ on; every evaluator of a stage runs the stage's block, whatever key it carries. */
function purposeBlock(
  configuration: AuthoredTaskConfiguration,
  purpose: TaskPurpose,
  stage?: number,
): StageBlock | undefined {
  if (purpose === "Work") return configuration.work;
  if (configuration.evaluations === undefined) return configuration.review;
  return stage === undefined ? undefined : configuration.evaluations[stage];
}

/**
 * What one task is briefed from, whichever version pinned it: the prompt it
 * leads with, whether the template frames it, the brief and instructions it
 * carries, the lines it runs, the practices it names, the authority it asks
 * for and the worker it runs on. Every section and every request below reads
 * this and nothing else of the configuration.
 */
interface BriefingTask {
  readonly framed: boolean;
  readonly prompt?: string;
  readonly brief?: TicketBrief;
  readonly instructions: readonly string[];
  readonly commands?: readonly string[];
  readonly ticketChecks: boolean;
  readonly practices: readonly string[];
  readonly authority: readonly AuthorityRequest[];
  readonly worker?: WorkerConfiguration;
}

/** A version 1 configuration's task: the stage's block, framed, under the shared brief, authority and worker. */
function briefingConfigurationTask(
  configuration: PinnedTaskConfiguration,
  purpose: TaskPurpose,
  stage?: number,
): BriefingTask | undefined {
  const block = purposeBlock(configuration, purpose, stage);
  if (block === undefined) return undefined;
  const commands = blockCommandLines(block);
  const commanded = firstCommandedCheckStage(configuration);
  return {
    framed: true,
    brief: configuration.brief,
    instructions: block.instructions ?? [],
    ...(commands === undefined ? {} : { commands }),
    ticketChecks:
      purpose !== "Work" && commanded !== undefined && stage === commanded,
    practices:
      commands !== undefined
        ? []
        : "practices" in block
          ? block.practices
          : configuration.practices,
    authority: [configuration.authority, block.authority].filter(
      (request) => request !== undefined,
    ),
    ...(configuration.worker === undefined
      ? {}
      : { worker: configuration.worker }),
  };
}

/** A catalog's task: its one workload, framed only where it asks to be, with only what it names. */
function briefingWorkloadTask(task: PinnedWorkloadTask): BriefingTask {
  const { workload } = task;
  const authority =
    workload.authority === undefined ? [] : [workload.authority];
  if (workload.runner === "Commands")
    return {
      framed: false,
      instructions: [],
      commands: workload.commands,
      ticketChecks: task.ticketChecks,
      practices: [],
      authority,
      worker: {
        mode: { type: "Commands", commands: workload.commands },
        setup: workload.worker?.setup ?? [],
        files: workload.worker?.files ?? [],
      },
    };
  return {
    framed: workload.framing === "Chuggy",
    prompt: workload.prompt.text,
    ...(workload.brief === undefined ? {} : { brief: workload.brief }),
    instructions: [],
    ticketChecks: false,
    practices: workload.practices ?? [],
    authority,
    worker: workload.worker,
  };
}

/** The task one view briefs, or none where its configuration covers no such stage. */
function briefingTask(view: BriefingView): BriefingTask | undefined {
  return pinnedWorkloadTaskOf(view.configuration)
    ? briefingWorkloadTask(view.configuration)
    : briefingConfigurationTask(view.configuration, view.purpose, view.stage);
}

/** What carries out one stage of a configuration, which its block's command lines decide; a ticket's own lines only join a stage that already has some. */
export function briefingStageCarrier(
  configuration: AuthoredTaskConfiguration,
  purpose: TaskPurpose,
  stage?: number,
): BriefingCarrier {
  const block = purposeBlock(configuration, purpose, stage);
  return block === undefined || blockCommandLines(block) === undefined
    ? "Agent"
    : "Commands";
}

/** The carrier one task renders under, which is the only thing the wording turns on. */
function briefingCarrier(task: BriefingTask): BriefingCarrier {
  return task.commands === undefined ? "Agent" : "Commands";
}

/**
 * The most command lines one stage is handed: the configuration's, and the
 * ticket's appended after them. It is the sum because a ticket only ever adds,
 * so a stage at both bounds is the longest list a worker ever runs.
 */
export const stageCommandsMax = commandLinesMax + briefChecksMax;

/**
 * The lines this ticket adds to the stage it is being composed for, which are
 * its own and only at the evaluation stage the configuration commands first.
 * Every later commanded stage runs the configuration's list alone, and a work
 * stage runs it alone whatever the ticket says: a ticket widens what its change
 * is held to, and never changes what the work is.
 */
function briefingTicketChecks(
  view: BriefingView,
  task: BriefingTask,
): readonly string[] {
  return task.ticketChecks ? (view.brief?.checks ?? []) : [];
}

/**
 * The whole list one commanded stage runs, the configuration's first, or
 * undefined where the stage briefs an agent. The order is the rule: a ticket
 * appends, so nothing it says can displace or precede a line the configuration
 * named.
 */
function briefingStageCommands(
  view: BriefingView,
  task: BriefingTask,
): readonly string[] | undefined {
  return task.commands === undefined
    ? undefined
    : [...task.commands, ...briefingTicketChecks(view, task)];
}

/** Whether the revision that came back is the one the durable execution row pinned. */
function briefingPinFault(view: BriefingView): BriefingFault | undefined {
  if (
    view.configuration.configurationRevision !== view.pin.configurationRevision
  ) {
    return "RevisionMismatch";
  }
  if (view.configuration.configurationDigest !== view.pin.configurationDigest) {
    return "DigestMismatch";
  }
  return undefined;
}

/** What the pinned configuration has to be to render, the empty brief included. */
function briefingConfigurationFault(
  view: BriefingView,
): BriefingFault | undefined {
  const pinned = briefingPinFault(view);
  if (pinned !== undefined) return pinned;
  const task = briefingTask(view);
  if (task === undefined) return "StageNotCovered";
  const brief = task.brief;
  if (
    !pinnedWorkloadTaskOf(view.configuration) &&
    brief !== undefined &&
    brief.motivation.length === 0 &&
    brief.acceptanceCriteria.length === 0
  ) {
    return "EmptyBrief";
  }
  return briefingListsFault([
    [brief?.motivation, briefingLinesMax],
    [brief?.acceptanceCriteria, briefingLinesMax],
    [brief?.constraints, briefingLinesMax],
    [task.instructions, briefingLinesMax],
    [briefingStageCommands(view, task), stageCommandsMax],
  ]);
}

/** What the gathered runtime facts have to be to render, which is bounded and printable. */
function briefingRuntimeFault(
  runtime: RuntimeFacts,
): BriefingFault | undefined {
  return briefingListsFault([
    [runtime.workspace === undefined ? [] : [runtime.workspace], 1],
    [runtime.changedFiles, runtimeChangedFilesMax],
    [runtime.handoff, runtimeHandoffLinesMax],
  ]);
}

/** What a failed landing's commits have to be to render, which is printable lines. */
function briefingFailedLandingFault(
  landing: FailedLanding | undefined,
): BriefingFault | undefined {
  if (landing === undefined) return undefined;
  return briefingListsFault([
    [[landing.targetCommit], 1],
    [landing.changeCommit === undefined ? [] : [landing.changeCommit], 1],
  ]);
}

/** One dependency as it renders: what it delivered, whether its repository is readable here, and whether its report fit. */
interface BriefedDependency {
  readonly delivery: DependencyDelivery;
  readonly readable: boolean;
  readonly reportCarried: boolean;
}

/**
 * Each dependency as it renders. Reports are admitted whole and in the order
 * the dependencies ascend, each where it fits the room the ones before it
 * left, so which are carried is a function of the reports alone.
 */
function briefingDependenciesBriefed(
  view: BriefingView,
): readonly BriefedDependency[] {
  let room = dependencyReportsCharsMax;
  const briefed: BriefedDependency[] = [];
  for (const delivery of view.dependencyDeliveries) {
    const chars =
      delivery.report === undefined ? 0 : textCodePointsCount(delivery.report);
    const reportCarried = delivery.report !== undefined && chars <= room;
    if (reportCarried) room -= chars;
    briefed.push({
      delivery,
      readable:
        delivery.repository !== undefined &&
        view.readOnlyRepositories.includes(delivery.repository.repository),
      reportCarried,
    });
  }
  return briefed;
}

/** The report line one dependency renders, or none where its work reported nothing. */
function briefingDependencyReportLines(
  briefed: BriefedDependency,
): readonly string[] {
  const report = briefed.delivery.report;
  if (report === undefined) return [];
  return [
    briefed.reportCarried
      ? briefingDependencyReportLine(report)
      : briefingDependencyReportUncarried,
  ];
}

/** The dependencies' section, opened by what a reader needs before any one of them. */
function briefingDependencyDeliveryLines(
  view: BriefingView,
): readonly string[] {
  const briefed = briefingDependenciesBriefed(view);
  if (briefed.length === 0) return [];
  return [
    briefingDependencyPreface,
    ...briefed.flatMap((each) => [
      briefingDependencyName(each.delivery),
      ...[
        ...briefingDependencyLines(each.delivery, each.readable),
        ...briefingDependencyReportLines(each),
      ].map(briefingBullet),
    ]),
  ];
}

/**
 * What the dependencies have to be to render: no more than a draft may name,
 * every line of them printable and bounded, and every report carried a
 * document within its own bound.
 */
function briefingDependencyDeliveriesFault(
  view: BriefingView,
): BriefingFault | undefined {
  if (view.dependencyDeliveries.length > dependencyDeliveriesMax)
    return "TooManyLines";
  for (const each of briefingDependenciesBriefed(view)) {
    for (const line of [
      briefingDependencyName(each.delivery),
      ...briefingDependencyLines(each.delivery, each.readable),
    ]) {
      const fault = briefingLineFault(line);
      if (fault !== undefined) return fault;
    }
    if (each.reportCarried && each.delivery.report !== undefined) {
      const fault = briefingReportFault(each.delivery.report);
      if (fault !== undefined) return fault;
    }
  }
  return undefined;
}

/** What one earlier work task's report has to be to render, which is a document's bound. */
function briefingReportFault(report: string): BriefingFault | undefined {
  if (report.length === 0) return "EmptyLine";
  if (textCodePointsCount(report) > resultReportCharsMax)
    return "ReportTooLong";
  if (!report.isWellFormed() || resultTextControlCharacter(report))
    return "TextUnreadable";
  return undefined;
}

/** What a gathered list of reports has to be, which is bounded and made of renderable reports. */
function briefingReportsFault(
  reports: readonly string[],
  reportsMax: number,
): BriefingFault | undefined {
  if (reports.length > reportsMax) return "TooManyLines";
  for (const report of reports) {
    const fault = briefingReportFault(report);
    if (fault !== undefined) return fault;
  }
  return undefined;
}

/**
 * What the ticket's own intent has to be to render. It is one text bounded as a
 * whole, so the bound is taken over all of it and a line of it is refused only
 * for what it cannot print, however long it is and however many there are.
 */
function briefingTicketIntentFault(
  intent: BriefIntent,
): BriefingFault | undefined {
  if (textCodePointsCount(intent) > briefIntentCharsMax) return "TextTooLong";
  return briefIntentLines(intent).some(taskConfigurationLineUnreadable)
    ? "TextUnreadable"
    : undefined;
}

/** What the ticket's own brief has to be to render, which is bounded and printable. */
function briefingTicketBriefFault(
  brief: DraftBrief | undefined,
): BriefingFault | undefined {
  if (brief === undefined) return undefined;
  return (
    briefingListsFault([[briefingTicketTitleLines(brief), 1]]) ??
    briefingTicketIntentFault(brief.intent) ??
    briefingListsFault([
      [brief.links, briefLinksMax],
      [brief.images, briefImagesMax],
      [brief.checks, briefChecksMax],
    ])
  );
}

/** A title renders as one line, or as none where the brief named none. */
function briefingTicketTitleLines(brief: DraftBrief): readonly string[] {
  return brief.title === undefined ? [] : [brief.title];
}

/** The ticket's own words: what it is called, where it is called anything, and
 * then what it asks for. */
function briefingTicketIntentLines(brief: DraftBrief): readonly string[] {
  return [
    ...briefingTicketTitleLines(brief),
    ...briefIntentLines(brief.intent),
  ];
}

/** One list member as it renders, which is the only list shape a briefing has. */
function briefingBullet(line: string): string {
  return `- ${line}`;
}

/**
 * One image's own line: its media type, recovered from its own identity, and
 * the path this attempt reads its bytes from under `workerPlaneBytesMediaType`.
 * An identity this tree never minted names no media type and renders nothing,
 * which a runtime fact cannot forge a section out of rather than crashing on.
 */
function briefingImageLine(artifact: ProjectArtifactId): string | undefined {
  const mediaType = projectArtifactMediaTypeOf(artifact);
  if (mediaType === undefined) return undefined;
  const path = workerPlaneRoutes.inputArtifact.path.replace("*", artifact);
  return `${mediaType}: GET ${path}, with this attempt's own bearer`;
}

/** The ticket's own images, each named by its media type and where this attempt reads its bytes. */
function briefingTicketImageLines(
  images: readonly ProjectArtifactId[],
): readonly string[] {
  return images
    .map(briefingImageLine)
    .filter((line): line is string => line !== undefined)
    .map(briefingBullet);
}

/** A labelled list, or nothing at all when there is nothing to label. */
function briefingLabelled(
  label: string,
  lines: readonly string[],
): readonly string[] {
  return lines.length === 0 ? [] : [label, ...lines.map(briefingBullet)];
}

/** The evaluators' failed reports as a work task reads them, prefaced by what they mean. */
function briefingEvaluationReportLines(
  priorEvaluationReports: PriorEvaluationReports,
): readonly string[] {
  const labelled = briefingLabelled(
    briefingLabels.evaluationReports,
    priorEvaluationReports.reports,
  );
  return labelled.length === 0 ? [] : [...briefingReworkPreface, ...labelled];
}

/** The acceptance criteria and the constraints, each labelled and each free to be absent. */
function briefingCriteriaLines(brief: TicketBrief): readonly string[] {
  return [
    ...briefingLabelled(
      briefingLabels.acceptanceCriteria,
      brief.acceptanceCriteria,
    ),
    ...briefingLabelled(briefingLabels.constraints, brief.constraints),
  ];
}

/**
 * The runtime facts as lines, each of them absent when the adapter observed
 * nothing, and the project's other repositories as one line beside the
 * workspace, absent where the project binds no other.
 */
function briefingRuntimeLines(
  runtime: RuntimeFacts,
  readOnlyRepositories: readonly RepositoryId[],
): readonly string[] {
  return [
    ...(runtime.workspace === undefined
      ? []
      : [`${briefingLabels.workspace} ${runtime.workspace}`]),
    ...(readOnlyRepositories.length === 0
      ? []
      : [
          `${briefingLabels.readOnlyRepositories} ${readOnlyRepositories.join(", ")}`,
        ]),
    ...briefingLabelled(briefingLabels.changedFiles, runtime.changedFiles),
    ...briefingLabelled(briefingLabels.handoff, runtime.handoff),
  ];
}

/** A body for every section identity, which is what makes the order below a filter. */
function briefingBodies(
  view: BriefingView,
  task: BriefingTask,
  practices: readonly BlessedPractice[],
): Record<BriefingSectionId, readonly string[]> {
  const commands = briefingStageCommands(view, task);
  const carrier = briefingCarrier(task);
  const briefed = carrier === "Agent";
  return {
    Prompt: task.prompt === undefined ? [] : [task.prompt],
    RoleInstructions: task.framed
      ? briefingRoleInstructions(view.purpose, carrier)
      : [],
    TicketIntent:
      view.brief === undefined ? [] : briefingTicketIntentLines(view.brief),
    TicketLinks:
      view.brief === undefined ? [] : view.brief.links.map(briefingBullet),
    TicketImages:
      view.brief === undefined
        ? []
        : briefingTicketImageLines(view.brief.images),
    WhyItMatters: task.brief?.motivation ?? [],
    AcceptanceAndConstraints:
      task.brief === undefined ? [] : briefingCriteriaLines(task.brief),
    DependencyDeliveries: briefed ? briefingDependencyDeliveryLines(view) : [],
    FailedLanding:
      briefed && view.purpose === "Work" && view.failedLanding !== undefined
        ? briefingFailedLandingLines(view.failedLanding)
        : [],
    PriorEvaluationReports:
      briefed && view.purpose === "Work"
        ? briefingEvaluationReportLines(view.priorEvaluationReports)
        : [],
    PriorWorkReports:
      view.purpose === "Review"
        ? briefingLabelled(
            briefingLabels.workReports,
            view.priorWorkReports.reports,
          )
        : [],
    PurposeInstructions: task.instructions,
    CheckCommands: commands === undefined ? [] : commands.map(briefingBullet),
    Practices: practices.map((practice) =>
      briefingBullet(practice.instruction),
    ),
    RuntimeContext: briefingRuntimeLines(
      view.runtime,
      view.readOnlyRepositories,
    ),
    RequiredResult: task.framed
      ? briefingRequiredResult(view.purpose, carrier)
      : [],
  };
}

/** One rendered section, carrying the identity it was rendered from. */
export interface BriefingSection {
  readonly section: BriefingSectionId;
  readonly heading: string;
  readonly lines: readonly string[];
}

/**
 * The seal a rendered briefing carries, whose value this module does not
 * export. What it does and does not prevent is in the header above.
 */
const briefingSeal = Symbol("chuggy:rendered-briefing");

/** One rendered briefing, sealed so a bare sequence of blocks cannot be offered as one. */
export interface RenderedBriefing {
  readonly seal: typeof briefingSeal;
  readonly purpose: TaskPurpose;
  readonly templateVersion: number;
  readonly sections: readonly BriefingSection[];
  readonly text: string;
}

/** Whether these sections are the fixed order with members removed, which is the postcondition. */
function briefingSectionsOrdered(
  sections: readonly BriefingSection[],
): boolean {
  let placed = -1;
  for (const section of sections) {
    const at = briefingSectionOrder.indexOf(section.section);
    if (at <= placed) return false;
    placed = at;
  }
  return true;
}

/**
 * One section as text, heading first, which is also what its retained size is
 * measured over. A workload's prompt is its own words and renders as written,
 * with no heading in front of it.
 */
function briefingSectionText(section: BriefingSection): string {
  return section.section === "Prompt"
    ? section.lines.join("\n")
    : [`## ${section.heading}`, ...section.lines].join("\n");
}

/** Renders the sections that have a body, in the one order this tree states. */
export function renderBriefing(
  view: BriefingView,
  practices: readonly BlessedPractice[],
): RenderedBriefing {
  const task = briefingTask(view);
  if (task === undefined)
    throw new RangeError(
      "task briefing: the configuration covers no such stage",
    );
  const bodies = briefingBodies(view, task, practices);
  const carrier = briefingCarrier(task);
  const sections = briefingSectionOrder
    .filter((section) => bodies[section].length > 0)
    .map((section) => ({
      section,
      heading: briefingHeading(section, view.purpose, carrier),
      lines: bodies[section],
    }));
  if (!briefingSectionsOrdered(sections)) {
    throw new RangeError(
      "task briefing: the rendered sections are not the fixed order with members removed",
    );
  }
  return {
    seal: briefingSeal,
    purpose: view.purpose,
    templateVersion: briefingTemplateVersion,
    sections,
    text: sections.map(briefingSectionText).join("\n\n"),
  };
}

/**
 * One rendered section as the provenance row records it, which is its identity
 * and its size. A section composed from more than one source also records how
 * many of its lines the ticket's own brief supplied, so a reader can tell what
 * a stage ran because of the configuration from what it ran because of the
 * ticket; a section with one source records none.
 */
export interface BriefingProvenanceSection {
  readonly section: BriefingSectionId;
  readonly chars: number;
  readonly ticketLines?: number;
}

/**
 * The bounded row a launch retains. It has no field a rendered prompt, a
 * credential or a piece of source material could be put in.
 */
export interface BriefingProvenance extends ConfigurationPin {
  readonly templateVersion: number;
  readonly purpose: TaskPurpose;
  readonly practices: readonly PracticeId[];
  readonly sections: readonly BriefingProvenanceSection[];
}

/** The one section a ticket adds lines to, whose split of sources is recorded. */
const briefingTicketSourcedSection: BriefingSectionId = "CheckCommands";

/** The provenance of one rendered briefing, which is what obligation 14 asks be kept. */
function briefingProvenance(
  briefing: RenderedBriefing,
  pin: ConfigurationPin,
  practices: readonly BlessedPractice[],
  ticketLines: number,
): BriefingProvenance {
  return {
    configurationRevision: pin.configurationRevision,
    configurationDigest: pin.configurationDigest,
    templateVersion: briefing.templateVersion,
    purpose: briefing.purpose,
    practices: practices.map((practice) => practice.practice),
    sections: briefing.sections.map((section) => ({
      section: section.section,
      chars: briefingSectionText(section).length,
      ...(section.section === briefingTicketSourcedSection
        ? { ticketLines }
        : {}),
    })),
  };
}

/** The narrowing every briefing leads with: a briefed worker reports a result and completes nothing. */
export const briefingAuthorityFloor: AuthorityRequest = {
  mayCompleteTask: false,
};

/** Every structured request one composition folds, the template's own first. */
function briefingAuthorityRequests(
  task: BriefingTask,
): readonly AuthorityRequest[] {
  return [briefingAuthorityFloor, ...task.authority];
}

/**
 * The worker configuration this stage runs under, which for a commanded stage
 * is the resolved command list rather than the authored agent mode. The
 * authored setup and files are kept, because a stage prepares its workspace the
 * same way whatever runs in it.
 */
function briefingWorker(
  view: BriefingView,
  task: BriefingTask,
): AuthoredTaskConfiguration["worker"] {
  const commands = briefingStageCommands(view, task);
  const worker = task.worker;
  if (commands === undefined) return worker;
  return {
    mode: { type: "Commands", commands },
    setup: worker?.setup ?? [],
    files: worker?.files ?? [],
  };
}

/** What a launched worker receives: what to do, what it may do, and what was retained about both. */
export interface TaskInvocation {
  readonly briefing: RenderedBriefing;
  readonly authority: TaskAuthority;
  readonly provenance: BriefingProvenance;
  readonly worker?: AuthoredTaskConfiguration["worker"];
}

/** What composing one invocation found, the refusal a value like every other here. */
export type TaskComposed =
  | { readonly composed: "Composed"; readonly invocation: TaskInvocation }
  | { readonly composed: "Blocked"; readonly fault: BriefingFault };

/**
 * What one invocation weighs on the wire: everything a fabric has to carry to
 * its worker, and nothing the retention rule keeps behind. The provenance is
 * left out because it is retained here rather than handed over.
 */
export function taskInvocationBytes(invocation: TaskInvocation): number {
  return new TextEncoder().encode(
    JSON.stringify({
      briefing: {
        templateVersion: invocation.briefing.templateVersion,
        purpose: invocation.briefing.purpose,
        text: invocation.briefing.text,
      },
      authority: taskAuthorityGrant(invocation.authority),
      ...(invocation.worker === undefined ? {} : { worker: invocation.worker }),
    }),
  ).byteLength;
}

/** Composes one role's invocation from the pinned configuration and the gathered facts. */
export function composeTaskInvocation(
  catalog: PracticeCatalog,
  view: BriefingView,
): TaskComposed {
  const fault =
    briefingConfigurationFault(view) ??
    briefingRuntimeFault(view.runtime) ??
    briefingListsFault([
      [view.readOnlyRepositories, readOnlyRepositoriesMax],
    ]) ??
    briefingReportsFault(view.priorWorkReports.reports, priorWorkReportsMax) ??
    briefingReportsFault(
      view.priorEvaluationReports.reports,
      priorEvaluationReportsMax,
    ) ??
    briefingFailedLandingFault(view.failedLanding) ??
    briefingDependencyDeliveriesFault(view) ??
    briefingTicketBriefFault(view.brief);
  if (fault !== undefined) return { composed: "Blocked", fault };
  const task = briefingTask(view);
  if (task === undefined)
    return { composed: "Blocked", fault: "StageNotCovered" };
  const resolved = resolvePractices(catalog, view.purpose, task.practices);
  if (resolved.resolved === "Refused") {
    return { composed: "Blocked", fault: resolved.fault };
  }
  const briefing = renderBriefing(view, resolved.practices);
  const worker = briefingWorker(view, task);
  const invocation: TaskInvocation = {
    briefing,
    authority: resolveTaskAuthority(
      view.grant,
      briefingAuthorityRequests(task),
    ),
    provenance: briefingProvenance(
      briefing,
      view.pin,
      resolved.practices,
      briefingTicketChecks(view, task).length,
    ),
    ...(worker === undefined ? {} : { worker }),
  };
  return taskInvocationBytes(invocation) > taskInvocationBytesMax
    ? { composed: "Blocked", fault: "EnvelopeTooLong" }
    : { composed: "Composed", invocation };
}
