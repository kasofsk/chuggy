/**
 * The vocabulary one inquiry against a lead is held in: the roster it is opened
 * with, the one document its single turn carries, and the objectives it is
 * recorded under. It is pure — nothing here reaches a store, a clock or a route
 * — and the document is text because a turn's input is a column and not a
 * payload.
 *
 * AN INQUIRY IS A FORK THAT READS AND IS THROWN AWAY. It resumes the lead's own
 * transcript so that a member can ask the lead about its own thinking, and it
 * holds a roster of reads alone. It acts as the member who asked rather than as
 * the lead, so every read it makes is one that member already had.
 *
 * A ROSTER IS NOT A CONTROL, for the reason `./leadTools.ts` gives: a roster is
 * enforced by the agent runtime inside the pod, and the pod is the thing being
 * controlled. What is a control is the membership the database authorizes each
 * read against, and — for the transcript — that the durable write door stays
 * bound to the bearer's own session while only the reads widen to the parent.
 * A control described as stronger than it is, is worse than none.
 *
 * IT LEAVES NO OPERATION ROW. `operation.via_session` records which session
 * issued a command, and this roster registers no tool that issues one. So the
 * whole record an inquiry leaves is its own session row — the asker's
 * principal, the lead as its parent — and its turn, which is where the question
 * and the answer live.
 *
 * THE STANDING RULE RIDES THE TURN AND NOT ONLY THE PROMPT. A fork inherits its
 * parent's conversation, and a pinned system prompt belongs to the conversation
 * rather than to the query that resumed it, so what a fork runs under may be the
 * lead's prompt whatever this module composes. The rule an inquiry is bound by
 * is therefore carried as a field of the turn's own input document: the turn
 * that could break the rule is the turn that restates it.
 */

import {
  inquiryQuestionCharsMax,
  nativeHttpPathSegmentCharsMax,
} from "../contract/http.ts";
import type { SessionCapability } from "./agentSession.ts";
import { sessionSystemPromptCharsMax } from "./leadTools.ts";

/**
 * What an inquiry may do, which is read the project and nothing else. There is
 * no `RepositoryRead`: a fork already holds everything the lead read, the
 * question is about the lead's own thinking, and a checkout per question is a
 * cost with no consequence — `sessionPlaceOne` is what stops the placement
 * carrying one.
 */
export const inquiryCapabilities = [
  "ProjectRead",
] as const satisfies readonly SessionCapability[];

/** The version every inquiry document this release writes carries. */
export const inquiryDocumentVersion = 1;

/** What one inquiry turn's input says, and it says nothing else. */
export interface InquiryDocument {
  readonly version: typeof inquiryDocumentVersion;
  /** What the member typed, bounded by `inquiryQuestionCharsMax`. */
  readonly question: string;
  /** Who asked, as the membership audits them. */
  readonly asker: string;
  /** The standing rule, carried on the turn that could break it. */
  readonly standing: string;
}

/**
 * The sentence an inquiry is bound by. It is written once and read in both
 * places that must say it, so the rule written twice cannot become two rules.
 */
export const inquiryStanding =
  "This is a question asked aside: nothing you say here reaches the lead's record, and no tool you hold writes.";

/**
 * What an inquiry is told beside the lead's own objectives: that it is a fork
 * opened for one question, and the rule it is bound by. It CONTAINS
 * `inquiryStanding` rather than restating it, so the prompt and the turn cannot
 * come to say different things.
 */
export const inquiryInstructions = `# Why this session exists

You are a fork of this project's lead, opened to answer one question a member
asked aside. Answer it from what the lead already holds, and stop.

${inquiryStanding}`;

/** One inquiry document, with the standing rule put on it rather than left to a caller. */
export function inquiryDocument(input: {
  readonly question: string;
  readonly asker: string;
}): InquiryDocument {
  if (input.question.length === 0)
    throw new RangeError("inquiry document: the question is empty");
  if (input.question.length > inquiryQuestionCharsMax)
    throw new RangeError(
      `an inquiry question must be at most ${String(inquiryQuestionCharsMax)} characters`,
    );
  if (input.asker.length === 0)
    throw new RangeError("inquiry document: the asker is empty");
  return {
    version: inquiryDocumentVersion,
    question: input.question,
    asker: input.asker,
    standing: inquiryStanding,
  };
}

