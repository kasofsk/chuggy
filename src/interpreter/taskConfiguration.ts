/** The authored task-briefing contract shared by release and scheduling. */

import { z } from "zod";

import { textCodePointsCount } from "../contract/http.ts";

/** The claim a ticket makes about itself, which both roles are briefed with unchanged. */
export type TicketBrief = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationHeaderSchema>["brief"]
>;

/** What one role is told beyond the shared brief, and what its blocks ask to narrow. */
export type PurposeBlock = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationPurposeSchema>
>;

/** What one indexed evaluation stage briefs an agent with, beyond the shared brief. */
export type AgentEvaluationBlock = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationAgentEvaluationSchema>
> & { readonly checks?: undefined };

/** One check stage the worker runs itself: command lines, and no agent to brief. */
export interface CommandEvaluationBlock {
  readonly purpose: "Check";
  readonly checks: readonly string[];
  readonly instructions?: undefined;
  readonly authority?: undefined;
}

/** One indexed evaluation stage, which is one of the two kinds a stage may be. */
export type EvaluationBlock = AgentEvaluationBlock | CommandEvaluationBlock;

/** Whether one block is the kind the worker runs itself rather than briefing an agent. */
export function commandedEvaluationBlock(
  block: PurposeBlock | EvaluationBlock,
): block is CommandEvaluationBlock {
  return "checks" in block && block.checks !== undefined;
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

/** One agent invocation, the only worker execution mode currently admitted. */
export type SingleAgentWorkerMode = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationWorkerModeSchema>
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

/** Runtime inputs whose canonical authored bytes travel with every task invocation. */
export type ModeWorkerConfiguration = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationWorkerSchema>
> & { readonly mode: WorkerMode };

/** The worker shape retained by immutable configurations that predate modes. */
export type LegacyClaudeWorkerConfiguration = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationWorkerSchema>
> & { readonly arguments: readonly string[] };

export type WorkerConfiguration =
  ModeWorkerConfiguration | LegacyClaudeWorkerConfiguration;

/** The authored part of a task configuration, before storage supplies its immutable pin. */
export type AuthoredTaskConfiguration = TaskConfigurationReadonly<
  z.output<typeof taskConfigurationSchema>
>;

/** The blessed practice identities accepted in authored configuration. */
export type PracticeId =
  "RegressionCoverage" | "ChangedCallPaths" | "AcceptanceCriteria";

/** Every accepted practice identity in stable rendering order. */
export const allPracticeIds: readonly PracticeId[] = [
  "RegressionCoverage",
  "ChangedCallPaths",
  "AcceptanceCriteria",
];

/** The longest single briefing line, which is one criterion, constraint or instruction. */
export const briefingLineCharsMax = 512;

/** The most lines one authored list may carry. */
export const briefingLinesMax = 8;

export const evaluationBlocksMax = 64;

/** The most command lines one check stage may name. */
export const evaluationChecksMax = 8;

/** Why an authored document cannot supply the briefing contract. */
export type TaskConfigurationFault =
  | "BriefingShapeMissing"
  | "MotivationInvalid"
  | "AcceptanceCriteriaInvalid"
  | "ConstraintsInvalid"
  | "PracticesInvalid"
  | "WorkInvalid"
  | "ReviewInvalid"
  | "EvaluationsInvalid"
  | "ChecksInvalid"
  | "EvaluationKindAmbiguous"
  | "EvaluationFieldUnknown"
  | "AuthorityInvalid"
  | "WorkerInvalid"
  | "EmptyBrief"
  | "UnknownPractice"
  | "DuplicatePractice"
  | "EmptyLine"
  | "TextTooLong"
  | "TextUnreadable"
  | "TooManyLines";

/** Every authored fault, so a suite and an evidence label iterate rather than restate. */
export const allTaskConfigurationFaults: readonly TaskConfigurationFault[] = [
  "BriefingShapeMissing",
  "MotivationInvalid",
  "AcceptanceCriteriaInvalid",
  "ConstraintsInvalid",
  "PracticesInvalid",
  "WorkInvalid",
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

/** A definitive fault while reading authored content, including unreadable canonical bytes. */
export type TaskConfigurationReadFault =
  TaskConfigurationFault | "ConfigurationUnreadable" | "DigestMismatch";

/** Every read fault, which is every authored one and the two a read of its own adds. */
export const allTaskConfigurationReadFaults: readonly TaskConfigurationReadFault[] =
  [...allTaskConfigurationFaults, "ConfigurationUnreadable", "DigestMismatch"];

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

const briefingFirstPrintable = 0x20;
const briefingFirstUpperControl = 0x7f;
const briefingLastUpperControl = 0x9f;

const workerEntriesMax = 64;
const workerContentCharsMax = 65_536;

/** Returns the bounded text fault one authored line earns, if any. */
export function taskConfigurationLineFault(
  line: string,
): BriefingTextFault | undefined {
  if (line.length === 0) return "EmptyLine";
  if (textCodePointsCount(line) > briefingLineCharsMax) return "TextTooLong";
  if (!line.isWellFormed()) return "TextUnreadable";
  for (const character of line) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code < briefingFirstPrintable ||
      (code >= briefingFirstUpperControl && code <= briefingLastUpperControl)
    )
      return "TextUnreadable";
  }
  return undefined;
}

