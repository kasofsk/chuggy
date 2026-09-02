/** The authored task-briefing contract shared by release and scheduling. */

import type { AuthorityRequest } from "./taskAuthority.ts";

/** The claim a ticket makes about itself, which both roles are briefed with unchanged. */
export interface TicketBrief {
  readonly motivation: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
}

/** What one role is told beyond the shared brief, and what its blocks ask to narrow. */
export interface PurposeBlock {
  readonly instructions: readonly string[];
  readonly authority?: AuthorityRequest;
}

/** What one indexed evaluation stage briefs an agent with, beyond the shared brief. */
export interface AgentEvaluationBlock extends PurposeBlock {
  readonly practices: readonly string[];
  readonly purpose: "Review" | "Check";
  readonly checks?: undefined;
}

/** One check stage the worker runs itself: command lines, and no agent to brief. */
export interface CommandEvaluationBlock {
  readonly purpose: "Check";
  readonly checks: readonly string[];
  readonly instructions?: undefined;
  readonly authority?: undefined;
}

/** One indexed evaluation stage, which is one of the two kinds a stage may be. */
export type EvaluationBlock = AgentEvaluationBlock | CommandEvaluationBlock;

interface SingleClaudeWorkerMode {
  readonly type: "SingleAgent";
  readonly agent: "Claude";
  readonly arguments: readonly string[];
}

interface SingleCodexWorkerMode {
  readonly type: "SingleAgent";
  readonly agent: "Codex";
  readonly model: string;
  readonly arguments: readonly string[];
}

/** One agent invocation, the only worker execution mode currently admitted. */
export type SingleAgentWorkerMode =
  SingleClaudeWorkerMode | SingleCodexWorkerMode;

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
export interface ModeWorkerConfiguration {
  readonly mode: WorkerMode;
  readonly setup: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly content: string;
  }[];
}

/** The worker shape retained by immutable configurations that predate modes. */
export interface LegacyClaudeWorkerConfiguration {
  readonly arguments: readonly string[];
  readonly setup: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly content: string;
  }[];
}

export type WorkerConfiguration =
  ModeWorkerConfiguration | LegacyClaudeWorkerConfiguration;

/** The authored part of a task configuration, before storage supplies its immutable pin. */
export interface AuthoredTaskConfiguration {
  readonly brief: TicketBrief;
  readonly practices: readonly string[];
  readonly work: PurposeBlock;
  readonly review: PurposeBlock;
  readonly evaluations?: readonly EvaluationBlock[];
  readonly authority?: AuthorityRequest;
  readonly worker?: WorkerConfiguration;
}

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
  if (line.length > briefingLineCharsMax) return "TextTooLong";
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

function authoredTaskConfigurationAuthorityRequest(
  value: unknown,
): AuthorityRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const tools = record["tools"];
  const credentials = record["credentials"];
  const filesystem = record["filesystem"];
  const parsedTools =
    tools === undefined
      ? undefined
      : authoredTaskConfigurationStringArray(tools);
  const parsedCredentials =
    credentials === undefined
      ? undefined
      : authoredTaskConfigurationStringArray(credentials);
  if (tools !== undefined && parsedTools === undefined) return undefined;
  if (credentials !== undefined && parsedCredentials === undefined)
    return undefined;
  if (
    (parsedTools !== undefined && parsedTools.length > briefingLinesMax) ||
    (parsedCredentials !== undefined &&
      parsedCredentials.length > briefingLinesMax)
  )
    return undefined;
  for (const name of [...(parsedTools ?? []), ...(parsedCredentials ?? [])]) {
    if (taskConfigurationLineFault(name) !== undefined) return undefined;
  }
  if (record["network"] !== undefined && typeof record["network"] !== "boolean")
    return undefined;
  if (
    filesystem !== undefined &&
    filesystem !== "None" &&
    filesystem !== "ReadWorkspace" &&
    filesystem !== "WriteWorkspace"
  )
    return undefined;
  if (
    record["mayCompleteTask"] !== undefined &&
    typeof record["mayCompleteTask"] !== "boolean"
  )
    return undefined;
  return {
    ...(parsedTools === undefined ? {} : { tools: parsedTools }),
    ...(parsedCredentials === undefined
      ? {}
      : { credentials: parsedCredentials }),
    ...(record["network"] === undefined ? {} : { network: record["network"] }),
    ...(filesystem === undefined ? {} : { filesystem }),
    ...(record["mayCompleteTask"] === undefined
      ? {}
      : { mayCompleteTask: record["mayCompleteTask"] }),
  };
}

