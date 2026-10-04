/**
 * The transcript is the spine and the mailbox is an overlay: a turn contributes
 * what the transcript cannot — a pending exchange nobody has claimed, the word a
 * failure ended on, the measures — and it finds its exchange by the input text
 * the worker handed the runtime verbatim.
 *
 * TWO TURNS THAT ASKED THE SAME THING ARE TOLD APART BY WHICH OF THEM STORED
 * THEIR ASK. The text alone cannot say which of them an exchange belongs to,
 * and a page that draws a turn as it is written would draw the newer one's
 * words under the older one's ask. The exchanges of one ask are stored in turn
 * order by the turns that stored it, so the question is only who those are.
 *
 * AN ANSWERED TURN STORED ITS ASK, AND SO DID ONE THAT ENDED ON A FAILURE ONLY
 * A RUN NAMES: its turns or its budget exhausted, or a rate limit, each read
 * off the result the runtime gave for the turn. Those are sure of an exchange
 * wherever the page holds one.
 *
 * A FAILURE A SESSION REPORTED ANY OTHER WAY IS NOT PROOF ITS ASK WAS STORED.
 * A session refuses a turn it cannot run — a checkout it cannot resolve, a
 * credential it is not granted — and reports it failed with nothing stored, in
 * the word a turn that ran and broke is reported in. Such a turn takes only
 * what the sure ones leave. A record that can be counted says what that is:
 * an exchange more than the sure turns before it need. In any other, it is an
 * exchange that does not read as the answer of the answered turn before it,
 * which would be that turn's. One left with no exchange is drawn as its ask
 * and its failure.
 *
 * A TURN THAT ENDED SAYING NOTHING OF ITSELF — its attempts lost, withdrawn,
 * its session closed — may never have had a runner. Such turns take nothing
 * unless a record that can be counted holds an exchange to spare for each of
 * them once every turn above could have one. A turn waiting behind another has
 * stored nothing for certain.
 *
 * A RECORD CAN BE COUNTED where the page holds it from its start and the
 * mailbox from its first turn: no entry cut from it, no exchange past the
 * bound, and no stream the thread wrote to before the one drawn.
 *
 * THE ONE TURN OUT THAT MAY HAVE STORED ITS ASK IS THE OLDEST, since turns are
 * taken in order and one at a time. An exchange the page held before the
 * mailbox listed that turn was stored before the turn was sent and is never
 * its own, and one holding a message heard under that turn always is. Past
 * those, a record that can be counted says: an exchange more than the turns
 * sure of one is a taken turn's, and a waiting turn's only where the turns
 * before it that may have stored cannot account for it. Where the count means
 * nothing the newest exchange is asked instead. A turn still waiting has taken
 * none, nor has any on a page that says the end of the record is still to be
 * read. After a turn that ran and failed, only an exchange nothing has been
 * written in is the taken turn's. After an answered turn, the exchange is the
 * taken turn's unless it reads as the answer that turn ended on.
 *
 * WHAT CANNOT BE TOLD APART GOES TO THE TURN THAT IS OUT. A turn its session
 * reported failed, the same ask taken again, one exchange holding words nobody
 * heard and nothing saying when it was stored: the words are the failed turn's
 * if it ran and the retry's if it was refused. The retry takes them. Where the
 * failed turn ran that is wrong until the retry's own ask is read, which is
 * the first thing a retry stores; the other way is wrong, where it was
 * refused, until something heard under the retry is stored or it settles.
 *
 * THE PAGE HOLDS THE NEWEST OF THEM, so the turns take from the newest
 * backwards: an older turn whose exchange has left the page takes none and
 * draws nothing. Only a record that can be counted and holds fewer exchanges
 * than turns sure of one is a record the page is behind on: it holds the
 * oldest instead, and there the turns take from the oldest forwards. The
 * newest exchange reading as the answer the newest of those turns ended on
 * says the page is not behind after all.
 *
 * A COUNT THAT CONTRADICTS WHAT IS DRAWN GIVES WAY TO IT IN ONE CASE: every
 * turn sure of an exchange has one by the count, the newest of them ended on
 * words, and the newest exchange ends on none. That exchange is not that
 * turn's, so it is given to the turn that is out.
 *
 * WHAT STAYS UNDECIDED IS DRAWN AS TWO EXCHANGES AND NEVER AS NONE. An
 * exchange no turn took stands as the transcript has it and a turn that took
 * none is appended with no work, so a wrong answer above is either that or
 * one turn's stored work under its neighbour's name, until a message heard
 * under the turn is stored or the turn settles.
 */

import { sessionTranscriptEntriesMax } from "../../../../src/contract/http.ts";
import { agentReportedTurnFailures } from "../../../../src/contract/rosters.ts";
import type {
  SessionTurnFailure,
  SessionTurnInputKind,
  SessionTurnState,
} from "../../../../src/contract/rosters.ts";
import {
  threadSeedingHeadings,
  threadTurnBoundaryHeading,
  threadTurnRecordedLastLine,
} from "../../../../src/contract/threadSeeding.ts";
import { runCountLabel } from "./runTotals.ts";
import { threadWakeDrawn } from "./threads.ts";

/** The most blocks one entry is read for. */
export const conversationBlocksMax = 256;

/** The most steps one exchange's work holds. */
export const conversationStepsMax = 200;

/** The most exchanges one surface draws, which is one page of entries: an
 * exchange opens at an entry, so a page cannot make more of them than it has. */
export const conversationExchangesMax = sessionTranscriptEntriesMax;

/**
 * One block of a message's content. `Other` carries a kind this module does not
 * read and `Capped` carries what the bound cut, so a block is never lost in
 * silence.
 */
