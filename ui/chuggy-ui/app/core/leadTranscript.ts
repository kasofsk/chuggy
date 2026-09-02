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
 * A PAGE THAT CARRIES A COMPACTION REPLACES WHAT IS HELD RATHER THAN ADDING TO
 * IT. Entries below a boundary are exactly the ones the lead stopped holding,
 * so a union across pages would mark them held again; where no page has ever
 * carried a boundary nothing has been dropped and the union is what holds.
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
  readonly elided: number;
  readonly entriesDropped: number;
  readonly readTo: number | undefined;
  readonly failure: string | undefined;
}

export const leadTranscriptHeldEmpty: LeadTranscriptHeld = {
  stream: undefined,
  entries: [],
  holding: [],
  compaction: undefined,
  elided: 0,
  entriesDropped: 0,
  readTo: undefined,
  failure: undefined,
};

/**
 * The batch the next read asks after, and nothing at all where the store has
 * written no batch above the one this pane has read to.
 */
export function leadTranscriptNextAfter(
  held: LeadTranscriptHeld,
  highWaterBatch: number,
): number | undefined {
  if (held.readTo === undefined) return highWaterBatch > 0 ? 0 : undefined;
  return highWaterBatch > held.readTo ? held.readTo : undefined;
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

/** One page folded in, with the walk's cursor advanced to what it read to. */
export function leadTranscriptMerged(
  held: LeadTranscriptHeld,
  page: LeadTranscriptResponse,
  highWaterBatch: number,
): LeadTranscriptHeld {
  const merged = leadTranscriptEntriesMerged(held.entries, page.entries);
  const kept = merged.slice(-leadTranscriptEntriesHeldMax);
  return {
    stream: page.stream,
    entries: kept,
    holding:
      page.compaction === undefined
        ? [...new Set([...held.holding, ...page.held])]
        : [...page.held],
    compaction: page.compaction ?? held.compaction,
    elided: held.elided + page.elided,
    entriesDropped: held.entriesDropped + (merged.length - kept.length),
    readTo: page.nextAfter ?? highWaterBatch,
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
