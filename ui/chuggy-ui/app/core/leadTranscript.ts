/**
 * What the lead page draws, derived: the store's chain as a pane holds it, the
 * seam the last compaction cut at, the subset the lead still holds, and the one
 * line a decision or a refusal is read as.
 *
 * WHAT THE LEAD HOLDS IS A MARK ON ONE LIST AND NEVER A SECOND READ. The route
 * answers the chain and names which of its entries survive the last compaction,
 * so the Holding panel and the Log panel are two readings of one value and
 * cannot disagree about what the lead is working from.
 *
 * `held` IS A FACT ABOUT THE STREAM, ANSWERED PER PAGE. The route decides it
 * from the last compaction in the whole stream and names the entries of that
 * page the lead holds, which may be none of them. So two pages read under one
 * cut cannot contradict each other, and what a pane holds is their answers
 * gathered — nothing here guesses.
 *
 * A CUT THAT MOVES INVALIDATES EVERYTHING GATHERED UNDER THE OLD ONE. A pane
 * walks a stream that is being written and compacted beneath it, so answers it
 * gathered pages ago were decided against a cut that no longer exists. Keeping
 * them would leave the lead marked as holding entries it dropped, and would
 * draw them above the seam the same page moved. So a page naming a different
 * cut takes the pane back to the start of the stream, keeping only its own
 * answer.
 *
 * `held` ABSENT IS UNKNOWN AND NEVER EMPTY. It is absent only where the route
 * could not reach the stream's end to decide it, and it says so with
 * `truncated`. Drawing that as "nothing held" would tell a reader the lead has
 * forgotten everything at exactly the moment the server said it could not
 * tell.
 *
 * ENTRY TEXT IS TEXT. A compaction summary embeds a resume path that names
 * nothing durable, so no derivation here turns an entry into a reference and
 * nothing that draws one may make it look actionable.
 */

import { leadResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  AgenticRefusalResponse,
  LeadResponse,
  LeadTranscriptResponse,
  SelectorDecisionResponse,
} from "../../../../src/contract/responses.ts";

/** As much of the note the lead left its successor as the lead read carries. */
export type LeadHandoffNote = LeadResponse["handoffNote"];

/** The most reads one rise of the store's batch count may cost. */
export const leadTranscriptReadsMax = 8;

/** The most entries a pane keeps, past which the oldest leave. */
export const leadTranscriptEntriesHeldMax = 400;

export type LeadTranscriptEntry = LeadTranscriptResponse["entries"][number];

export type LeadTranscriptCompaction = LeadTranscriptResponse["compaction"];

/** What one pane holds of one lead's transcript, and how far it has read. */
export interface LeadTranscriptHeld {
  readonly stream: string | undefined;
  readonly entries: readonly LeadTranscriptEntry[];
  readonly holding: readonly string[];
  readonly compaction: LeadTranscriptCompaction;
  /** The batch the compaction the gathered answers were decided against fell
   * in, so a page answered under a different one can be told from one answered
   * under this. */
  readonly cut: number | undefined;
  readonly elided: number;
  readonly truncated: boolean;
  /**
   * Whether a page has answered no `held`, which is the route saying it could
   * not decide what the lead holds rather than that it holds nothing. It stands
   * until the cut moves, because a later page deciding for its own entries says
   * nothing about the page that could not.
   */
  readonly holdingUnknown: boolean;
  readonly entriesDropped: number;
  readonly readTo: number | undefined;
  /** Whether the last page said there may be more above the cursor it gave. */
  readonly more: boolean;
  readonly failure: string | undefined;
}

export const leadTranscriptHeldEmpty: LeadTranscriptHeld = {
  stream: undefined,
  entries: [],
  holding: [],
  compaction: undefined,
  cut: undefined,
  elided: 0,
  truncated: false,
  holdingUnknown: false,
  entriesDropped: 0,
  readTo: undefined,
  more: false,
  failure: undefined,
};

/**
 * The batch the next read asks after. `nextAfter` says a page filled its limit
 * and so only that there MAY be more, which is why a full page that ends the
 * store is followed by one empty page; past that the walk resumes only when the
 * store has been written above the cursor this pane has read to.
 */
export function leadTranscriptNextAfter(
  held: LeadTranscriptHeld,
  highWaterBatch: number,
): number | undefined {
  if (held.readTo === undefined) return highWaterBatch > 0 ? 0 : undefined;
  if (held.more) return held.readTo;
  return highWaterBatch > held.readTo ? held.readTo : undefined;
}

