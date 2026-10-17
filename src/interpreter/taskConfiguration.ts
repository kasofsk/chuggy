/**
 * The authored task-briefing contract shared by release and scheduling.
 *
 * A STAGE NAMES COMMANDS OR BRIEFS AN AGENT, AND THE DOCUMENT SAYS WHICH. The
 * work stage and each evaluation stage are two-kind blocks: one carries the
 * lines the worker runs itself, the other the instructions an agent is briefed
 * with. A block saying both or neither is refused rather than read as one of
 * them, and a field a commanded block has no place for is refused rather than
 * dropped, because a stage runs shell under whatever narrowing it was given.
 *
 * A TICKET'S OWN CHECK LINES ARE AN EVALUATION'S, WHICH IS WHY THE TWO KINDS
 * SPELL THEIR LINES DIFFERENTLY. `checks` is what a ticket may append to and
 * `commands` is not: a ticket widens what its change is held to, and never
 * changes what the work is.
 *
 * A COMMANDED WORK STAGE IS EXPECTED TO BE ONE LINE INVOKING ONE SCRIPT THE
 * REPOSITORY OWNS, which is where the argument for what that work does
 * belongs rather than in a list of shell. The commands' exit status is the
 * whole verdict, and an attempt whose commands changed nothing still declares
 * a commit, so a repository's command must fail rather than produce an empty
 * candidate.
 *
 * WHAT A DOCUMENT MAY BE IS `src/contract/configurationDocument.ts`'S, which
 * decides acceptance here and is what the API publishes. This module names the
 * fault a refusal reports: the first field, in the contract's order, whose
 * shape is wrong, and only where every shape holds the first fault of the
 * content, an empty brief before the practices and the practices before any
 * line.
 */

import type { z } from "zod";

import {
  configurationAgentEvaluationSchema,
  configurationAuthoritySchema,
  configurationBriefedWorkSchema,
  configurationBriefSchema,
  configurationCommandedEvaluationSchema,
  configurationCommandedWorkSchema,
  configurationContentFaults,
  configurationEvaluationsSchema,
  configurationLineSchema,
  configurationLinePattern,
  configurationPracticesSchema,
  configurationPurposeSchema,
  configurationTaskSchema,
  configurationWorkerSchema,
  type ConfigurationContentFault,
  type configurationLegacyWorkerSchema,
  type configurationWorkerModeSchema,
} from "../contract/configurationDocument.ts";

/** The practice roster and the list bounds, surfaced where a configuration is read. */
export {
  allPracticeIds,
  briefingLinesMax,
  evaluationBlocksMax,
  type PracticeId,
} from "../contract/configurationDocument.ts";

/** The claim a ticket makes about itself, which both roles are briefed with unchanged. */
export type TicketBrief = TaskConfigurationReadonly<
  z.output<typeof configurationBriefSchema>
>;

/**
 * What one role is told beyond the shared brief, and what its blocks ask to
 * narrow. Both command fields are declared absent here and on every other
 * briefed kind, so the blocks a stage may be are one union a property tells
 * apart.
 */
export type PurposeBlock = TaskConfigurationReadonly<
  z.output<typeof configurationPurposeSchema>
> & { readonly checks?: undefined; readonly commands?: undefined };

/**
 * What one indexed evaluation stage briefs an agent with, beyond the shared
 * brief. Its practices are held as names, which composing a briefing resolves
 * against the catalog it is handed.
 */
export type AgentEvaluationBlock = TaskConfigurationReadonly<
  Omit<
    z.output<typeof configurationAgentEvaluationSchema>,
    "checks" | "practices"
  >
> & {
  readonly practices: readonly string[];
  readonly checks?: undefined;
  readonly commands?: undefined;
};

/** One check stage the worker runs itself: command lines, and no agent to brief. */
export interface CommandEvaluationBlock {
  readonly purpose: "Check";
  readonly checks: readonly string[];
  readonly commands?: undefined;
  readonly instructions?: undefined;
  readonly authority?: undefined;
}

/** One indexed evaluation stage, which is one of the two kinds a stage may be. */
export type EvaluationBlock = AgentEvaluationBlock | CommandEvaluationBlock;

/** The work stage the worker runs itself: command lines, and no agent to brief. */
export interface CommandWorkBlock {
  readonly commands: readonly string[];
  readonly checks?: undefined;
  readonly instructions?: undefined;
  readonly authority?: undefined;
}