function authoredTaskConfigurationPurposeBlock(
  value: unknown,
): PurposeBlock | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const instructions = authoredTaskConfigurationStringArray(
    record["instructions"],
  );
  const authority = record["authority"];
  const parsedAuthority =
    authority === undefined
      ? undefined
      : authoredTaskConfigurationAuthorityRequest(authority);
  if (instructions === undefined) return undefined;
  if (authority !== undefined && parsedAuthority === undefined)
    return undefined;
  return {
    instructions,
    ...(parsedAuthority === undefined ? {} : { authority: parsedAuthority }),
  };
}

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
  const setup = authoredTaskConfigurationStringArray(record["setup"]);
  const files = record["files"];
  if (
    (modePresent && mode === undefined) ||
    (!modePresent && legacyArguments === undefined) ||
    (mode !== undefined && legacyArguments !== undefined) ||
    setup === undefined ||
    !Array.isArray(files) ||
    setup.length > workerEntriesMax ||
    (legacyArguments?.length ?? 0) > workerEntriesMax ||
    files.length > workerEntriesMax
  )
    return undefined;
  const parsedFiles = files.map((file) => {
    if (typeof file !== "object" || file === null || Array.isArray(file))
      return undefined;
    const fields = file as Record<string, unknown>;
    return typeof fields["path"] === "string" &&
      typeof fields["content"] === "string" &&
      fields["content"].length <= workerContentCharsMax
      ? { path: fields["path"], content: fields["content"] }
      : undefined;
  });
  if (parsedFiles.some((file) => file === undefined)) return undefined;
  return {
    ...(mode === undefined ? { arguments: legacyArguments ?? [] } : { mode }),
    setup,
    files: parsedFiles as WorkerConfiguration["files"],
  };
}

function authoredWorkerMode(value: unknown): WorkerMode | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (record["type"] !== "SingleAgent") return undefined;
  const agent = record["agent"];
  const model = record["model"];
  const args = authoredTaskConfigurationStringArray(record["arguments"]);
  if (
    (agent !== "Claude" && agent !== "Codex") ||
    (agent === "Claude" && model !== undefined) ||
    (agent === "Codex" &&
      (typeof model !== "string" ||
        model.length === 0 ||
        model.length > 128)) ||
    args === undefined ||
    args.length > workerEntriesMax
  )
    return undefined;
  return agent === "Claude"
    ? { type: "SingleAgent", agent, arguments: args }
    : { type: "SingleAgent", agent, model: model as string, arguments: args };
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
  const block = authoredTaskConfigurationPurposeBlock(value);
  if (block === undefined || typeof value !== "object" || value === null)
    return { parsed: "Refused", fault: "EvaluationsInvalid" };
  const practices = authoredTaskConfigurationStringArray(
    (value as Record<string, unknown>)["practices"],
  );
  const purpose = (value as Record<string, unknown>)["purpose"];
  if (purpose !== undefined && purpose !== "Review" && purpose !== "Check")
    return { parsed: "Refused", fault: "EvaluationsInvalid" };
  return practices === undefined
    ? { parsed: "Refused", fault: "EvaluationsInvalid" }
    : {
        parsed: "Block",
        block: { ...block, practices, purpose: purpose ?? "Review" },
      };
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