/**
 * Whether the walk asks again on the strength of the page's own cursor. Neither
 * a page with no entries nor one whose cursor did not move can have filled a
 * limit, so neither is asked past on that basis; the store growing above the
 * cursor is what reaches them, and the read budget is what bounds that.
 */
function leadTranscriptMore(
  held: LeadTranscriptHeld,
  page: LeadTranscriptResponse,
): boolean {
  const asked = held.readTo ?? 0;
  return (
    page.nextAfter !== undefined &&
    page.entries.length > 0 &&
    page.nextAfter > asked
  );
}

/** Each uuid once, in the order the chain gave it, oldest first. */
function leadTranscriptEntriesMerged(
  held: readonly LeadTranscriptEntry[],
  arriving: readonly LeadTranscriptEntry[],
): readonly LeadTranscriptEntry[] {
  const seen = new Set(
    held.flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid])),
  );
  const merged = [...held];
  for (const entry of arriving) {
    if (entry.uuid !== undefined && seen.has(entry.uuid)) continue;
    if (entry.uuid !== undefined) seen.add(entry.uuid);
    merged.push(entry);
  }
  return merged;
}

/**
 * The cursor the next read asks after: the one the page gave, and otherwise the
 * high-water mark the read was made against. THE CURSOR AND THE ENTRIES ARE
 * DIFFERENT QUESTIONS — a full page whose entries were all elided or all meta
 * draws nothing and still has batches above it, so a walk that jumped to the
 * high-water mark on an empty page would abandon the rest of the store.
 */
function leadTranscriptReadTo(
  page: LeadTranscriptResponse,
  highWaterBatch: number,
): number {
  return page.nextAfter ?? highWaterBatch;
}

/**
 * Whether a page's answers were decided against a different compaction from the
 * ones already gathered. A page that decided nothing says nothing about the cut,
 * and a first page has nothing to differ from; everything else — including a
 * stream compacted for the first time under an open pane, where the cut goes
 * from absent to a batch — is answers that cannot be gathered together.
 */
function leadTranscriptCutMoved(
  held: LeadTranscriptHeld,
  page: LeadTranscriptResponse,
): boolean {
  if (page.held === undefined) return false;
  return held.readTo !== undefined && page.cut !== held.cut;
}

/** The uuids still worth holding: what is gathered, less any whose entry has
 * left at the cap, so the set is bounded by the entries and not by the walk. */
function leadTranscriptHoldingPruned(
  holding: Iterable<string>,
  entries: readonly LeadTranscriptEntry[],
): readonly string[] {
  const present = new Set(
    entries.flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid])),
  );
  return [...new Set(holding)].filter((uuid) => present.has(uuid));
}

/** One page folded in, with the walk's cursor advanced to what it read to. */
export function leadTranscriptMerged(
  held: LeadTranscriptHeld,
  page: LeadTranscriptResponse,
  highWaterBatch: number,
): LeadTranscriptHeld {
  const moved = leadTranscriptCutMoved(held, page);
  const merged = leadTranscriptEntriesMerged(held.entries, page.entries);
  const kept = merged.slice(-leadTranscriptEntriesHeldMax);
  return {
    stream: page.stream,
    entries: kept,
    holding: leadTranscriptHoldingPruned(
      moved ? (page.held ?? []) : [...held.holding, ...(page.held ?? [])],
      kept,
    ),
    cut: page.held === undefined ? held.cut : page.cut,
    compaction: page.compaction ?? held.compaction,
    elided: held.elided + page.elided,
    truncated: held.truncated || page.truncated,
    holdingUnknown: moved
      ? page.held === undefined
      : held.holdingUnknown || page.held === undefined,
    entriesDropped: held.entriesDropped + (merged.length - kept.length),
    readTo: moved ? 0 : leadTranscriptReadTo(page, highWaterBatch),
    more: moved ? false : leadTranscriptMore(held, page),
    failure: undefined,
  };
}

/** A read that did not answer leaves what is held alone and says why. */
export function leadTranscriptFailed(
  held: LeadTranscriptHeld,
  reason: string,
): LeadTranscriptHeld {
  return { ...held, failure: reason };
}

/** One entry as the page draws it, with its place in the chain marked. */
export interface LeadTranscriptLine {
  readonly ordinal: number;
  readonly uuid: string | undefined;
  readonly type: string;
  readonly at: string | undefined;
  readonly text: string;
  readonly tools: readonly string[];
  readonly holding: boolean;
  readonly seam: boolean;
}

function leadEntryBlocks(message: unknown): readonly unknown[] {
  if (message === null || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>)["content"];
  return Array.isArray(content) ? content : [];
}

