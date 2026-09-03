/**
 * The vocabulary one member thread is held in: the roster it is opened with,
 * the notice a wake carries, the objectives it is recorded under, and the block
 * its first turn puts in front of the member's message. It is pure — nothing
 * here reaches a store, a clock or a route — and the two documents are text
 * because a turn's input is a column and not a payload.
 *
 * A THREAD ACTS AS ITS OWNER AND NEVER BESIDE THEM. The session row is the
 * grant: `agent_session.principal` is the owner's own principal, and the API
 * authorizes a thread's commands with the same membership row it authorizes the
 * owner's with. So a thread CANNOT EXCEED ITS OWNER — a member holding only
 * read access has a thread that reads and does nothing else, whatever roster it
 * carries, because the roster is enforced inside the pod and the membership is
 * enforced by the database. A ROSTER IS NOT A CONTROL, and saying so is the
 * point: the roster below is the weaker of the two, and a control described as
 * stronger than it is, is worse than none.
 *
 * A WAKE IS A NOTICE, NOT AN INSTRUCTION. A woken thread reports what happened
 * to its owner and stops. No roster can enforce that, because the same tools are
 * held on a message turn, so it is written the only two ways prose can be: the
 * system prompt states it, which is what a resumed session already holds, and
 * the wake document restates it, which is what the turn that could break the
 * rule carries. Neither of those is a control either. What is a control is that
 * everything a thread does is an operation row naming its author and the session
 * it came through, so a thread that originated work on a wake is visible in the
 * record afterwards.
 */

import {
  nativeHttpPathSegmentCharsMax,
  selectorSettingsTextCharsMax,
  threadMessageCharsMax,
  threadSeedingCharsMax,
  threadWakeCharsMax,
} from "../contract/http.ts";
import type { SessionCapability } from "./agentSession.ts";
import type { Partition } from "./projectStore.ts";

/**
 * The roster a thread is opened with when nothing has configured one, generous
 * because a thread exists to find out what is going on — reading the tree,
 * running things in it, and authoring the drafts its owner asks for. It is
 * generous against the pod alone, for the reason the header gives.
 */
export const threadCapabilitiesDefault = [
  "RepositoryRead",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
] as const satisfies readonly SessionCapability[];

/**
 * Why a thread was woken without its owner typing: a closed roster, so a wake
 * names a reason rather than carrying a payload.
 */
export const allThreadWakeReasons = [
  "TicketRefused",
  "RefusalLifted",
  "DraftDeleted",
  "TicketEscalated",
  "TicketCompleted",
  "TicketAbandoned",
] as const;
export type ThreadWakeReason = (typeof allThreadWakeReasons)[number];

/** The version every wake document this release writes carries. */
export const threadWakeVersion = 1;

/** What one wake turn's input says, and it says nothing else. */
export interface ThreadWakeDocument {
  readonly version: typeof threadWakeVersion;
  readonly wake: ThreadWakeReason;
  /** The ticket the event is about, as the change row named it. */
  readonly resource: string;
  readonly at: string;
  /** The standing rule, carried on the turn that could break it. */
  readonly standing: string;
}

/**
 * The sentence a woken thread is bound by. It is written once and read in both
 * places that must say it, so the rule written twice cannot become two rules.
 */
export const threadWakeStanding =
  "A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.";

/**
 * Which channel a thread's commands go through, written once for the same
 * reason. A project tool is a command its owner already has; the lead's
 * decisions are the lead's, and a thread neither makes nor amends one.
 */
export const threadChannelStanding =
  "You act through the same commands your owner has in the console, recorded as their act; the lead's decisions are the lead's, and you neither make nor amend one.";

/** One wake document, with the standing rule put on it rather than left to a caller. */
export function threadWakeDocument(input: {
  readonly wake: ThreadWakeReason;
  readonly resource: string;
  readonly at: string;
}): ThreadWakeDocument {
  if (input.resource.length === 0)
    throw new RangeError("wake document: the resource is empty");
  if (input.at.length === 0)
    throw new RangeError("wake document: the instant is empty");
  return {
    version: threadWakeVersion,
    wake: input.wake,
    resource: input.resource,
    at: input.at,
    standing: threadWakeStanding,
  };
}

/**
 * One wake document as the mailbox holds it. The bound is checked here rather
 * than by the row, so a document no roster member could have produced is
 * refused where it is composed instead of where it is stored.
 */
export function threadWakeText(document: ThreadWakeDocument): string {
  const text = JSON.stringify(document);
  if (text.length > threadWakeCharsMax)
    throw new RangeError(
      `a wake document must be at most ${String(threadWakeCharsMax)} characters`,
    );
  return text;
}

function wakeField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = fields[name];
  if (typeof value !== "string" || value.length === 0)
    throw new RangeError(`wake document: ${name} is not a value one carries`);
  return value;
}

/**
 * One wake document read back. It REFUSES RATHER THAN REPAIRS: a version this
 * release does not write, a reason outside the roster, a missing field or a
 * document larger than the column holds are each a document some other writer
 * produced, and a reader that filled in the difference would be inventing the
 * notice it was asked to deliver.
 */