function authoredTaskConfigurationStringArray(
  value: unknown,
): readonly string[] | undefined {
  return Array.isArray(value) && value.every((line) => typeof line === "string")
    ? value
    : undefined;
}

type TaskConfigurationReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: TaskConfigurationReadonly<Value[Key]> }
  : Value;

type TaskConfigurationDefined<Value> = {
  [
    Key in keyof Value as undefined extends Value[Key] ? never : Key
  ]: Value[Key];
} & {
  [Key in keyof Value as undefined extends Value[Key] ? Key : never]?: Exclude<
    Value[Key],
    undefined
  >;
};

/** Strips unknown keys and omits optional fields whose supplied value is undefined. */
function taskConfigurationObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z
    .object(shape)
    .transform(
      (value) =>
        Object.fromEntries(
          Object.entries(value).filter(([, field]) => field !== undefined),
        ) as TaskConfigurationDefined<typeof value>,
    );
}

function taskConfigurationParsed<Value>(
  schema: z.ZodType<Value>,
  value: unknown,
): Value | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const taskConfigurationNamesSchema = z
  .array(
    z
      .string()
      .refine((value) => taskConfigurationLineFault(value) === undefined),
  )
  .max(briefingLinesMax);

const taskConfigurationAuthoritySchema = taskConfigurationObject({
  tools: taskConfigurationNamesSchema.optional(),
  credentials: taskConfigurationNamesSchema.optional(),
  network: z.boolean().optional(),
  filesystem: z.enum(["None", "ReadWorkspace", "WriteWorkspace"]).optional(),
  mayCompleteTask: z.boolean().optional(),
});

const taskConfigurationPurposeShape = {
  instructions: z.array(z.string()),
  authority: taskConfigurationAuthoritySchema.optional(),
};
const taskConfigurationPurposeSchema = taskConfigurationObject(
  taskConfigurationPurposeShape,
);

const taskConfigurationHeaderSchema = z.object({
  brief: z.object({
    motivation: z.array(z.string()),
    acceptanceCriteria: z.array(z.string()),
    constraints: z.array(z.string()),
  }),
  practices: z.array(z.string()),
  work: taskConfigurationPurposeSchema,
  review: taskConfigurationPurposeSchema,
});

function taskConfigurationHeaderFault(
  path: readonly PropertyKey[],
): TaskConfigurationFault {
  if (path[0] === "brief") {
    switch (path[1] ?? "") {
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
  switch (path[0] ?? "") {
    case "practices":
      return "PracticesInvalid";
    case "work":
      return "WorkInvalid";
    case "review":
      return "ReviewInvalid";
    default:
      return "BriefingShapeMissing";
  }
}

const taskConfigurationAgentEvaluationSchema = taskConfigurationObject({
  ...taskConfigurationPurposeShape,
  practices: z.array(z.string()),
  purpose: z.enum(["Review", "Check"]).default("Review"),
});

const taskConfigurationWorkerFields = {
  setup: z.array(z.string()).max(workerEntriesMax),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z
          .string()
          .refine(
            (value) => textCodePointsCount(value) <= workerContentCharsMax,
          ),
      }),
    )
    .max(workerEntriesMax),
};
const taskConfigurationWorkerSchema = z.object(taskConfigurationWorkerFields);
const taskConfigurationWorkerArguments = z
  .array(z.string())
  .max(workerEntriesMax);
const taskConfigurationWorkerModeSchema = z.discriminatedUnion("agent", [
  z
    .object({
      type: z.literal("SingleAgent"),
      agent: z.literal("Claude"),
      arguments: taskConfigurationWorkerArguments,
      model: z.undefined().optional(),
    })
    .transform(({ type, agent, arguments: args }) => ({
      type,
      agent,
      arguments: args,
    })),
  z.object({
    type: z.literal("SingleAgent"),
    agent: z.literal("Codex"),
    arguments: taskConfigurationWorkerArguments,
    model: z
      .string()
      .refine((value) => value.length > 0 && value.length <= 128),
  }),
]);