/** What one character weighs once JSON has escaped it, which a control character does. */
const jsonEscapedCharChars = 6;

/** What the document's framing weighs beside the two texts a caller supplies. */
const inquiryDocumentFixedChars = JSON.stringify({
  version: inquiryDocumentVersion,
  question: "",
  asker: "",
  standing: inquiryStanding,
}).length;

/**
 * The most one inquiry document weighs as the mailbox holds it, DERIVED from
 * its parts rather than named: the framing and the standing sentence, then the
 * question and the asker with every character of each escaped as JSON escapes a
 * control character. A named ceiling would refuse a question the door had
 * already accepted, on every ask, long after the write that caused it.
 */
export const inquiryDocumentCharsMax =
  inquiryDocumentFixedChars +
  (inquiryQuestionCharsMax + nativeHttpPathSegmentCharsMax) *
    jsonEscapedCharChars;

/**
 * One inquiry document as the mailbox holds it. The bound is checked here
 * rather than by the row, so a document no door could have produced is refused
 * where it is composed instead of where it is stored.
 */
export function inquiryText(document: InquiryDocument): string {
  const text = JSON.stringify(document);
  if (text.length > inquiryDocumentCharsMax)
    throw new RangeError(
      `an inquiry document must be at most ${String(inquiryDocumentCharsMax)} characters`,
    );
  return text;
}

function inquiryField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = fields[name];
  if (typeof value !== "string" || value.length === 0)
    throw new RangeError(
      `inquiry document: ${name} is not a value one carries`,
    );
  return value;
}

/**
 * One inquiry document read back. It REFUSES RATHER THAN REPAIRS: a version
 * this release does not write, a question past the door's own bound, a missing
 * field, or a standing rule that is not the one this release binds an inquiry
 * by, are each a document some other writer produced — and a turn that carries
 * a different rule is a turn nobody wrote.
 */
export function parseInquiry(text: string): InquiryDocument {
  if (text.length > inquiryDocumentCharsMax)
    throw new RangeError("inquiry document: larger than one is written at");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RangeError("inquiry document: not the JSON one is written as");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new RangeError("inquiry document: not an object");
  const fields = parsed as Readonly<Record<string, unknown>>;
  if (fields["version"] !== inquiryDocumentVersion)
    throw new RangeError(
      "inquiry document: a version this release does not write",
    );
  const question = inquiryField(fields, "question");
  if (question.length > inquiryQuestionCharsMax)
    throw new RangeError("inquiry document: a question past the door's bound");
  const standing = inquiryField(fields, "standing");
  if (standing !== inquiryStanding)
    throw new RangeError("inquiry document: a standing rule nobody wrote");
  return {
    version: inquiryDocumentVersion,
    question,
    asker: inquiryField(fields, "asker"),
    standing,
  };
}

/** The objectives themselves, before the bound they are checked against is known. */
function inquiryObjectives(leadPrompt: string): string {
  return [leadPrompt, inquiryInstructions].join("\n\n");
}

/**
 * What this module contributes to an inquiry's objectives beyond the lead's
 * own. It is exported because `sessionPromptCeilings` names the room the shared
 * column leaves it and the contract cannot read this composition, so a case
 * holds the two together rather than either trusting the other.
 */
export const inquiryObjectivesFixedChars = inquiryObjectives("").length;

/**
 * The longest set of objectives one inquiry's session row holds, derived from
 * its parts rather than named: the lead's own prompt is bounded by what the
 * settings route already accepted, so a ceiling below that plus what this
 * module adds would refuse a fork of a lead the platform had already opened.
 */
export const inquirySystemPromptCharsMax =
  sessionSystemPromptCharsMax + inquiryObjectivesFixedChars;

/**
 * The inquiry's objectives as one recorded prefix: the lead's own objectives,
 * so the fork answers under what the lead was told, then what being a fork
 * means. The bound is checked here rather than by the row, so a prompt no lead
 * could have carried is refused where the fork's is composed.
 */
export function inquirySystemPrompt(leadPrompt: string): string {
  if (leadPrompt.length === 0)
    throw new RangeError("inquiry system prompt: the lead's prompt is empty");
  const prompt = inquiryObjectives(leadPrompt);
  if (prompt.length > inquirySystemPromptCharsMax)
    throw new RangeError(
      `an inquiry system prompt must be at most ${String(inquirySystemPromptCharsMax)} characters`,
    );
  return prompt;
}