export function parseThreadWake(text: string): ThreadWakeDocument {
  if (text.length > threadWakeCharsMax)
    throw new RangeError("wake document: larger than one is written at");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RangeError("wake document: not the JSON one is written as");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new RangeError("wake document: not an object");
  const fields = parsed as Readonly<Record<string, unknown>>;
  if (fields["version"] !== threadWakeVersion)
    throw new RangeError(
      "wake document: a version this release does not write",
    );
  const wake = wakeField(fields, "wake");
  if (!(allThreadWakeReasons as readonly string[]).includes(wake))
    throw new RangeError("wake document: a reason outside the roster");
  return {
    version: threadWakeVersion,
    wake: wake as ThreadWakeReason,
    resource: wakeField(fields, "resource"),
    at: wakeField(fields, "at"),
    standing: wakeField(fields, "standing"),
  };
}

/** What a thread is told about itself, beside the project's own North Star. */
function threadObjectives(
  tenant: string,
  project: string,
  owner: string,
  northStar: string | undefined,
): string {
  return [
    `# Whose thread this is

You are ${owner}'s thread on ${tenant}/${project}. Every
command you issue is recorded as their act, under their membership and through
this session, so you may do exactly what they may do and nothing further.`,
    ...(northStar === undefined ? [] : [`# North Star\n\n${northStar}`]),
    `# How you act on this project

- ${threadChannelStanding}
- ${threadWakeStanding}`,
  ].join("\n\n");
}

/** What this module contributes to a thread's objectives beyond the texts it is given. */
const threadObjectivesFixedChars = threadObjectives("", "", "", "").length;

/**
 * The longest set of objectives one thread's session row holds, derived from
 * its parts rather than named: the partition and the owner are each a wire
 * identity and the North Star is what the settings route already accepts, so a
 * ceiling below their sum would refuse a prompt no writer could have shortened.
 */
export const threadSystemPromptCharsMax =
  nativeHttpPathSegmentCharsMax * 3 +
  selectorSettingsTextCharsMax +
  threadObjectivesFixedChars;

/**
 * The thread's objectives as one recorded prefix, in the order that decides
 * what a reader takes first: whose thread this is, that its acts are its
 * owner's, that it may do only what its owner may, which channel it acts
 * through, and what a wake is.
 */
export function threadSystemPrompt(input: {
  readonly partition: Partition;
  readonly owner: string;
  readonly northStar?: string;
}): string {
  if (input.owner.length === 0)
    throw new RangeError("thread system prompt: the owner is empty");
  const prompt = threadObjectives(
    input.partition.tenant,
    input.partition.project,
    input.owner,
    input.northStar,
  );
  if (prompt.length > threadSystemPromptCharsMax)
    throw new RangeError(
      `a thread system prompt must be at most ${String(threadSystemPromptCharsMax)} characters`,
    );
  return prompt;
}

/** One draft of the member's the seeding names, as the drafts read reported it. */
export interface ThreadSeededDraft {
  readonly ticket: number;
  readonly summary: string;
}

/** One standing refusal against a draft of the member's. */
export interface ThreadSeededRefusal {
  readonly ticket: number;
  readonly reason: string;
}

/**
 * The block a thread's first turn carries in front of the member's message, and
 * that no later turn carries: what the project is aiming at, what the member
 * already has open, and what stands against it.
 */
export interface ThreadSeeding {
  readonly northStar?: string;
  readonly drafts: readonly ThreadSeededDraft[];
  readonly refusals: readonly ThreadSeededRefusal[];
}

/** The seeding block as the mailbox holds it, sections it has nothing for omitted. */
export function threadSeedingText(seeding: ThreadSeeding): string {
  return [
    ...(seeding.northStar === undefined
      ? []
      : [`# North Star\n\n${seeding.northStar}`]),
    ...(seeding.drafts.length === 0
      ? []
      : [
          `# Your open drafts\n\n${seeding.drafts
            .map(({ ticket, summary }) => `- ${String(ticket)} — ${summary}`)
            .join("\n")}`,
        ]),
    ...(seeding.refusals.length === 0
      ? []
      : [
          `# Standing against them\n\n${seeding.refusals
            .map(({ ticket, reason }) => `- ${String(ticket)} — ${reason}`)
            .join("\n")}`,
        ]),
    `# How you act on this project

- ${threadChannelStanding}
- ${threadWakeStanding}`,
  ].join("\n\n");
}

/** The most one turn's input weighs: the member's message and the block in front of it. */
export const threadTurnInputCharsMax =
  threadMessageCharsMax + threadSeedingCharsMax;

/**
 * The whole of one turn's input: the seeding block where the turn has one, then
 * the member's message, with the drafts shed oldest-first and then the refusals
 * until the two fit together. The North Star and the two standing rules are
 * never shed, because they are what the turn is bound by, and an input that
 * will not fit without shedding one of them is refused instead.
 */
export function threadTurnInput(
  message: string,
  seeding?: ThreadSeeding,
): string {
  if (seeding === undefined) {
    if (message.length > threadTurnInputCharsMax)
      throw new RangeError(
        `a thread turn's input must be at most ${String(threadTurnInputCharsMax)} characters`,
      );
    return message;
  }
  let drafts = seeding.drafts;
  let refusals = seeding.refusals;
  for (;;) {
    const input = `${threadSeedingText({ ...seeding, drafts, refusals })}\n\n${message}`;
    if (input.length <= threadTurnInputCharsMax) return input;
    if (drafts.length > 0) drafts = drafts.slice(1);
    else if (refusals.length > 0) refusals = refusals.slice(1);
    else
      throw new RangeError(
        `a thread turn's input must be at most ${String(threadTurnInputCharsMax)} characters`,
      );
  }
}