export type ConversationBlock =
  | { readonly block: "Text"; readonly text: string }
  | { readonly block: "Thinking"; readonly text: string }
  | {
      readonly block: "ToolUse";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly block: "ToolResult";
      readonly toolUse: string;
      readonly text: string;
      readonly isError: boolean;
    }
  | { readonly block: "Other"; readonly kind: string }
  | { readonly block: "Capped"; readonly count: number };

/** The word a block whose own shape cannot be read is carried under. */
export const conversationBlockUnreadable = "Unreadable";

function conversationRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function conversationBlockText(
  block: Record<string, unknown>,
  field: string,
): string {
  const value = block[field];
  return typeof value === "string" ? value : "";
}

/** A tool result's characters, which the runtime writes either as the string
 * itself or as the text blocks of a nested content array, read no further than
 * the sibling block list is and never cut in silence. */
function conversationBlockResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const read = content.slice(0, conversationBlocksMax);
  const texts = read.flatMap((part) => {
    const text = conversationRecord(part)?.["text"];
    return typeof text === "string" ? [text] : [];
  });
  const cut = content.length - read.length;
  return cut === 0
    ? texts.join("\n")
    : [...texts, conversationCappedSentence("Result", cut)].join("\n");
}

function conversationBlockOf(value: unknown): ConversationBlock {
  const block = conversationRecord(value);
  const kind = block?.["type"];
  if (block === undefined || typeof kind !== "string")
    return { block: "Other", kind: conversationBlockUnreadable };
  switch (kind) {
    case "text":
      return { block: "Text", text: conversationBlockText(block, "text") };
    case "thinking":
      return {
        block: "Thinking",
        text: conversationBlockText(block, "thinking"),
      };
    case "tool_use":
      return {
        block: "ToolUse",
        id: conversationBlockText(block, "id"),
        name: conversationBlockText(block, "name"),
        input: block["input"],
      };
    case "tool_result":
      return {
        block: "ToolResult",
        toolUse: conversationBlockText(block, "tool_use_id"),
        text: conversationBlockResultText(block["content"]),
        isError: block["is_error"] === true,
      };
    default:
      return { block: "Other", kind };
  }
}

/** The blocks one message holds. A string content is one text block, which is
 * what a compaction summary and a re-seeded turn are written as. */
export function conversationBlocksOf(
  message: unknown,
): readonly ConversationBlock[] {
  const held = conversationRecord(message);
  if (held === undefined) return [];
  const content = held["content"];
  if (typeof content === "string") return [{ block: "Text", text: content }];
  if (!Array.isArray(content)) return [];
  const read = content.slice(0, conversationBlocksMax).map(conversationBlockOf);
  const cut = content.length - read.length;
  return cut === 0 ? read : [...read, { block: "Capped", count: cut }];
}

export const conversationRoles = ["User", "Assistant"] as const;

export type ConversationRole = (typeof conversationRoles)[number];

/** One transcript entry as a surface takes it. */
export interface ConversationEntry {
  readonly id: string;
  readonly role: ConversationRole;
  readonly at?: string;
  /** The model message this entry is a block of, where the store names one:
   * the entries of one message share it and arrive one block each, in the
   * message's own order. */
  readonly message?: string;
  readonly blocks: readonly ConversationBlock[];
}

/**
 * A fact about the record that is not part of the conversation. Each read maps
 * its own shortfalls onto these, so a page cannot quietly draw a partial
 * transcript as a whole one.
 */
export type ConversationMarker =
  | { readonly marker: "Compaction"; readonly at?: string }
  | { readonly marker: "Elision"; readonly bytes: number }
  | { readonly marker: "Capped"; readonly sentence: string }
  | { readonly marker: "Unreadable" }
  | { readonly marker: "Failure"; readonly reason: string }
  | { readonly marker: "Truncated" }
  | { readonly marker: "Dropped"; readonly count: number }
  | { readonly marker: "Unreached" }
  | { readonly marker: "Unlisted" }
  | { readonly marker: "NoStore" };

/** The sequence a page hands in, in the record's own order. */
export type ConversationItem =
  | { readonly item: "Entry"; readonly entry: ConversationEntry }
  | { readonly item: "Marker"; readonly marker: ConversationMarker };

/** One mailbox turn as the overlay reads it, derived by the page from whichever
 * of the two turn shapes its own read answers. */
export interface ConversationTurn {
  readonly turn: string;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly input?: string;
  readonly state: SessionTurnState;
  readonly failure?: SessionTurnFailure;
  /** The words an answered turn ended on, where the mailbox carries them. */
  readonly result?: string;
  readonly tokens?: number;
  readonly costMicros?: number;
  readonly durationMs?: number;
}

/** What opened an exchange. `Document` is a wake whose pointer cannot be read,
 * which is drawn as its kind rather than as the raw document. */
export type ConversationAsk =
  | {
      readonly ask: "Message";
      readonly text: string;
      /** The seeding block the server composed in front of a thread's first
       * message, where the input carried one. */
      readonly context?: string;
    }
  | { readonly ask: "Wake"; readonly wake: string; readonly resource: string }
  | { readonly ask: "Document"; readonly kind: SessionTurnInputKind }
  | { readonly ask: "Observation"; readonly text?: string }
  | { readonly ask: "Inquiry" };

/** One thing that happened between the ask and the answer. */
export type ConversationStep =
  | { readonly step: "Thinking"; readonly text: string }
  | { readonly step: "Text"; readonly text: string }
  | {
      readonly step: "ToolCall";
      readonly id: string;
      readonly name?: string;
      readonly input: unknown;
      readonly result?: { readonly text: string; readonly isError: boolean };
    }
  | { readonly step: "Other"; readonly kind: string };

/** What a running exchange's turn is doing: the mailbox's own state, or
 * `Waiting`, a queued turn no runner can take now, which is this console's word
 * and not the mailbox's. */
export type ConversationRunningState =
  Extract<SessionTurnState, "Queued" | "Claimed"> | "Waiting";

