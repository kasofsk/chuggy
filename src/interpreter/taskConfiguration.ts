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

/** What one indexed evaluation stage is told beyond the shared brief. */
export interface EvaluationBlock extends PurposeBlock {
  readonly practices: readonly string[];
}

/** Runtime inputs whose canonical authored bytes travel with every task invocation. */
export interface WorkerConfiguration {
  readonly arguments: readonly string[];
  readonly setup: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly content: string;
  }[];
}

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
  | "AuthorityInvalid"
  | "WorkerInvalid"
  | "EmptyBrief"
  | "UnknownPractice"
  | "DuplicatePractice"
  | "EmptyLine"
  | "TextTooLong"
  | "TextUnreadable"
  | "TooManyLines";

/** A definitive fault while reading authored content, including unreadable canonical bytes. */
export type TaskConfigurationReadFault =
  TaskConfigurationFault | "ConfigurationUnreadable" | "DigestMismatch";

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
  const args = authoredTaskConfigurationStringArray(record["arguments"]);
  const setup = authoredTaskConfigurationStringArray(record["setup"]);
  const files = record["files"];
  if (
    args === undefined ||
    setup === undefined ||
    !Array.isArray(files) ||
    args.length > workerEntriesMax ||
    setup.length > workerEntriesMax ||
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
    arguments: args,
    setup,
    files: parsedFiles as WorkerConfiguration["files"],
  };
}

function authoredTaskConfigurationEvaluationBlock(
  value: unknown,
): EvaluationBlock | undefined {
  const block = authoredTaskConfigurationPurposeBlock(value);
  if (block === undefined || typeof value !== "object" || value === null)
    return undefined;
  const practices = authoredTaskConfigurationStringArray(
    (value as Record<string, unknown>)["practices"],
  );
  return practices === undefined ? undefined : { ...block, practices };
}

function authoredTaskConfigurationEvaluationBlocks(
  value: unknown,
): readonly EvaluationBlock[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > evaluationBlocksMax
  )
    return undefined;
  const blocks = value.map(authoredTaskConfigurationEvaluationBlock);
  return blocks.every((block) => block !== undefined) ? blocks : undefined;
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
    const fault = authoredTaskConfigurationPracticesFault(evaluation.practices);
    if (fault !== undefined) return { readiness: "Incomplete", fault };
  }
  const textFault = taskConfigurationLinesFault([
    input.motivation,
    input.acceptanceCriteria,
    input.constraints,
    input.work.instructions,
    input.review.instructions,
    ...(input.evaluations ?? []).map((evaluation) => evaluation.instructions),
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
  const evaluations =
    evaluationsValue === undefined
      ? undefined
      : authoredTaskConfigurationEvaluationBlocks(evaluationsValue);
  if (evaluationsValue !== undefined && evaluations === undefined)
    return { readiness: "Incomplete", fault: "EvaluationsInvalid" };
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