function leadEntryBlockKind(block: unknown): string | undefined {
  if (block === null || typeof block !== "object") return undefined;
  const kind = (block as Record<string, unknown>)["type"];
  return typeof kind === "string" ? kind : undefined;
}

/** The characters of an entry, which is its text blocks or the string itself. */
export function leadEntryText(message: unknown): string {
  if (message === null || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>)["content"];
  if (typeof content === "string") return content;
  return leadEntryBlocks(message)
    .flatMap((block) => {
      if (leadEntryBlockKind(block) !== "text") return [];
      const text = (block as Record<string, unknown>)["text"];
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

/** What an entry called for, named and never invoked from here. */
export function leadEntryTools(message: unknown): readonly string[] {
  return leadEntryBlocks(message).flatMap((block) => {
    if (leadEntryBlockKind(block) !== "tool_use") return [];
    const name = (block as Record<string, unknown>)["name"];
    return typeof name === "string" ? [name] : [];
  });
}

/** The whole chain this pane holds, oldest first, with the seam on its boundary. */
export function leadTranscriptLines(
  held: LeadTranscriptHeld,
): readonly LeadTranscriptLine[] {
  const holding = new Set(held.holding);
  const boundary = held.compaction?.boundary;
  return held.entries.map((entry, at) => ({
    ordinal: at + 1,
    uuid: entry.uuid,
    type: entry.type,
    at: entry.timestamp,
    text: leadEntryText(entry.message),
    tools: leadEntryTools(entry.message),
    holding: entry.uuid !== undefined && holding.has(entry.uuid),
    seam: entry.uuid !== undefined && entry.uuid === boundary,
  }));
}

/** The subset the lead is working from, which is a filter and not a fetch. */
export function leadTranscriptHolding(
  held: LeadTranscriptHeld,
): readonly LeadTranscriptLine[] {
  return leadTranscriptLines(held).filter((line) => line.holding);
}

/** The stream the transcript route defaults to, and how far its store has been written. */
export function leadStreamBatches(lead: LeadResponse): number {
  const named = lead.agentReference;
  if (named === undefined) return 0;
  return lead.streams.find((held) => held.stream === named)?.batches ?? 0;
}

/**
 * Whether the store's own listing carries the stream the session names. The
 * listing is bounded, so a lead with many streams can name one that is not on
 * it, and a reader shown an empty log would read that as a lead that has said
 * nothing.
 */
export function leadStreamListed(lead: LeadResponse): boolean {
  const named = lead.agentReference;
  if (named === undefined) return false;
  return lead.streams.some((held) => held.stream === named);
}

/**
 * A `Session` frame folded into the lead read. A frame naming another session
 * leaves the entry alone, because one project's page draws one lead.
 */
export function leadFolded(
  previous: LeadResponse | undefined,
  resource: string,
  representation: unknown,
): LeadResponse | undefined {
  if (previous === undefined) return previous;
  if (previous.session !== resource) return previous;
  if (representation === null) return previous;
  const read = leadResponseSchema.safeParse(representation);
  return read.success ? read.data : previous;
}

/**
 * The page a decision panel draws, highest ordinal first. The order is derived
 * from the ordinals rather than taken from the page's own arrangement, so a
 * route answering the log's other end cannot put a months-old decision at the
 * top of the panel and have it drawn as the one that just ran.
 */
export function leadDecisionsNewestFirst(
  decisions: readonly SelectorDecisionResponse[],
): readonly SelectorDecisionResponse[] {
  return [...decisions].sort((left, right) => right.ordinal - left.ordinal);
}

/** What one decision did, as the one line the log is scanned down. */
export function leadDecisionSummary(
  decision: SelectorDecisionResponse,
): string {
  const counts = [
    { count: decision.dispatched.length, noun: "dispatched" },
    { count: decision.refused.length, noun: "refused" },
    { count: decision.lifted.length, noun: "lifted" },
  ].flatMap((part) =>
    part.count === 0 ? [] : [`${String(part.count)} ${part.noun}`],
  );
  const said = [
    ...(decision.attention === undefined ? [] : [decision.attention]),
    ...counts,
  ];
  return said.length === 0 ? "None" : said.join(" · ");
}

/** Whether a refusal still binds, or the ticket has been authored again since. */
export const agenticRefusalStandings = ["Standing", "Superseded"] as const;

export type AgenticRefusalStanding = (typeof agenticRefusalStandings)[number];

export function agenticRefusalStanding(
  refusal: AgenticRefusalResponse,
): AgenticRefusalStanding {
  return refusal.superseded ? "Superseded" : "Standing";
}