/** The work stage, which is one of the two kinds a stage may be. */
export type WorkBlock = PurposeBlock | CommandWorkBlock;

/** Every block one composed stage resolves to, across both roles and both kinds. */
export type StageBlock = WorkBlock | EvaluationBlock;

/**
 * The lines one stage hands its worker, or undefined where the stage briefs an
 * agent instead. The two kinds spell them apart for the reason the header
 * gives.
 */
export function blockCommandLines(
  block: StageBlock,
): readonly string[] | undefined {
  return block.checks ?? block.commands;
}

/** Whether one evaluation stage is the kind the worker runs itself. */
function commandedEvaluationBlock(
  block: EvaluationBlock,
): block is CommandEvaluationBlock {
  return block.checks !== undefined;
}

/**
 * The stage a ticket's own check lines join, which is the first one the
 * configuration runs as commands. A configuration commanding none has no stage
 * for a ticket to append to, and a ticket carrying lines cannot be released
 * against it.
 */
export function firstCommandedCheckStage(
  configuration: AuthoredTaskConfiguration,
): number | undefined {
  const at = (configuration.evaluations ?? []).findIndex(
    commandedEvaluationBlock,
  );
  return at === -1 ? undefined : at;
}

/**
 * Whether any stage the configuration runs briefs an agent: the work stage, and
 * each evaluation stage or, where it indexes none, the shared review block. A
 * worker runs such a stage only where the configuration names its agent, and a
 * commanded stage is handed its own lines instead.
 */
export function briefsAnyAgent(
  configuration: AuthoredTaskConfiguration,
): boolean {
  return [
    configuration.work,
    ...(configuration.evaluations ?? [configuration.review]),
  ].some((block) => blockCommandLines(block) === undefined);
}

/** One agent invocation, the only worker execution mode currently admitted. */
export type SingleAgentWorkerMode = TaskConfigurationReadonly<
  z.output<typeof configurationWorkerModeSchema>
>;

/**
 * The resolved command lines a check stage runs, in order, with no agent. The
 * worker runs this list and never reads the configuration block it came from.
 */
export interface CommandsWorkerMode {
  readonly type: "Commands";
  readonly commands: readonly string[];
}

/** How the worker executes a task, discriminated so each mode owns its options. */
export type WorkerMode = SingleAgentWorkerMode | CommandsWorkerMode;

/** What every worker carries whichever way it names its agent. */
type WorkerFields = TaskConfigurationReadonly<
  Pick<z.output<typeof configurationLegacyWorkerSchema>, "setup" | "files">
>;

/** Runtime inputs whose canonical authored bytes travel with every task invocation. */
export type ModeWorkerConfiguration = WorkerFields & {
  readonly mode: WorkerMode;
};

/** The worker shape retained by immutable configurations that predate modes. */
export type LegacyClaudeWorkerConfiguration = WorkerFields & {
  readonly arguments: readonly string[];
};

export type WorkerConfiguration =
  ModeWorkerConfiguration | LegacyClaudeWorkerConfiguration;

/**
 * The authored part of a task configuration, before storage supplies its
 * immutable pin. Its practices are held as names, as a stage's are.
 */
export type AuthoredTaskConfiguration = TaskConfigurationReadonly<
  Omit<
    z.output<typeof configurationTaskSchema>,
    "practices" | "work" | "evaluations" | "worker"
  >
> & {
  readonly practices: readonly string[];
  readonly work: WorkBlock;
  readonly evaluations?: readonly EvaluationBlock[];
  readonly worker?: WorkerConfiguration;
};

/** Why an authored document cannot supply the briefing contract. */
export type TaskConfigurationFault =
  | "BriefingShapeMissing"
  | "MotivationInvalid"
  | "AcceptanceCriteriaInvalid"
  | "ConstraintsInvalid"
  | "PracticesInvalid"
  | "WorkInvalid"
  | "CommandsInvalid"
  | "WorkKindAmbiguous"
  | "WorkFieldUnknown"
  | "ReviewInvalid"
  | "EvaluationsInvalid"
  | "ChecksInvalid"
  | "EvaluationKindAmbiguous"
  | "EvaluationFieldUnknown"
  | "AuthorityInvalid"
  | "WorkerInvalid"
  | ConfigurationContentFault;

