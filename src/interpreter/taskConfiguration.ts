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

/** The authored part of a task configuration, before storage supplies its immutable pin. */
export interface AuthoredTaskConfiguration {
  readonly brief: TicketBrief;
  readonly practices: readonly string[];
  readonly work: PurposeBlock;
  readonly review: PurposeBlock;
  readonly authority?: AuthorityRequest;
}

/** The longest single briefing line, which is one criterion, constraint or instruction. */
export const briefingLineCharsMax = 512;

/** The most lines one authored list may carry. */
export const briefingLinesMax = 32;

/** Why an authored document cannot supply the briefing contract. */
export type TaskConfigurationFault =
  | "BriefingShapeMissing"
  | "EmptyLine"
  | "TextTooLong"
  | "TextUnreadable"
  | "TooManyLines";

/** A definitive fault while reading authored content, including unreadable canonical bytes. */
export type TaskConfigurationReadFault =
  TaskConfigurationFault | "ConfigurationUnreadable";

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

type BriefingTextFault = Exclude<
  TaskConfigurationFault,
  "BriefingShapeMissing"
>;

const briefingFirstPrintable = 0x20;
const briefingFirstUpperControl = 0x7f;
const briefingLastUpperControl = 0x9f;

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

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((line) => typeof line === "string")
    ? value
    : undefined;
}

function authorityRequest(value: unknown): AuthorityRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const tools = record["tools"];
  const credentials = record["credentials"];
  const filesystem = record["filesystem"];
  const parsedTools = tools === undefined ? undefined : stringArray(tools);
  const parsedCredentials =
    credentials === undefined ? undefined : stringArray(credentials);
  if (tools !== undefined && parsedTools === undefined) return undefined;
  if (credentials !== undefined && parsedCredentials === undefined)
    return undefined;
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

function purposeBlockFrom(value: unknown): PurposeBlock | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const instructions = stringArray(record["instructions"]);
  const authority = record["authority"];
  const parsedAuthority =
    authority === undefined ? undefined : authorityRequest(authority);
  if (instructions === undefined) return undefined;
  if (authority !== undefined && parsedAuthority === undefined)
    return undefined;
  return {
    instructions,
    ...(parsedAuthority === undefined ? {} : { authority: parsedAuthority }),
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
  const motivation = stringArray(brief["motivation"]);
  const acceptanceCriteria = stringArray(brief["acceptanceCriteria"]);
  const constraints = stringArray(brief["constraints"]);
  const practices = stringArray(record["practices"]);
  const work = purposeBlockFrom(record["work"]);
  const review = purposeBlockFrom(record["review"]);
  const authority = record["authority"];
  const parsedAuthority =
    authority === undefined ? undefined : authorityRequest(authority);
  if (
    motivation === undefined ||
    acceptanceCriteria === undefined ||
    constraints === undefined ||
    practices === undefined ||
    work === undefined ||
    review === undefined ||
    (authority !== undefined && parsedAuthority === undefined)
  )
    return { readiness: "Incomplete", fault: "BriefingShapeMissing" };
  const textFault = taskConfigurationLinesFault([
    motivation,
    acceptanceCriteria,
    constraints,
    work.instructions,
    review.instructions,
  ]);
  if (textFault !== undefined)
    return { readiness: "Incomplete", fault: textFault };
  return {
    readiness: "Ready",
    configuration: {
      brief: { motivation, acceptanceCriteria, constraints },
      practices,
      work,
      review,
      ...(parsedAuthority === undefined ? {} : { authority: parsedAuthority }),
    },
  };
}
