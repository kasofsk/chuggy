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
 * THE DRAFT IS THE THREAD'S WORK, AND THE TREE IS READ, NOT CHANGED. The
 * runtime a thread runs on presents it as a coding agent, in a checkout where
 * the project bound one, before its objectives are read, so the objectives
 * state the purpose before the rules: a request for a change is a request for
 * a draft, and the shell is for reading the tree well enough to draft against
 * it. No roster enforces that either — a shell writes — so it is prose,
 * written once, in one place.
 *
 * THE STANDING RULES ARE PROSE AND NOT A CONTROL. What a thread may do on a
 * wake is nothing a roster can enforce, because the same tools are held on a
 * message turn, so a project's standing rules are written the only two ways
 * prose can be: the system prompt states them, which is what a resumed session
 * already holds, and the wake document restates them, which is what the turn
 * that could break them carries. What IS a control is that everything a thread
 * does is an operation row naming its author and the session it came through,
 * so a thread that originated work on a wake is visible in the record
 * afterwards.
 */

import {
  nativeHttpPathSegmentCharsMax,
  selectorSettingsTextCharsMax,
  textCodePointsCount,
  threadMessageCharsMax,
  threadSeedingCharsMax,
  threadWakeCharsMax,
} from "../contract/http.ts";
import {
  resolvedThreadStanding,
  threadDraftsHeading,
  threadNorthStarHeading,
  threadRefusalsHeading,
  threadStandingSection,
  threadTurnBoundaryHeading,
} from "../contract/threadSeeding.ts";
import type { SessionCapability, SessionState } from "./agentSession.ts";
import type { Partition } from "./projectStore.ts";

/**
 * The roster a thread is opened with when nothing has configured one, generous
 * because a thread exists to find out what is going on — reading the tree,
 * running what it takes to read it, and authoring the drafts its owner asks
 * for. It is generous against the pod alone, for the reason the header gives.
 */
export const threadCapabilitiesDefault = [
  "RepositoryRead",
  "RunCommands",
  "ProjectRead",
  "DraftAuthor",
  "DraftOriginate",
] as const satisfies readonly SessionCapability[];

/**
 * Where one thread stands, as a listing names it: a session state, or that the
 * membership the thread acts under is gone. It is derived rather than stored,
 * from one fact on the session row and one on the membership join a listing
 * already makes, so the join is what discovers an ownerless thread.
 */
export const allThreadStandings = ["Open", "Closed", "Orphaned"] as const;
export type ThreadStanding = (typeof allThreadStandings)[number];

/**
 * An open thread whose owner has no membership left stands `Orphaned`, and
 * every other thread stands where its session does. A closed one is `Closed`
 * whatever became of its owner, because a session that takes no more turns
 * needs no owner and hiding that it is closed would be the wrong warning.
 */
export function threadStanding(input: {
  readonly state: SessionState;
  readonly owner?: string;
}): ThreadStanding {
  return input.state === "Open" && input.owner === undefined
    ? "Orphaned"
    : input.state;
}

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
  /** The standing rules, carried on the turn that could break them. */
  readonly standing: string;
}

/** One wake document, with the project's standing rules resolved onto it rather
 * than left to a caller. */
export function threadWakeDocument(input: {
  readonly wake: ThreadWakeReason;
  readonly resource: string;
  readonly at: string;
  /** The project's own standing rules, absent where it takes the default. */
  readonly standing?: string;
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
    standing: resolvedThreadStanding(input.standing),
  };
}

/**
 * One wake document as the mailbox holds it. The bound is checked here rather
 * than by the row, so a document no roster member could have produced is
 * refused where it is composed instead of where it is stored.
 */