/** Where one exchange stands: `Open` is a transcript exchange with no answer
 * that no turn speaks for, a run still going; `Markers` carries only the
 * markers ahead of it, with no ask, work, answer or measures. */
export type ConversationStanding =
  | { readonly standing: "Answered" }
  | {
      readonly standing: "Running";
      readonly state: ConversationRunningState;
    }
  | { readonly standing: "Failed"; readonly failure?: SessionTurnFailure }
  | { readonly standing: "Abandoned" }
  | { readonly standing: "Open" }
  | { readonly standing: "Markers" };

export interface ConversationMeasures {
  readonly tokens?: number;
  readonly costMicros?: number;
  readonly durationMs?: number;
}

/**
 * What a running exchange is doing now, where a surface that follows its turns
 * as they are written knows: thinking, a tool under way, its text being
 * written, or `Whole` — a turn whose last message is written and which is
 * waiting on nothing but its own settling.
 */
export type ConversationActivity =
  | { readonly activity: "Thinking" }
  | { readonly activity: "ToolUse"; readonly name: string }
  | { readonly activity: "Writing" }
  | { readonly activity: "Whole" };

/** One ask, the work it took and the answer it ended on. */
export interface ConversationExchange {
  readonly id: string;
  /** The mailbox turn this exchange is, where one speaks for it. */
  readonly turn?: string;
  readonly ask?: ConversationAsk;
  readonly work: readonly ConversationStep[];
  readonly answer?: string;
  readonly standing: ConversationStanding;
  readonly activity?: ConversationActivity;
  readonly measures?: ConversationMeasures;
  readonly before: readonly ConversationMarker[];
  /** Set where the turn carries no input to find its work by, so nothing this
   * exchange holds can say whether the turn has begun. */
  readonly inputless?: true;
}

/** What the disclosure trigger is worded from, as counts rather than a
 * sentence: the component owns the words. */
export interface ConversationWorkSummary {
  readonly toolCalls: number;
  readonly texts: number;
  readonly thought: boolean;
}

export function conversationWorkSummary(
  work: readonly ConversationStep[],
): ConversationWorkSummary {
  return {
    toolCalls: work.filter((step) => step.step === "ToolCall").length,
    texts: work.filter((step) => step.step === "Text").length,
    thought: work.some((step) => step.step === "Thinking"),
  };
}

/** The most characters a tool call's one-line argument summary carries. The
 * whole of the arguments is one disclosure away, so this clips a summary rather
 * than truncating the record. */
export const conversationArgumentSummaryCharsMax = 80;

/**
 * The one line a tool call is recognised by: the first string its arguments
 * hold — a path, a pattern, a command — or their size where they hold none.
 */
export type ConversationArgument =
  | { readonly argument: "Text"; readonly text: string }
  | { readonly argument: "Size"; readonly chars: number }
  | { readonly argument: "None" };

/** Whatever a value serialises to, and nothing where it will not. */
export function conversationArgumentText(input: unknown): string {
  if (input === undefined) return "";
  try {
    return JSON.stringify(input, undefined, 2) ?? "";
  } catch {
    return "";
  }
}

export function conversationArgumentSummary(
  input: unknown,
): ConversationArgument {
  const first =
    typeof input === "string"
      ? input
      : Object.values(conversationRecord(input) ?? {}).find(
          (value) => typeof value === "string" && value.length > 0,
        );
  if (typeof first === "string" && first.length > 0)
    return {
      argument: "Text",
      text: first.slice(0, conversationArgumentSummaryCharsMax),
    };
  const text = conversationArgumentText(input);
  return text.length === 0
    ? { argument: "None" }
    : { argument: "Size", chars: text.length };
}

/** The words a call's argument summary is drawn in. */
export function conversationArgumentLine(
  argument: ConversationArgument,
): string {
  switch (argument.argument) {
    case "Text":
      return argument.text;
    case "Size":
      return `${runCountLabel(argument.chars)} chars`;
    case "None":
      return "";
  }
}

/** Whether a text is a machine envelope rather than a member's own words: a
 * JSON object, trimmed. A brace that opens prose and nothing else stays a
 * message. */