/** Every authored fault, so a suite and an evidence label iterate rather than restate. */
export const allTaskConfigurationFaults: readonly TaskConfigurationFault[] = [
  "BriefingShapeMissing",
  "MotivationInvalid",
  "AcceptanceCriteriaInvalid",
  "ConstraintsInvalid",
  "PracticesInvalid",
  "WorkInvalid",
  "CommandsInvalid",
  "WorkKindAmbiguous",
  "WorkFieldUnknown",
  "ReviewInvalid",
  "EvaluationsInvalid",
  "ChecksInvalid",
  "EvaluationKindAmbiguous",
  "EvaluationFieldUnknown",
  "AuthorityInvalid",
  "WorkerInvalid",
  "EmptyBrief",
  "UnknownPractice",
  "DuplicatePractice",
  "EmptyLine",
  "TextTooLong",
  "TextUnreadable",
  "TooManyLines",
];

/**
 * A definitive fault while reading authored content, including unreadable
 * canonical bytes and a catalog that holds no workload for the task read.
 */
export type TaskConfigurationReadFault =
  | TaskConfigurationFault
  | "ConfigurationUnreadable"
  | "DigestMismatch"
  | "WorkloadUnselected";

/** Every read fault, which is every authored one and the ones a read of its own adds. */
export const allTaskConfigurationReadFaults: readonly TaskConfigurationReadFault[] =
  [
    ...allTaskConfigurationFaults,
    "ConfigurationUnreadable",
    "DigestMismatch",
    "WorkloadUnselected",
  ];

/** A parsed authored briefing, or the bounded reason it cannot be one. */
export type AuthoredTaskConfigurationReadiness =
  | {
      readonly readiness: "Ready";
      readonly configuration: AuthoredTaskConfiguration;
    }
  | {
      readonly readiness: "Incomplete";
      readonly fault: TaskConfigurationFault;
    };

type BriefingTextFault = Extract<
  TaskConfigurationFault,
  "EmptyLine" | "TextTooLong" | "TextUnreadable" | "TooManyLines"
>;

/** The faults a line or a list of lines earns. */
const briefingTextFaults: readonly BriefingTextFault[] = [
  "EmptyLine",
  "TextTooLong",
  "TextUnreadable",
  "TooManyLines",
];

/** Whether a line carries what a briefing cannot print: half a character, or a control character. */
export function taskConfigurationLineUnreadable(line: string): boolean {
  return !configurationLinePattern.test(line);
}

/** Returns the bounded text fault one authored line earns, if any. */
export function taskConfigurationLineFault(
  line: string,
): BriefingTextFault | undefined {
  const parsed = configurationLineSchema.safeParse(line);
  if (parsed.success) return undefined;
  const message = parsed.error.issues[0]?.message;
  const fault = briefingTextFaults.find((known) => known === message);
  if (fault === undefined)
    throw new Error(`task configuration: a line was refused as ${message}`);
  return fault;
}

type TaskConfigurationReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: TaskConfigurationReadonly<Value[Key]> }
  : Value;

type TaskConfigurationIssue = z.core.$ZodIssue;

/** What one field of a document says of itself: the fault its shape earns, or the issues its content earns. */
type TaskConfigurationReading =
  | { readonly reading: "Shape"; readonly fault: TaskConfigurationFault }
  | {
      readonly reading: "Content";
      readonly issues: readonly TaskConfigurationIssue[];
    };

/** No issue at all, which is what a field the document leaves out reads as. */
const taskConfigurationAbsent: TaskConfigurationReading = {
  reading: "Content",
  issues: [],
};

function taskConfigurationRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The issues `schema` raises against `value`, each placed at its path from the document's root. */
function taskConfigurationIssues(
  schema: z.ZodType,
  value: unknown,
  at: readonly PropertyKey[],
): readonly TaskConfigurationIssue[] {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        ...issue,
        path: [...at, ...issue.path],
      }));
}

/** The content fault an issue names, where it names one: never under an authority, which is a narrowing and has no content. */
function taskConfigurationContentFault(
  issue: TaskConfigurationIssue,
): ConfigurationContentFault | undefined {
  return issue.path.includes("authority")
    ? undefined
    : configurationContentFaults.find((fault) => fault === issue.message);
}