function authoredWorkerConfiguration(
  value: unknown,
): WorkerConfiguration | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const mode = authoredWorkerMode(record["mode"]);
  const modePresent = Object.hasOwn(record, "mode");
  const legacyArguments = authoredTaskConfigurationStringArray(
    record["arguments"],
  );
  const fields = taskConfigurationParsed(taskConfigurationWorkerSchema, record);
  if (
    (modePresent && mode === undefined) ||
    (!modePresent && legacyArguments === undefined) ||
    (mode !== undefined && legacyArguments !== undefined) ||
    (legacyArguments?.length ?? 0) > workerEntriesMax ||
    fields === undefined
  )
    return undefined;
  return {
    ...(mode === undefined ? { arguments: legacyArguments ?? [] } : { mode }),
    ...fields,
  };
}

function authoredWorkerMode(value: unknown): WorkerMode | undefined {
  return taskConfigurationParsed(taskConfigurationWorkerModeSchema, value);
}

/** One parsed evaluation stage, or the fault that names why it is not one. */
type EvaluationBlockParsed =
  | { readonly parsed: "Block"; readonly block: EvaluationBlock }
  | { readonly parsed: "Refused"; readonly fault: TaskConfigurationFault };

/** Every parsed evaluation stage, or the first fault one of them earned. */
type EvaluationBlocksParsed =
  | { readonly parsed: "Blocks"; readonly blocks: readonly EvaluationBlock[] }
  | { readonly parsed: "Refused"; readonly fault: TaskConfigurationFault };

function authoredTaskConfigurationAgentEvaluationBlock(
  value: unknown,
): EvaluationBlockParsed {
  const block = taskConfigurationParsed(
    taskConfigurationAgentEvaluationSchema,
    value,
  );
  return block === undefined
    ? { parsed: "Refused", fault: "EvaluationsInvalid" }
    : { parsed: "Block", block };
}

/** Every field a commanded check entry is made of, so any other is refused rather than dropped. */
const commandEvaluationFields: readonly string[] = ["purpose", "checks"];

/**
 * One commanded check stage. A field this kind has no place for is refused,
 * because a stage runs shell under whatever narrowing it was given, and a
 * dropped narrowing is the one reading of an authored line nobody asked for.
 */
function authoredTaskConfigurationCommandEvaluationBlock(
  record: Record<string, unknown>,
): EvaluationBlockParsed {
  if (
    !Object.keys(record).every((key) => commandEvaluationFields.includes(key))
  )
    return { parsed: "Refused", fault: "EvaluationFieldUnknown" };
  const checks = authoredTaskConfigurationStringArray(record["checks"]);
  return checks === undefined ||
    checks.length === 0 ||
    checks.length > evaluationChecksMax
    ? { parsed: "Refused", fault: "ChecksInvalid" }
    : { parsed: "Block", block: { purpose: "Check", checks } };
}

/**
 * Whether an entry says which kind of stage it is. A check stage names its
 * commands or briefs an agent, and naming both or neither says neither.
 */
function authoredTaskConfigurationEvaluationKindFault(
  record: Record<string, unknown>,
): TaskConfigurationFault | undefined {
  const commanded = Object.hasOwn(record, "checks");
  const briefed =
    record["instructions"] !== undefined || record["practices"] !== undefined;
  if (commanded && (briefed || record["purpose"] !== "Check"))
    return "EvaluationKindAmbiguous";
  return record["purpose"] === "Check" && !commanded && !briefed
    ? "EvaluationKindAmbiguous"
    : undefined;
}

function authoredTaskConfigurationEvaluationBlock(
  value: unknown,
): EvaluationBlockParsed {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { parsed: "Refused", fault: "EvaluationsInvalid" };
  const record = value as Record<string, unknown>;
  const kindFault = authoredTaskConfigurationEvaluationKindFault(record);
  if (kindFault !== undefined) return { parsed: "Refused", fault: kindFault };
  return Object.hasOwn(record, "checks")
    ? authoredTaskConfigurationCommandEvaluationBlock(record)
    : authoredTaskConfigurationAgentEvaluationBlock(value);
}