function authoredTaskConfigurationValidated(input: {
  readonly motivation: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly practices: readonly string[];
  readonly work: PurposeBlock;
  readonly review: PurposeBlock;
  readonly evaluations?: readonly EvaluationBlock[];
  readonly authority?: AuthorityRequest;
  readonly worker?: WorkerConfiguration;
}): AuthoredTaskConfigurationReadiness {
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
  return {
    readiness: "Ready",
    configuration: {
      brief: {
        motivation: input.motivation,
        acceptanceCriteria: input.acceptanceCriteria,
        constraints: input.constraints,
      },
      practices: input.practices,
      work: input.work,
      review: input.review,
      ...(input.evaluations === undefined
        ? {}
        : { evaluations: input.evaluations }),
      ...(input.authority === undefined ? {} : { authority: input.authority }),
      ...(input.worker === undefined ? {} : { worker: input.worker }),
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

/** Parses the authored fields shared by every task a configuration revision briefs. */
export function authoredTaskConfigurationReadiness(
  value: unknown,
): AuthoredTaskConfigurationReadiness {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { readiness: "Incomplete", fault: "BriefingShapeMissing" };
  const record = value as Record<string, unknown>;
  const briefValue = record["brief"];
  if (
    typeof briefValue !== "object" ||
    briefValue === null ||
    Array.isArray(briefValue)
  )
    return { readiness: "Incomplete", fault: "BriefingShapeMissing" };
  const brief = briefValue as Record<string, unknown>;
  const motivation = authoredTaskConfigurationStringArray(brief["motivation"]);
  if (motivation === undefined)
    return { readiness: "Incomplete", fault: "MotivationInvalid" };
  const acceptanceCriteria = authoredTaskConfigurationStringArray(
    brief["acceptanceCriteria"],
  );
  if (acceptanceCriteria === undefined)
    return { readiness: "Incomplete", fault: "AcceptanceCriteriaInvalid" };
  const constraints = authoredTaskConfigurationStringArray(
    brief["constraints"],
  );
  if (constraints === undefined)
    return { readiness: "Incomplete", fault: "ConstraintsInvalid" };
  const practices = authoredTaskConfigurationStringArray(record["practices"]);
  if (practices === undefined)
    return { readiness: "Incomplete", fault: "PracticesInvalid" };
  const work = authoredTaskConfigurationPurposeBlock(record["work"]);
  if (work === undefined)
    return { readiness: "Incomplete", fault: "WorkInvalid" };
  const review = authoredTaskConfigurationPurposeBlock(record["review"]);
  if (review === undefined)
    return { readiness: "Incomplete", fault: "ReviewInvalid" };
  const evaluationsValue = record["evaluations"];
  const parsedEvaluations =
    evaluationsValue === undefined
      ? undefined
      : authoredTaskConfigurationEvaluationBlocks(evaluationsValue);
  if (parsedEvaluations?.parsed === "Refused")
    return { readiness: "Incomplete", fault: parsedEvaluations.fault };
  const evaluations = parsedEvaluations?.blocks;
  const authority = record["authority"];
  const parsedAuthority =
    authority === undefined
      ? undefined
      : authoredTaskConfigurationAuthorityRequest(authority);
  if (authority !== undefined && parsedAuthority === undefined)
    return { readiness: "Incomplete", fault: "AuthorityInvalid" };
  const workerValue = record["worker"];
  const worker =
    workerValue === undefined
      ? undefined
      : authoredWorkerConfiguration(workerValue);
  if (workerValue !== undefined && worker === undefined)
    return { readiness: "Incomplete", fault: "WorkerInvalid" };
  return authoredTaskConfigurationValidated({
    motivation,
    acceptanceCriteria,
    constraints,
    practices,
    work,
    review,
    ...(evaluations === undefined ? {} : { evaluations }),
    ...(parsedAuthority === undefined ? {} : { authority: parsedAuthority }),
    ...(worker === undefined ? {} : { worker }),
  });
}