export function threadWakeText(document: ThreadWakeDocument): string {
  const text = JSON.stringify(document);
  if (textCodePointsCount(text) > threadWakeCharsMax)
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
  if (textCodePointsCount(text) > threadWakeCharsMax)
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

/**
 * What a thread is for, written once because the runtime it runs on tells it
 * something else first: the preset it is opened with is a coding agent's, a
 * checkout where the project bound one is its working directory, and that
 * tree's own instructions load with it, so a request for a change reads as a
 * task unless the objectives say otherwise. They say the task is the draft,
 * and the checkout is what makes the draft accurate.
 */
export const threadPurposeStanding =
  "Your job is to turn what your owner asks for into tickets, and nothing else. A request for a change is a request for a draft: file it through the draft tools this session holds, one draft per piece of work small enough for one work attempt, with a brief that names the real files and an acceptance check that can be run, and release it unless your owner asked to see it first. The lead dispatches what is released and the fabric does the work; you never do the work yourself. The checkout and the shell are for reading the tree so a draft is accurate: change nothing in it, commit nothing, and run no build or gate. A question is answered from what you read. End every turn by saying what you filed, or why you filed nothing.";

/** What a thread is told about itself, beside the project's own North Star and
 * standing rules. */
function threadObjectives(
  tenant: string,
  project: string,
  owner: string,
  northStar: string | undefined,
  standing: string,
): string {
  return [
    `# Whose thread this is

You are ${owner}'s thread on ${tenant}/${project}. Every
command you issue is recorded as their act, under their membership and through
this session, so you may do exactly what they may do and nothing further.`,
    `# What you are for

${threadPurposeStanding}`,
    ...(northStar === undefined
      ? []
      : [`${threadNorthStarHeading}\n\n${northStar}`]),
    threadStandingSection(standing),
  ].join("\n\n");
}

/** What this module contributes to a thread's objectives beyond the texts it is given. */
const threadObjectivesFixedChars = threadObjectives("", "", "", "", "").length;

/**
 * The longest set of objectives one thread's session row holds, derived from
 * its parts rather than named: the partition and the owner are each a wire
 * identity, and the North Star and the standing rules are each what the
 * settings route already accepts, so a ceiling below their sum would refuse a
 * prompt no writer could have shortened.
 */
export const threadSystemPromptCharsMax =
  nativeHttpPathSegmentCharsMax * 3 +
  selectorSettingsTextCharsMax * 2 +
  threadObjectivesFixedChars;

/**
 * The thread's objectives as one recorded prefix, in the order that decides
 * what a reader takes first: whose thread this is, that its acts are its
 * owner's, that it may do only what its owner may, what it is for, the
 * project's North Star where there is one, and the standing rules it acts
 * under.
 */
export function threadSystemPrompt(input: {
  readonly partition: Partition;
  readonly owner: string;
  readonly northStar?: string;
  readonly standing: string;
}): string {
  if (input.owner.length === 0)
    throw new RangeError("thread system prompt: the owner is empty");
  const prompt = threadObjectives(
    input.partition.tenant,
    input.partition.project,
    input.owner,
    input.northStar,
    input.standing,
  );
  if (textCodePointsCount(prompt) > threadSystemPromptCharsMax)
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
 * The two texts a project binds its threads by, each absent where the project
 * has set none. They are read together because one thread composition needs
 * both, and narrow because a thread is not the lead: no prompt and no limit of
 * the lead's is reachable through them.
 */
export interface ThreadProjectTexts {
  readonly northStar?: string;
  readonly standing?: string;
}

/**
 * The block a thread's first turn carries in front of the member's message, and
 * that no later turn carries: what the project is aiming at, what the member
 * already has open, what stands against it, and the standing rules it acts
 * under, which are resolved before they get here.
 */
export interface ThreadSeeding {
  readonly northStar?: string;
  readonly standing: string;
  readonly drafts: readonly ThreadSeededDraft[];
  readonly refusals: readonly ThreadSeededRefusal[];
}

/** The seeding block as the mailbox holds it, sections it has nothing for omitted. */
export function threadSeedingText(seeding: ThreadSeeding): string {
  return [
    ...(seeding.northStar === undefined
      ? []
      : [`${threadNorthStarHeading}\n\n${seeding.northStar}`]),
    ...(seeding.drafts.length === 0
      ? []
      : [
          `${threadDraftsHeading}\n\n${seeding.drafts
            .map(({ ticket, summary }) => `- ${String(ticket)} — ${summary}`)
            .join("\n")}`,
        ]),
    ...(seeding.refusals.length === 0
      ? []
      : [
          `${threadRefusalsHeading}\n\n${seeding.refusals
            .map(({ ticket, reason }) => `- ${String(ticket)} — ${reason}`)
            .join("\n")}`,
        ]),
    threadStandingSection(seeding.standing),
  ].join("\n\n");
}

/** The most one turn's input weighs: the member's message and the block in front of it. */
export const threadTurnInputCharsMax =
  threadMessageCharsMax + threadSeedingCharsMax;

/**
 * The whole of one turn's input: the seeding block where the turn has one, the
 * boundary the console splits on, then the member's message, with the drafts
 * shed oldest-first and then the refusals until the two fit together. The North
 * Star and the standing rules are never shed, because they are what the turn is
 * bound by, and an input that will not fit without shedding one of them is
 * refused instead.
 */
export function threadTurnInput(
  message: string,
  seeding?: ThreadSeeding,
): string {
  if (seeding === undefined) {
    if (textCodePointsCount(message) > threadTurnInputCharsMax)
      throw new RangeError(
        `a thread turn's input must be at most ${String(threadTurnInputCharsMax)} characters`,
      );
    return message;
  }
  let drafts = seeding.drafts;
  let refusals = seeding.refusals;
  for (;;) {
    const input = `${threadSeedingText({ ...seeding, drafts, refusals })}\n\n${threadTurnBoundaryHeading}\n\n${message}`;
    if (textCodePointsCount(input) <= threadTurnInputCharsMax) return input;
    if (drafts.length > 0) drafts = drafts.slice(1);
    else if (refusals.length > 0) refusals = refusals.slice(1);
    else
      throw new RangeError(
        `a thread turn's input must be at most ${String(threadTurnInputCharsMax)} characters`,
      );
  }
}