/** A field's issues read as its first shape fault, named by `fault`, or else as its content. */
function taskConfigurationReading(
  issues: readonly TaskConfigurationIssue[],
  fault: (issue: TaskConfigurationIssue) => TaskConfigurationFault,
): TaskConfigurationReading {
  const shape = issues.find(
    (issue) => taskConfigurationContentFault(issue) === undefined,
  );
  return shape === undefined
    ? { reading: "Content", issues }
    : { reading: "Shape", fault: fault(shape) };
}

function taskConfigurationBriefFault(
  issue: TaskConfigurationIssue,
): TaskConfigurationFault {
  switch (issue.path[1] ?? "") {
    case "motivation":
      return "MotivationInvalid";
    case "acceptanceCriteria":
      return "AcceptanceCriteriaInvalid";
    case "constraints":
      return "ConstraintsInvalid";
    default:
      return "BriefingShapeMissing";
  }
}

/**
 * The work stage, which names the commands the worker runs or briefs an agent
 * with instructions. Naming both or neither says neither, and a commanded work
 * stage has no place for an agent's narrowing.
 */
function taskConfigurationWorkReading(
  value: unknown,
): TaskConfigurationReading {
  const record = taskConfigurationRecord(value);
  if (record === undefined) return { reading: "Shape", fault: "WorkInvalid" };
  const commanded = Object.hasOwn(record, "commands");
  if (commanded === (record["instructions"] !== undefined))
    return { reading: "Shape", fault: "WorkKindAmbiguous" };
  if (!commanded)
    return taskConfigurationReading(
      taskConfigurationIssues(configurationBriefedWorkSchema, record, ["work"]),
      () => "WorkInvalid",
    );
  const issues = taskConfigurationIssues(
    configurationCommandedWorkSchema,
    record,
    ["work"],
  );
  return issues.some((issue) => issue.code === "unrecognized_keys")
    ? { reading: "Shape", fault: "WorkFieldUnknown" }
    : taskConfigurationReading(issues, () => "CommandsInvalid");
}

/**
 * Whether an entry says which kind of stage it is. A check stage names its
 * commands or briefs an agent, and naming both or neither says neither.
 */
function taskConfigurationEvaluationKindAmbiguous(
  record: Record<string, unknown>,
): boolean {
  const commanded = Object.hasOwn(record, "checks");
  const briefed =
    record["instructions"] !== undefined || record["practices"] !== undefined;
  return commanded
    ? briefed || record["purpose"] !== "Check"
    : record["purpose"] === "Check" && !briefed;
}

function taskConfigurationEvaluationReading(
  value: unknown,
  stage: number,
): TaskConfigurationReading {
  const record = taskConfigurationRecord(value);
  if (record === undefined)
    return { reading: "Shape", fault: "EvaluationsInvalid" };
  if (taskConfigurationEvaluationKindAmbiguous(record))
    return { reading: "Shape", fault: "EvaluationKindAmbiguous" };
  const at = ["evaluations", stage];
  if (!Object.hasOwn(record, "checks"))
    return taskConfigurationReading(
      taskConfigurationIssues(configurationAgentEvaluationSchema, record, at),
      () => "EvaluationsInvalid",
    );
  const issues = taskConfigurationIssues(
    configurationCommandedEvaluationSchema,
    record,
    at,
  );
  return issues.some((issue) => issue.code === "unrecognized_keys")
    ? { reading: "Shape", fault: "EvaluationFieldUnknown" }
    : taskConfigurationReading(issues, () => "ChecksInvalid");
}

/** The evaluation stages, where the list's own bounds are read before any stage, and stages in order. */
function taskConfigurationEvaluationsReading(
  value: unknown,
): TaskConfigurationReading {
  if (value === undefined) return taskConfigurationAbsent;
  const listed = taskConfigurationIssues(
    configurationEvaluationsSchema,
    value,
    [],
  );
  if (!Array.isArray(value) || listed.some((issue) => issue.path.length === 0))
    return { reading: "Shape", fault: "EvaluationsInvalid" };
  const issues: TaskConfigurationIssue[] = [];
  for (const [stage, entry] of value.entries()) {
    const reading = taskConfigurationEvaluationReading(entry, stage);
    if (reading.reading === "Shape") return reading;
    issues.push(...reading.issues);
  }
  return { reading: "Content", issues };
}

/** A field every issue of which is its own one fault, which is how a narrowing and a worker are read. */
function taskConfigurationWholeReading(
  schema: z.ZodType,
  value: unknown,
  fault: TaskConfigurationFault,
): TaskConfigurationReading {
  return value === undefined || schema.safeParse(value).success
    ? taskConfigurationAbsent
    : { reading: "Shape", fault };
}