function conversationTextIsJsonObject(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

/**
 * Where one seeded input divides, as every reader of one divides it: after the
 * boundary heading, or after the inherited block's last line for a turn
 * recorded before that heading existed. Both markers are the contract's, which
 * is what lets migration 077 cut a title at the same place.
 */
function conversationSeedingSplit(
  text: string,
): { readonly ends: number; readonly said: number } | undefined {
  const boundary = `\n\n${threadTurnBoundaryHeading}\n\n`;
  const at = text.lastIndexOf(boundary);
  if (at >= 0) return { ends: at, said: at + boundary.length };
  const older = `${threadTurnRecordedLastLine}\n\n`;
  const was = text.lastIndexOf(older);
  if (was < 0) return undefined;
  return {
    ends: was + threadTurnRecordedLastLine.length,
    said: was + older.length,
  };
}

/**
 * The member's own words, and the seeding block the server put in front of them
 * where the input carries one. Both sides read the contract's constants, so
 * this is the writer's boundary read backwards rather than a guess at one, and
 * a text that carries neither of them is the member's whole message.
 */
export function conversationAskMessage(
  text: string,
): Extract<ConversationAsk, { readonly ask: "Message" | "Observation" }> {
  const opens = threadSeedingHeadings.some((heading) =>
    text.startsWith(heading),
  );
  const split = opens ? conversationSeedingSplit(text) : undefined;
  const said = split === undefined ? text : text.slice(split.said);
  if (conversationTextIsJsonObject(said))
    return { ask: "Observation", text: said };
  if (split === undefined) return { ask: "Message", text: said };
  return { ask: "Message", text: said, context: text.slice(0, split.ends) };
}

/** What a turn's own kind asks for, with or without the text: the one place
 * this is decided, so an appended turn nobody has spoken text for still draws
 * its kind's word rather than nothing. Only a message with no text has none. */
function conversationAskOf(
  kind: SessionTurnInputKind,
  text: string | undefined,
): ConversationAsk | undefined {
  switch (kind) {
    case "UserMessage":
      return text === undefined ? undefined : conversationAskMessage(text);
    case "Wake": {
      const wake = text === undefined ? undefined : threadWakeDrawn(text);
      return wake === undefined
        ? { ask: "Document", kind }
        : { ask: "Wake", wake: wake.wake, resource: wake.resource };
    }
    case "Observation":
      return { ask: "Observation" };
    case "Inquiry":
      return { ask: "Inquiry" };
  }
}

function conversationStandingOf(turn: ConversationTurn): ConversationStanding {
  switch (turn.state) {
    case "Queued":
    case "Claimed":
      return { standing: "Running", state: turn.state };
    case "Answered":
      return { standing: "Answered" };
    case "Failed":
      return turn.failure === undefined
        ? { standing: "Failed" }
        : { standing: "Failed", failure: turn.failure };
    case "Abandoned":
      return { standing: "Abandoned" };
  }
}

function conversationMeasuresOf(
  turn: ConversationTurn,
): ConversationMeasures | undefined {
  const measures: ConversationMeasures = {
    ...(turn.tokens === undefined ? {} : { tokens: turn.tokens }),
    ...(turn.costMicros === undefined ? {} : { costMicros: turn.costMicros }),
    ...(turn.durationMs === undefined ? {} : { durationMs: turn.durationMs }),
  };
  return Object.keys(measures).length === 0 ? undefined : measures;
}

/** What an assistant's blocks are folded into: the work, the answer, and what
 * the fold could not keep. */
interface ConversationSaid {
  readonly work: ConversationStep[];
  answer: string | undefined;
  readonly before: ConversationMarker[];
  stepsCut: number;
}

/** One exchange while it is still being built, which is the only place any of
 * this is mutable. */
interface ConversationBuilt extends ConversationSaid {
  readonly id: string;
  turn: string | undefined;
  askText: string | undefined;
  ask: ConversationAsk | undefined;
  standing: ConversationStanding;
  measures: ConversationMeasures | undefined;
  matched: boolean;
  /** Whether anything an assistant wrote is folded into it. */
  said: boolean;
  /** The model messages its stored entries are blocks of. */
  readonly messages: string[];
  inputless: boolean;
}

interface ConversationBuilder {
  readonly built: ConversationBuilt[];
  open: ConversationBuilt | undefined;
  pending: ConversationMarker[];
  exchangesCut: number;
  /** Whether a marker said entries the store holds are missing from the items. */
  partial: boolean;
  /** Whether a marker says the end of the record is still to be read. */
  behind: boolean;
}

/** The identity of the exchange that carries markers nothing follows. */
const conversationTrailingId = "trailing";

const conversationHeardNone: ReadonlySet<string> = new Set();

const conversationHeardUnderNone: ReadonlyMap<string, string> = new Map();

/** The ordinal of the newest turn the mailbox listed when a page first held
 * each exchange, by the entry that opened it. */
export type ConversationSeen = ReadonlyMap<string, number>;

export const conversationSeenNothing: ConversationSeen = new Map();

/** What a page knows of the record its items are read from that the items do
 * not say. */
export interface ConversationRecord {
  readonly seen: ConversationSeen;
  /** Whether the thread wrote to a stream before the one the items are read
   * from, whose exchanges they do not hold. */
  readonly replaced: boolean;
}

export const conversationRecordPlain: ConversationRecord = {
  seen: conversationSeenNothing,
  replaced: false,
};

/** The one sentence a cut is ever said in, wherever the cut happens. */
function conversationCappedSentence(noun: string, count: number): string {
  return `${noun} cut · ${String(count)}`;
}

function conversationCappedMarker(
  noun: string,
  count: number,
): ConversationMarker {
  return {
    marker: "Capped",
    sentence: conversationCappedSentence(noun, count),
  };
}

function conversationOpened(
  builder: ConversationBuilder,
  id: string,
  standing: ConversationStanding = { standing: "Open" },
): ConversationBuilt {
  const built: ConversationBuilt = {
    id,
    turn: undefined,
    askText: undefined,
    ask: undefined,
    work: [],
    answer: undefined,
    standing,
    measures: undefined,
    before: builder.pending,
    matched: false,
    stepsCut: 0,
    said: false,
    messages: [],
    inputless: false,
  };
  builder.pending = [];
  builder.built.push(built);
  while (builder.built.length > conversationExchangesMax) {
    builder.built.shift();
    builder.exchangesCut += 1;
  }
  builder.open = built;
  return built;
}

function conversationStepped(
  built: ConversationSaid,
  step: ConversationStep,
): void {
  if (built.work.length >= conversationStepsMax) {
    built.stepsCut += 1;
    return;
  }
  built.work.push(step);
}

/** A step arriving after a text demotes that text out of the answer: the answer
 * is the last text after the last piece of work, and never a text the agent
 * carried on past. */
function conversationWorked(
  built: ConversationSaid,
  step: ConversationStep,
): void {
  if (built.answer !== undefined) {
    conversationStepped(built, { step: "Text", text: built.answer });
    built.answer = undefined;
  }
  conversationStepped(built, step);
}

/** A result joins the call it names; a result whose call is not open stands as
 * a call of its own, unnamed, rather than vanishing. */
function conversationResulted(
  built: ConversationSaid,
  block: Extract<ConversationBlock, { block: "ToolResult" }>,
): void {
  const result = { text: block.text, isError: block.isError };
  const at = built.work.findIndex(
    (step) =>
      step.step === "ToolCall" &&
      step.id === block.toolUse &&
      step.result === undefined,
  );
  const call = at < 0 ? undefined : built.work[at];
  if (call === undefined || call.step !== "ToolCall") {
    conversationWorked(built, {
      step: "ToolCall",
      id: block.toolUse,
      input: undefined,
      result,
    });
    return;
  }
  built.work[at] = { ...call, result };
}

function conversationBlockWorked(
  built: ConversationSaid,
  block: ConversationBlock,
): void {
  switch (block.block) {
    case "Thinking":
      conversationWorked(built, { step: "Thinking", text: block.text });
      return;
    case "ToolUse":
      conversationWorked(built, {
        step: "ToolCall",
        id: block.id,
        name: block.name,
        input: block.input,
      });
      return;
    case "ToolResult":
      conversationResulted(built, block);
      return;
    case "Other":
      conversationWorked(built, { step: "Other", kind: block.kind });
      return;
    case "Capped":
      built.before.push(conversationCappedMarker("Blocks", block.count));
      return;
    case "Text":
      return;
  }
}

function conversationAnswered(built: ConversationSaid, text: string): void {
  if (text.length === 0) return;
  built.answer = built.answer === undefined ? text : `${built.answer}\n${text}`;
}

/** An assistant's blocks in the order it wrote them: a text is the answer
 * until something follows it, and everything else is work. */
function conversationAssistantSaid(
  built: ConversationSaid,
  blocks: readonly ConversationBlock[],
): void {
  for (const block of blocks) {
    if (block.block === "Text") conversationAnswered(built, block.text);
    else conversationBlockWorked(built, block);
  }
}

/** Whether an entry opens an exchange, which every entry does but one carrying
 * nothing except results of calls an open exchange already made. */
function conversationOpensExchange(
  blocks: readonly ConversationBlock[],
): boolean {
  return blocks.some(
    (block) => block.block !== "ToolResult" && block.block !== "Capped",
  );
}

/** Whether an entry opens an exchange where one is already open, which is
 * what puts every entry after it in that exchange and not the one before. */
export function conversationEntryOpens(entry: ConversationEntry): boolean {
  return entry.role === "User" && conversationOpensExchange(entry.blocks);
}

function conversationEntryAskText(
  blocks: readonly ConversationBlock[],
): string {
  return blocks
    .flatMap((block) =>
      block.block === "Text" && block.text.length > 0 ? [block.text] : [],
    )
    .join("\n");
}

function conversationUserEntry(
  builder: ConversationBuilder,
  entry: ConversationEntry,
): void {
  const opens = conversationEntryOpens(entry);
  const built =
    opens || builder.open === undefined
      ? conversationOpened(builder, entry.id)
      : builder.open;
  if (opens) {
    built.askText = conversationEntryAskText(entry.blocks);
    built.ask = conversationAskMessage(built.askText);
  }
  for (const block of entry.blocks) conversationBlockWorked(built, block);
}

function conversationAssistantEntry(
  builder: ConversationBuilder,
  entry: ConversationEntry,
): void {
  const built = builder.open ?? conversationOpened(builder, entry.id);
  built.said = true;
  if (entry.message !== undefined && built.messages.at(-1) !== entry.message)
    built.messages.push(entry.message);
  conversationAssistantSaid(built, entry.blocks);
}

/** The failures only a run of the turn ends on, each read off the result the
 * runtime gave for it. */
const conversationFailuresRan: ReadonlySet<SessionTurnFailure> =
  new Set<SessionTurnFailure>([
    "AgentRateLimited",
    "AgentTurnsExhausted",
    "AgentBudgetExhausted",
  ]);

const conversationFailuresReported: ReadonlySet<SessionTurnFailure> = new Set(
  agentReportedTurnFailures,
);

/** Whether a turn stored its ask for certain: it was answered, or it ended on
 * a failure only a run of it names. */
function conversationTurnStored(turn: ConversationTurn): boolean {
  if (turn.state === "Answered") return true;
  return (
    turn.state === "Failed" &&
    turn.failure !== undefined &&
    conversationFailuresRan.has(turn.failure)
  );
}

function conversationTurnOut(turn: ConversationTurn): boolean {
  return turn.state === "Queued" || turn.state === "Claimed";
}

/** Whether a turn's session reported it failed in a word that does not say it
 * ran, which a session refusing a turn reports it in too. A failed turn the
 * mailbox names no failure for is read as one of these. */
function conversationTurnReported(turn: ConversationTurn): boolean {
  if (turn.state !== "Failed" || conversationTurnStored(turn)) return false;
  return (
    turn.failure === undefined || conversationFailuresReported.has(turn.failure)
  );
}

/** Whether a turn ended with nothing saying a runner ever had it: its
 * attempts were lost, it was withdrawn, or its session closed under it. */
function conversationTurnLost(turn: ConversationTurn): boolean {
  return (
    !conversationTurnOut(turn) &&
    !conversationTurnStored(turn) &&
    !conversationTurnReported(turn)
  );
}

/** What the pairing of one ask's turns is decided against. */
interface ConversationPairing {
  /** Whether exchanges can be counted against turns, which the module's
   * header says when. */
  readonly whole: boolean;
  /** Whether the items say the end of the record is still to be read. */
  readonly behind: boolean;
  /** The oldest turn still out, the only one out that may have stored its ask. */
  readonly frontier: ConversationTurn | undefined;
  /** The turn each model message a page heard was heard under. */
  readonly heardUnder: ReadonlyMap<string, string>;
  readonly seen: ConversationSeen;
}

/** Whether an exchange reads as the answer a turn ended on. */
function conversationReadsAs(
  built: ConversationBuilt,
  turn: ConversationTurn,
): boolean {
  const result = turn.result?.trim() ?? "";
  return result.length > 0 && built.answer?.trim() === result;
}

/** Whether an exchange cannot be the one an answered turn stored: the turn
 * ended on words and the exchange ends on none. */
function conversationEndsShortOf(
  built: ConversationBuilt,
  turn: ConversationTurn,
): boolean {
  return (turn.result?.trim() ?? "").length > 0 && built.answer === undefined;
}

/** Whether the page held an exchange before the mailbox listed a turn, which
 * is an exchange stored before that turn was sent. */
function conversationSeenBefore(
  pairing: ConversationPairing,
  built: ConversationBuilt,
  turn: ConversationTurn,
): boolean {
  const listed = pairing.seen.get(built.id);
  return listed !== undefined && listed < turn.ordinal;
}

/**
 * Whether the newest exchange of an ask is the one the turn that is out
 * stored, where `unsure` turns before it may have stored one each. Each reason
 * asked here is one the module's header gives.
 */
function conversationFrontierStored(
  pairing: ConversationPairing,
  frontier: ConversationTurn,
  exchanges: readonly ConversationBuilt[],
  stored: readonly ConversationTurn[],
  unsure: number,
): boolean {
  const newest = exchanges.at(-1);
  if (newest === undefined) return false;
  const heard = newest.messages.some(
    (message) => pairing.heardUnder.get(message) === frontier.turn,
  );
  if (heard) return true;
  if (conversationSeenBefore(pairing, newest, frontier)) return false;
  const waiting = frontier.state === "Queued";
  const extra = exchanges.length - stored.length;
  if (pairing.whole && extra > 0) return !waiting || extra > unsure;
  if (pairing.behind || waiting) return false;
  const prior = stored.at(-1);
  if (prior === undefined) return true;
  if (prior.state !== "Answered") return !pairing.whole && !newest.said;
  return pairing.whole
    ? extra === 0 && conversationEndsShortOf(newest, prior)
    : !conversationReadsAs(newest, prior);
}

/** The turns of one ask that may take an exchange. */
interface ConversationAskTakers {
  /** Those that take one wherever the page holds one, oldest first. */
  readonly sure: readonly ConversationTurn[];
  /** Those a session reported failed, which take what the sure leave. */
  readonly reported: readonly ConversationTurn[];
  /** Whether the turn that is out is among the sure. */
  readonly mine: boolean;
}

/**
 * Who may take an exchange of one ask: the turns that stored it, the one that
 * is out where it did, and the lost ones before it where a record that can be
 * counted holds one to spare for each past every turn a session reported.
 */
function conversationAskTakers(
  pairing: ConversationPairing,
  asking: readonly ConversationTurn[],
  exchanges: readonly ConversationBuilt[],
): ConversationAskTakers {
  const stored = asking.filter(conversationTurnStored);
  const frontier = asking.find((turn) => turn === pairing.frontier);
  const earlier = asking.filter(
    (turn) => frontier === undefined || turn.ordinal < frontier.ordinal,
  );
  const reported = earlier.filter(conversationTurnReported);
  const lost = earlier.filter(conversationTurnLost);
  const mine =
    frontier !== undefined &&
    conversationFrontierStored(
      pairing,
      frontier,
      exchanges,
      stored,
      reported.length + lost.length,
    );
  const taking = mine ? [...stored, frontier] : stored;
  const spare = exchanges.length - taking.length - reported.length;
  const ran = pairing.whole && spare >= lost.length ? lost : [];
  const sure = asking.filter(
    (turn) => taking.includes(turn) || ran.includes(turn),
  );
  return { sure, reported, mine };
}

/** Whether a record that can be counted holds fewer exchanges of an ask than
 * turns sure of one because the page is behind on it. The newest exchange
 * reading as the newest of those turns' answer says it is not. */
function conversationAskBehind(
  pairing: ConversationPairing,
  takers: ConversationAskTakers,
  exchanges: readonly ConversationBuilt[],
): boolean {
  if (!pairing.whole || takers.mine) return false;
  if (exchanges.length >= takers.sure.length) return false;
  const newest = exchanges.at(-1);
  const last = takers.sure.at(-1);
  if (newest === undefined || last === undefined) return true;
  return !conversationReadsAs(newest, last);
}

/**
 * Whether a turn its session reported failed takes the exchange the walk has
 * come to, `left` being how many are still untaken. A record that can be
 * counted says by one being left over the sure turns before it, and any other
 * by the exchange not reading as the answer of the nearest of those.
 */
function conversationReportedTakes(
  pairing: ConversationPairing,
  turn: ConversationTurn,
  built: ConversationBuilt,
  left: number,
  sure: readonly ConversationTurn[],
): boolean {
  const older = sure.filter((held) => held.ordinal < turn.ordinal);
  if (pairing.whole) return left > older.length;
  const before = older.at(-1);
  return before === undefined || !conversationReadsAs(built, before);
}

/** The turns paired from the newest exchange backwards, each sure turn taking
 * the one the walk has come to and each reported one asked whether it does. */
function conversationAskNewest(
  pairing: ConversationPairing,
  takers: ConversationAskTakers,
  exchanges: readonly ConversationBuilt[],
): readonly ConversationTurn[] {
  const newestFirst = [...takers.sure, ...takers.reported].sort(
    (left, right) => right.ordinal - left.ordinal,
  );
  const taking: ConversationTurn[] = [];
  let at = exchanges.length - 1;
  for (const turn of newestFirst) {
    const built = exchanges[at];
    if (built === undefined) break;
    const takes =
      takers.sure.includes(turn) ||
      conversationReportedTakes(pairing, turn, built, at + 1, takers.sure);
    if (!takes) continue;
    conversationApplied(built, turn);
    taking.push(turn);
    at -= 1;
  }
  return taking;
}

/** The turns sure of an exchange paired from the oldest forwards, which is the
 * order a page behind on its record holds them in. */
function conversationAskOldest(
  sure: readonly ConversationTurn[],
  exchanges: readonly ConversationBuilt[],
): readonly ConversationTurn[] {
  const taking = sure.slice(0, exchanges.length);
  taking.forEach((turn, at) => {
    const built = exchanges[at];
    if (built !== undefined) conversationApplied(built, turn);
  });
  return taking;
}

/**
 * One ask's turns given the exchanges the page holds of it, and the turns that
 * took one. They take from the newest exchange backwards, and from the oldest
 * forwards only where the page is behind on a record that can be counted.
 */
function conversationAskPaired(
  pairing: ConversationPairing,
  asking: readonly ConversationTurn[],
  exchanges: readonly ConversationBuilt[],
): readonly ConversationTurn[] {
  const takers = conversationAskTakers(pairing, asking, exchanges);
  return conversationAskBehind(pairing, takers, exchanges)
    ? conversationAskOldest(takers.sure, exchanges)
    : conversationAskNewest(pairing, takers, exchanges);
}

/** The turns that carry an input, by that input, each group in the order the
 * turns were taken. */
function conversationTurnsAsking(
  ordered: readonly ConversationTurn[],
): ReadonlyMap<string, readonly ConversationTurn[]> {
  const asking = new Map<string, ConversationTurn[]>();
  for (const turn of ordered) {
    if (turn.input === undefined) continue;
    const same = asking.get(turn.input) ?? [];
    same.push(turn);
    asking.set(turn.input, same);
  }
  return asking;
}

function conversationApplied(
  built: ConversationBuilt,
  turn: ConversationTurn,
): void {
  built.matched = true;
  built.turn = turn.turn;
  built.standing = conversationStandingOf(turn);
  built.measures = conversationMeasuresOf(turn);
  if (built.askText !== undefined)
    built.ask = conversationAskOf(turn.inputKind, built.askText);
}

/** A turn the transcript does not hold, appended as an exchange with no work. */
function conversationAppended(
  builder: ConversationBuilder,
  turn: ConversationTurn,
): void {
  const built = conversationOpened(builder, turn.turn);
  built.matched = true;
  built.turn = turn.turn;
  built.standing = conversationStandingOf(turn);
  built.measures = conversationMeasuresOf(turn);
  built.askText = turn.input;
  built.ask = conversationAskOf(turn.inputKind, turn.input);
  built.inputless = turn.input === undefined;
}

/** What a page that follows its turns as they are written heard of them. */
interface ConversationHeard {
  /** The turns something heard is still to be drawn for. */
  readonly turns: ReadonlySet<string>;
  readonly under: ReadonlyMap<string, string>;
}

/**
 * The mailbox over the transcript: each turn paired with the exchange its
 * input opened, and each one left over appended in the order it was sent. An
 * answered turn is left out unless a page heard some of it being written — the
 * transcript is where its answer lives, and a page that has not read that far
 * says so with a marker.
 */
function conversationOverlaid(
  builder: ConversationBuilder,
  turns: readonly ConversationTurn[],
  heard: ConversationHeard,
  record: ConversationRecord,
): void {
  const ordered = [...turns].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const pairing: ConversationPairing = {
    whole:
      !builder.partial &&
      builder.exchangesCut === 0 &&
      !record.replaced &&
      ordered[0]?.ordinal === 1,
    behind: builder.behind,
    frontier: ordered.find(conversationTurnOut),
    heardUnder: heard.under,
    seen: record.seen,
  };
  const paired = new Set<string>();
  for (const [input, asking] of conversationTurnsAsking(ordered)) {
    const exchanges = builder.built.filter(
      (built) => !built.matched && built.askText === input,
    );
    for (const turn of conversationAskPaired(pairing, asking, exchanges))
      paired.add(turn.turn);
  }
  for (const turn of ordered) {
    if (paired.has(turn.turn)) continue;
    if (turn.state === "Answered" && !heard.turns.has(turn.turn)) continue;
    conversationAppended(builder, turn);
  }
}

/** What a marker says the items are short of: `Cut` is entries the store
 * holds missing from their start or from among them, and `Behind` is the end
 * of the record still to be read. */
function conversationMarkerShort(
  marker: ConversationMarker,
): "Cut" | "Behind" | undefined {
  switch (marker.marker) {
    case "Dropped":
    case "Truncated":
    case "Capped":
    case "Elision":
    case "Unreadable":
      return "Cut";
    case "Failure":
    case "Unreached":
      return "Behind";
    case "Compaction":
    case "Unlisted":
    case "NoStore":
      return undefined;
  }
}

function conversationItemBuilt(
  builder: ConversationBuilder,
  item: ConversationItem,
): void {
  if (item.item === "Entry") {
    if (item.entry.role === "User") conversationUserEntry(builder, item.entry);
    else conversationAssistantEntry(builder, item.entry);
    return;
  }
  builder.pending.push(item.marker);
  const short = conversationMarkerShort(item.marker);
  if (short === "Cut") builder.partial = true;
  if (short === "Behind") builder.behind = true;
}

function conversationDrawn(built: ConversationBuilt): ConversationExchange {
  const before =
    built.stepsCut === 0
      ? built.before
      : [...built.before, conversationCappedMarker("Steps", built.stepsCut)];
  return {
    id: built.id,
    ...(built.turn === undefined ? {} : { turn: built.turn }),
    ...(built.ask === undefined ? {} : { ask: built.ask }),
    work: built.work,
    ...(built.answer === undefined ? {} : { answer: built.answer }),
    standing: built.matched
      ? built.standing
      : built.standing.standing === "Markers"
        ? built.standing
        : built.answer === undefined
          ? { standing: "Open" }
          : { standing: "Answered" },
    ...(built.measures === undefined ? {} : { measures: built.measures }),
    before,
    ...(built.inputless ? { inputless: true as const } : {}),
  };
}

/**
 * The exchanges a surface draws: markers between entries land on the exchange
 * they precede. Markers with nothing after them land on the first exchange the
 * mailbox overlay appends, or open a trailing exchange of their own when the
 * overlay appends none, so a shortfall is never attributed to a conversation
 * it is not about.
 */
export function conversationExchanges(
  items: readonly ConversationItem[],
  turns?: readonly ConversationTurn[],
  heardTurns: ReadonlySet<string> = conversationHeardNone,
  heardUnder: ReadonlyMap<string, string> = conversationHeardUnderNone,
  record: ConversationRecord = conversationRecordPlain,
): readonly ConversationExchange[] {
  const builder: ConversationBuilder = {
    built: [],
    open: undefined,
    pending: [],
    exchangesCut: 0,
    partial: false,
    behind: false,
  };
  for (const item of items) conversationItemBuilt(builder, item);
  if (turns !== undefined)
    conversationOverlaid(
      builder,
      turns,
      { turns: heardTurns, under: heardUnder },
      record,
    );
  if (builder.pending.length > 0)
    conversationOpened(builder, conversationTrailingId, {
      standing: "Markers",
    });
  const first = builder.built[0];
  if (first !== undefined && builder.exchangesCut > 0)
    first.before.unshift(
      conversationCappedMarker("Exchanges", builder.exchangesCut),
    );
  return builder.built.map(conversationDrawn);
}

/**
 * What a page has seen once it holds these items under these turns: an
 * exchange it did not hold before is given the newest turn listed now, and one
 * it no longer holds is let go of. Nothing is added until `reached` — the walk
 * has nothing left to read — and what was seen is handed back itself where
 * nothing changed.
 */
export function conversationSeenWith(
  seen: ConversationSeen,
  items: readonly ConversationItem[],
  turns: readonly ConversationTurn[],
  reached: boolean,
): ConversationSeen {
  if (!reached) return seen;
  const opened = items
    .flatMap((item) =>
      item.item === "Entry" && conversationEntryOpens(item.entry)
        ? [item.entry.id]
        : [],
    )
    .slice(-conversationExchangesMax);
  if (opened.length === seen.size && opened.every((id) => seen.has(id)))
    return seen;
  const newest = turns.reduce((most, turn) => Math.max(most, turn.ordinal), 0);
  return new Map(opened.map((id) => [id, seen.get(id) ?? newest]));
}

/** An exchange while what its assistant said is being put back on it. */
type ConversationExchangeSaying = {
  -readonly [Field in keyof ConversationExchange]: ConversationExchange[Field];
};

/**
 * The exchange after more of its assistant's blocks, each read exactly as a
 * stored entry's is — which is what lets a page draw a block it heard before
 * the transcript held it and have the stored one change nothing. Steps past
 * the bound are left to the transcript's own fold to count.
 */
export function conversationExchangeContinued(
  exchange: ConversationExchange,
  blocks: readonly ConversationBlock[],
): ConversationExchange {
  if (blocks.length === 0) return exchange;
  const said: ConversationSaid = {
    work: [...exchange.work],
    answer: exchange.answer,
    before: [...exchange.before],
    stepsCut: 0,
  };
  conversationAssistantSaid(said, blocks);
  const saying: ConversationExchangeSaying = {
    ...exchange,
    work: said.work,
    before: said.before,
  };
  if (said.answer === undefined) delete saying.answer;
  else saying.answer = said.answer;
  return saying;
}

/** Whether an exchange's turn is read as begun: a step of its work, a word of
 * its answer or what it is heard to be doing has reached this page. A turn with
 * no input to find its work by is read as begun, since nothing drawn under it
 * could ever say so. */
export function conversationExchangeBegun(
  exchange: ConversationExchange,
): boolean {
  return (
    exchange.inputless === true ||
    exchange.work.length > 0 ||
    exchange.answer !== undefined ||
    exchange.activity !== undefined
  );
}

/**
 * The one thing on a conversation that moves while a turn is out: the engine
 * above the composer until a running turn has words, and from then that turn's
 * own exchange, whose text or whose line under it shows what is under way.
 */
export type ConversationIndicator =
  | { readonly indicator: "None" }
  | { readonly indicator: "Engine" }
  | { readonly indicator: "Exchange"; readonly id: string };

function conversationExchangeRunning(exchange: ConversationExchange): boolean {
  return exchange.standing.standing === "Running";
}

/**
 * Which one it is. `engine` is whether the surface draws an engine at all and
 * whether a send is still on its way; with none drawn the first turn out moves
 * in its place, so a page with no composer still shows that something is.
 */
export function conversationIndicator(
  exchanges: readonly ConversationExchange[],
  engine: { readonly drawn: boolean; readonly sending: boolean },
): ConversationIndicator {
  const running = exchanges.filter(conversationExchangeRunning);
  const said = running.find(
    (exchange) =>
      exchange.answer !== undefined || exchange.activity?.activity === "Whole",
  );
  if (said !== undefined) return { indicator: "Exchange", id: said.id };
  if (engine.drawn && (engine.sending || running.length > 0))
    return { indicator: "Engine" };
  const first = running[0];
  return first === undefined
    ? { indicator: "None" }
    : { indicator: "Exchange", id: first.id };
}

/** The exchanges with every queued turn read as waiting, for a surface whose
 * turns go to a runner that cannot take one now. */
export function conversationExchangesWaiting(
  exchanges: readonly ConversationExchange[],
): readonly ConversationExchange[] {
  return exchanges.map((exchange) =>
    exchange.standing.standing === "Running" &&
    exchange.standing.state === "Queued"
      ? { ...exchange, standing: { standing: "Running", state: "Waiting" } }
      : exchange,
  );
}
