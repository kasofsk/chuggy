/**
 * The transcript is the spine and the mailbox is an overlay: a turn contributes
 * what the transcript cannot — a pending exchange nobody has claimed, the word a
 * failure ended on, the measures — and it finds its exchange by the input text
 * the worker handed the runtime verbatim, never by counting across two reads.
 */

import { sessionTranscriptEntriesMax } from "../../../../src/contract/http.ts";
import type {
  SessionTurnFailure,
  SessionTurnInputKind,
  SessionTurnState,
} from "../../../../src/contract/rosters.ts";
import {
  threadSeedingHeadings,
  threadSeedingLastLine,
} from "../../../../src/contract/threadSeeding.ts";
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
  | { readonly ask: "Observation" }
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

/** Where one exchange stands: `Open` is a transcript exchange with no answer
 * that no turn speaks for, a run still going; `Markers` carries only the
 * markers ahead of it, with no ask, work, answer or measures. */
export type ConversationStanding =
  | { readonly standing: "Answered" }
  | {
      readonly standing: "Running";
      readonly state: Extract<SessionTurnState, "Queued" | "Claimed">;
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

/** One ask, the work it took and the answer it ended on. */
export interface ConversationExchange {
  readonly id: string;
  readonly ask?: ConversationAsk;
  readonly work: readonly ConversationStep[];
  readonly answer?: string;
  readonly standing: ConversationStanding;
  readonly measures?: ConversationMeasures;
  readonly before: readonly ConversationMarker[];
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

/** What a turn's own kind asks for, with or without the text: the one place
 * this is decided, so an appended turn nobody has spoken text for still draws
 * its kind's word rather than nothing. Only a message with no text has none. */
/**
 * The member's own words, and the seeding block the server put in front of them
 * where the input carries one. Both sides read the contract's constants, so
 * this is the writer's boundary read backwards rather than a guess at one, and
 * a text that does not carry them is the member's whole message.
 */
export function conversationAskMessage(
  text: string,
): Extract<ConversationAsk, { readonly ask: "Message" }> {
  const opens = threadSeedingHeadings.some((heading) =>
    text.startsWith(heading),
  );
  const joined = `${threadSeedingLastLine}\n\n`;
  const at = opens ? text.lastIndexOf(joined) : -1;
  if (at < 0) return { ask: "Message", text };
  return {
    ask: "Message",
    text: text.slice(at + joined.length),
    context: text.slice(0, at + threadSeedingLastLine.length),
  };
}

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

/** One exchange while it is still being built, which is the only place any of
 * this is mutable. */
interface ConversationBuilt {
  readonly id: string;
  askText: string | undefined;
  ask: ConversationAsk | undefined;
  readonly work: ConversationStep[];
  answer: string | undefined;
  standing: ConversationStanding;
  measures: ConversationMeasures | undefined;
  readonly before: ConversationMarker[];
  matched: boolean;
  stepsCut: number;
}

interface ConversationBuilder {
  readonly built: ConversationBuilt[];
  open: ConversationBuilt | undefined;
  pending: ConversationMarker[];
  exchangesCut: number;
}

/** The identity of the exchange that carries markers nothing follows. */
const conversationTrailingId = "trailing";

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
    askText: undefined,
    ask: undefined,
    work: [],
    answer: undefined,
    standing,
    measures: undefined,
    before: builder.pending,
    matched: false,
    stepsCut: 0,
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
  built: ConversationBuilt,
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
  built: ConversationBuilt,
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
  built: ConversationBuilt,
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
  built: ConversationBuilt,
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

function conversationAnswered(built: ConversationBuilt, text: string): void {
  if (text.length === 0) return;
  built.answer = built.answer === undefined ? text : `${built.answer}\n${text}`;
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
  const opens = conversationOpensExchange(entry.blocks);
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
  for (const block of entry.blocks) {
    if (block.block === "Text") conversationAnswered(built, block.text);
    else conversationBlockWorked(built, block);
  }
}

/** The newest unmatched exchange whose ask is exactly this text. Turns are
 * matched newest first, so two identical inputs pair newest to newest. */
function conversationMatch(
  built: readonly ConversationBuilt[],
  input: string,
): ConversationBuilt | undefined {
  for (let at = built.length - 1; at >= 0; at -= 1) {
    const exchange = built[at];
    if (exchange === undefined || exchange.matched) continue;
    if (exchange.askText === input) return exchange;
  }
  return undefined;
}

function conversationApplied(
  built: ConversationBuilt,
  turn: ConversationTurn,
): void {
  built.matched = true;
  built.standing = conversationStandingOf(turn);
  built.measures = conversationMeasuresOf(turn);
  if (built.askText !== undefined)
    built.ask = conversationAskOf(turn.inputKind, built.askText);
}

/** A turn the transcript does not hold, appended as an exchange with no work.
 * An answered one is not appended: the transcript is where its answer lives,
 * and a page that has not read that far says so with a marker. */
function conversationAppended(
  builder: ConversationBuilder,
  turn: ConversationTurn,
): void {
  const built = conversationOpened(builder, turn.turn);
  built.matched = true;
  built.standing = conversationStandingOf(turn);
  built.measures = conversationMeasuresOf(turn);
  built.askText = turn.input;
  built.ask = conversationAskOf(turn.inputKind, turn.input);
}

function conversationOverlaid(
  builder: ConversationBuilder,
  turns: readonly ConversationTurn[],
): void {
  const ordered = [...turns].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const paired = new Set<string>();
  for (let at = ordered.length - 1; at >= 0; at -= 1) {
    const turn = ordered[at];
    if (turn?.input === undefined) continue;
    const built = conversationMatch(builder.built, turn.input);
    if (built === undefined) continue;
    conversationApplied(built, turn);
    paired.add(turn.turn);
  }
  for (const turn of ordered) {
    if (paired.has(turn.turn) || turn.state === "Answered") continue;
    conversationAppended(builder, turn);
  }
}

function conversationDrawn(built: ConversationBuilt): ConversationExchange {
  const before =
    built.stepsCut === 0
      ? built.before
      : [...built.before, conversationCappedMarker("Steps", built.stepsCut)];
  return {
    id: built.id,
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
): readonly ConversationExchange[] {
  const builder: ConversationBuilder = {
    built: [],
    open: undefined,
    pending: [],
    exchangesCut: 0,
  };
  for (const item of items) {
    if (item.item === "Marker") builder.pending.push(item.marker);
    else if (item.entry.role === "User")
      conversationUserEntry(builder, item.entry);
    else conversationAssistantEntry(builder, item.entry);
  }
  if (turns !== undefined) conversationOverlaid(builder, turns);
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