/** Each field's reading, in the order the contract states the fields and an import names the first fault in. */
function taskConfigurationReadings(
  record: Record<string, unknown>,
): readonly TaskConfigurationReading[] {
  return [
    taskConfigurationReading(
      taskConfigurationIssues(configurationBriefSchema, record["brief"], [
        "brief",
      ]),
      taskConfigurationBriefFault,
    ),
    taskConfigurationReading(
      taskConfigurationIssues(
        configurationPracticesSchema,
        record["practices"],
        ["practices"],
      ),
      () => "PracticesInvalid",
    ),
    taskConfigurationWorkReading(record["work"]),
    taskConfigurationReading(
      taskConfigurationIssues(configurationPurposeSchema, record["review"], [
        "review",
      ]),
      () => "ReviewInvalid",
    ),
    taskConfigurationEvaluationsReading(record["evaluations"]),
    taskConfigurationWholeReading(
      configurationAuthoritySchema,
      record["authority"],
      "AuthorityInvalid",
    ),
    taskConfigurationWholeReading(
      configurationWorkerSchema,
      record["worker"],
      "WorkerInvalid",
    ),
  ];
}

/** The brief's lists in the order their lines are read. */
const taskConfigurationBriefLists: readonly PropertyKey[] = [
  "motivation",
  "acceptanceCriteria",
  "constraints",
];

/**
 * Where one content issue falls in the order its fault is named in, compared
 * position by position. A brief that is empty comes first, then the practices
 * and each stage's practices, then every list of lines; within a list, the
 * list's own bound comes before any of its entries.
 */
function taskConfigurationContentRank(
  path: readonly PropertyKey[],
): readonly number[] {
  const within = (
    list: readonly number[],
    rest: readonly PropertyKey[],
  ): readonly number[] => [
    ...list,
    rest.length === 0 ? 0 : 1,
    ...rest.map(Number),
  ];
  const [field, key, part] = path;
  if (field === "brief")
    return key === undefined
      ? [0]
      : within([3, taskConfigurationBriefLists.indexOf(key)], path.slice(2));
  if (field === "practices") return within([1], path.slice(1));
  if (field === "work") return within([3, 3], path.slice(2));
  if (field === "review") return within([3, 4], path.slice(2));
  const stage = Number(key);
  return part === "practices"
    ? within([2, stage], path.slice(3))
    : within([3, 5 + stage], path.slice(3));
}

function taskConfigurationRankCompared(
  left: readonly number[],
  right: readonly number[],
): number {
  for (const [index, position] of left.entries()) {
    const other = right[index];
    if (other === undefined) return 1;
    if (position !== other) return position - other;
  }
  return left.length - right.length;
}

/** The first fault a document's content earns, once every field's shape holds. */
function taskConfigurationContentFirst(
  issues: readonly TaskConfigurationIssue[],
): ConfigurationContentFault | undefined {
  const [first] = [...issues].sort((left, right) =>
    taskConfigurationRankCompared(
      taskConfigurationContentRank(left.path),
      taskConfigurationContentRank(right.path),
    ),
  );
  return first === undefined ? undefined : taskConfigurationContentFault(first);
}

/** The fault a document earns, or undefined where it earns none. */
function taskConfigurationFault(
  value: unknown,
): TaskConfigurationFault | undefined {
  const record = taskConfigurationRecord(value);
  if (record === undefined) return "BriefingShapeMissing";
  const content: TaskConfigurationIssue[] = [];
  for (const reading of taskConfigurationReadings(record)) {
    if (reading.reading === "Shape") return reading.fault;
    content.push(...reading.issues);
  }
  return taskConfigurationContentFirst(content);
}

/** Parses the authored fields shared by every task a configuration revision briefs. */
export function authoredTaskConfigurationReadiness(
  value: unknown,
): AuthoredTaskConfigurationReadiness {
  const parsed = configurationTaskSchema.safeParse(value);
  if (parsed.success) return { readiness: "Ready", configuration: parsed.data };
  const fault = taskConfigurationFault(value);
  if (fault === undefined)
    throw new Error(
      `task configuration: refused with no fault named: ${parsed.error.message}`,
    );
  return { readiness: "Incomplete", fault };
}