function authoredTaskConfigurationEvaluationBlocks(
  value: unknown,
): EvaluationBlocksParsed {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > evaluationBlocksMax
  )
    return { parsed: "Refused", fault: "EvaluationsInvalid" };
  const blocks: EvaluationBlock[] = [];
  for (const entry of value) {
    const parsed = authoredTaskConfigurationEvaluationBlock(entry);
    if (parsed.parsed === "Refused") return parsed;
    blocks.push(parsed.block);
  }
  return { parsed: "Blocks", blocks };
}

function authoredTaskConfigurationValidated(
  input: Omit<AuthoredTaskConfiguration, "brief"> & TicketBrief,
): AuthoredTaskConfigurationReadiness {
  if (input.motivation.length === 0 && input.acceptanceCriteria.length === 0)
    return { readiness: "Incomplete", fault: "EmptyBrief" };
  const practicesFault = authoredTaskConfigurationPracticesFault(
    input.practices,
  );
  if (practicesFault !== undefined)
    return { readiness: "Incomplete", fault: practicesFault };
  for (const evaluation of input.evaluations ?? []) {
    if (evaluation.checks !== undefined) continue;
    const fault = authoredTaskConfigurationPracticesFault(evaluation.practices);
    if (fault !== undefined) return { readiness: "Incomplete", fault };
  }
  const textFault = taskConfigurationLinesFault([
    input.motivation,
    input.acceptanceCriteria,
    input.constraints,
    input.work.instructions,
    input.review.instructions,
    ...(input.evaluations ?? []).map((evaluation) =>
      evaluation.checks === undefined
        ? evaluation.instructions
        : evaluation.checks,
    ),
  ]);
  if (textFault !== undefined)
    return { readiness: "Incomplete", fault: textFault };
  const { motivation, acceptanceCriteria, constraints, ...configuration } =
    input;
  return {
    readiness: "Ready",
    configuration: {
      brief: { motivation, acceptanceCriteria, constraints },
      ...configuration,
    },
  };
}

function taskConfigurationLinesFault(
  lists: readonly (readonly string[])[],
): BriefingTextFault | undefined {
  for (const lines of lists) {
    if (lines.length > briefingLinesMax) return "TooManyLines";
    for (const line of lines) {
      const fault = taskConfigurationLineFault(line);
      if (fault !== undefined) return fault;
    }
  }
  return undefined;
}

function authoredTaskConfigurationPracticesFault(
  practices: readonly string[],
): TaskConfigurationFault | undefined {
  if (practices.length > allPracticeIds.length) return "TooManyLines";
  const seen = new Set<string>();
  for (const practice of practices) {
    if (seen.has(practice)) return "DuplicatePractice";
    seen.add(practice);
    if (!allPracticeIds.some((known) => known === practice))
      return "UnknownPractice";
  }
  return undefined;
}

const taskConfigurationSchema = taskConfigurationObject({
  ...taskConfigurationHeaderSchema.shape,
  evaluations: z
    .unknown()
    .transform((value, context) => {
      if (value === undefined) return undefined;
      const parsed = authoredTaskConfigurationEvaluationBlocks(value);
      if (parsed.parsed === "Blocks") return parsed.blocks;
      context.addIssue({ code: "custom", message: parsed.fault });
      return z.NEVER;
    })
    .optional(),
  authority: taskConfigurationAuthoritySchema.optional(),
  worker: z
    .unknown()
    .transform((value, context) => {
      if (value === undefined) return undefined;
      const worker = authoredWorkerConfiguration(value);
      if (worker !== undefined) return worker;
      context.addIssue({ code: "custom", message: "WorkerInvalid" });
      return z.NEVER;
    })
    .optional(),
});

function taskConfigurationFault(
  issue: z.core.$ZodIssue | undefined,
): TaskConfigurationFault {
  switch (issue?.path[0] ?? "") {
    case "evaluations":
      return (
        allTaskConfigurationFaults.find((fault) => fault === issue.message) ??
        "EvaluationsInvalid"
      );
    case "authority":
      return "AuthorityInvalid";
    case "worker":
      return "WorkerInvalid";
    default:
      return taskConfigurationHeaderFault(issue?.path ?? []);
  }
}

/** Parses the authored fields shared by every task a configuration revision briefs. */
export function authoredTaskConfigurationReadiness(
  value: unknown,
): AuthoredTaskConfigurationReadiness {
  const parsed = taskConfigurationSchema.safeParse(value);
  if (!parsed.success)
    return {
      readiness: "Incomplete",
      fault: taskConfigurationFault(parsed.error.issues[0]),
    };
  const { brief, ...configuration } = parsed.data;
  return authoredTaskConfigurationValidated({ ...brief, ...configuration });
}
