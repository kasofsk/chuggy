/**
 * A session's stored transcript, read the way the agent runtime itself reads
 * it: entries linked by `parentUuid`, and the compaction boundary that says
 * which of them the context still holds.
 *
 * THE WALK IS OURS RATHER THAN THE SDK'S. `getSessionMessages` answers the same
 * chain, but it lives in a package whose optional platform dependency is the
 * Claude Code CLI, and an API image carrying a CLI to avoid a chain walk is the
 * wrong trade. The suite proves this walk against a real store's bytes under
 * `test/fixtures/sessionStore/` rather than against a hand-written shape.
 *
 * ONLY THE DISK SHAPE IS PARSED. The store holds `compactMetadata` and
 * `preservedMessages`; the same facts on the runtime's message stream are
 * spelled `compact_metadata` and `preserved_messages`, and nothing in the
 * control plane ever sees that stream. A parser that accepted both would be
 * claiming a source this tree has no reader for.
 *
 * A LEAF IS THE LAST ENTRY APPENDED. The store is append-only, so the newest
 * uuid-bearing entry is the tip of the chain that is still being written.
 *
 * TWO LIVE BRANCHES SURVIVE A COMPACTION and both are walked. A compaction's
 * summary hangs off the boundary rather than off the entry the next turn
 * attaches to, so a walk from the tip alone loses the one entry that stands for
 * everything the cut dropped. Parents-first is then the append order itself: an
 * entry's parent is always written before it, so ordering the walked set by
 * where it was appended orders every branch against every other.
 *
 * A META ENTRY IS THE RUNTIME TALKING TO THE READER, not the conversation, and
 * it is dropped for the same reason the bookkeeping types are. The suite pins
 * the chain and what it holds against what the SDK's own accessor answered for
 * the same bytes.
 */

import type { JsonValue } from "./selector.ts";

/** One entry of the raw store, parsed no further than a reader draws it. */
export interface SessionStoreEntry {
  readonly uuid?: string;
  readonly parentUuid?: string;
  readonly type: string;
  readonly subtype?: string;
  readonly timestamp?: string;
  readonly message?: JsonValue;
  readonly compactMetadata?: JsonValue;
  /** The runtime's own note to the reader, which is not part of the conversation. */
  readonly isMeta?: boolean;
}

/** Where the last compaction cut, and which entries it kept on the far side of the cut. */
export interface SessionTranscriptCompaction {
  readonly boundary: SessionStoreEntry;
  readonly preserved: readonly string[];
  /**
   * The summary the compaction wrote in place of what it dropped. It is named
   * apart from `preserved` because it did not survive the cut: it replaced what
   * did not.
   */
  readonly anchor?: string;
}

/** The entry types a reader is shown; every other type is the runtime's bookkeeping. */
const transcriptTypes = ["user", "assistant"];

/** The system entry a compaction writes, which is the only machine-identifiable half of one. */
const compactionSubtype = "compact_boundary";

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function entryOf(value: unknown): SessionStoreEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const fields = value as Record<string, unknown>;
  const type = optionalText(fields["type"]);
  if (type === undefined) return undefined;
  const uuid = optionalText(fields["uuid"]);
  const parentUuid = optionalText(fields["parentUuid"]);
  const subtype = optionalText(fields["subtype"]);
  const timestamp = optionalText(fields["timestamp"]);
  return {
    type,
    ...(uuid === undefined ? {} : { uuid }),
    ...(parentUuid === undefined ? {} : { parentUuid }),
    ...(subtype === undefined ? {} : { subtype }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(fields["message"] === undefined
      ? {}
      : { message: fields["message"] as JsonValue }),
    ...(fields["compactMetadata"] === undefined
      ? {}
      : { compactMetadata: fields["compactMetadata"] as JsonValue }),
    ...(typeof fields["isMeta"] === "boolean"
      ? { isMeta: fields["isMeta"] }
      : {}),
  };
}

/**
 * The entries one store text holds. A line the reader cannot speak for is
 * dropped rather than fatal: a page is assembled from batches whose last one
 * may be the batch a dead run left half-written, and the entries beside it are
 * what a reader came for.
 */
export function sessionStoreEntries(
  text: string,
): readonly SessionStoreEntry[] {
  const entries: SessionStoreEntry[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = entryOf(parsed);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

/**
 * The first entry each uuid names. A fork re-appends its parent's entries with
 * their uuids unchanged, so a stream concatenated with the one it forked from
 * holds two entries under one identity; keeping the first is what makes the walk
 * total over any set of entries rather than only over one stream's.
 */
function entriesByUuid(
  entries: readonly SessionStoreEntry[],
): ReadonlyMap<string, SessionStoreEntry> {
  const byUuid = new Map<string, SessionStoreEntry>();
  for (const entry of entries)
    if (entry.uuid !== undefined && !byUuid.has(entry.uuid))
      byUuid.set(entry.uuid, entry);
  return byUuid;
}

/** Walks one entry's ancestry into `walked`, stopping at anything already there. */
function walkAncestry(
  from: SessionStoreEntry | undefined,
  byUuid: ReadonlyMap<string, SessionStoreEntry>,
  walked: Set<SessionStoreEntry>,
  seen: Set<string>,
): void {
  let current = from;
  while (current?.uuid !== undefined && !seen.has(current.uuid)) {
    seen.add(current.uuid);
    walked.add(current);
    current =
      current.parentUuid === undefined
        ? undefined
        : byUuid.get(current.parentUuid);
  }
}

/**
 * The chain the agent itself sees: user and assistant entries, parents first,
 * walked from the tip and from the last compaction's summary alike.
 */
export function sessionTranscriptChain(
  entries: readonly SessionStoreEntry[],
): readonly SessionStoreEntry[] {
  const byUuid = entriesByUuid(entries);
  let leaf: SessionStoreEntry | undefined;
  for (const entry of entries) if (entry.uuid !== undefined) leaf = entry;
  const walked = new Set<SessionStoreEntry>();
  const seen = new Set<string>();
  walkAncestry(leaf, byUuid, walked, seen);
  const anchor = sessionTranscriptCompaction(entries)?.anchor;
  if (anchor !== undefined)
    walkAncestry(byUuid.get(anchor), byUuid, walked, seen);
  return entries.filter(
    (entry) =>
      walked.has(entry) &&
      transcriptTypes.includes(entry.type) &&
      entry.isMeta !== true,
  );
}

function preservedMessages(
  metadata: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const preserved = (metadata as Record<string, JsonValue>)[
    "preservedMessages"
  ];
  return typeof preserved === "object" &&
    preserved !== null &&
    !Array.isArray(preserved)
    ? (preserved as Record<string, JsonValue>)
    : undefined;
}

function preservedUuids(metadata: JsonValue | undefined): readonly string[] {
  const named = preservedMessages(metadata)?.["uuids"];
  const listed: readonly JsonValue[] = Array.isArray(named) ? named : [];
  return listed.filter((uuid): uuid is string => typeof uuid === "string");
}

/** The summary a compaction wrote, which is what the context holds in place of the cut. */
function anchorUuid(metadata: JsonValue | undefined): string | undefined {
  const named = preservedMessages(metadata)?.["anchorUuid"];
  return typeof named === "string" && named.length > 0 ? named : undefined;
}

/**
 * Where the last compaction cut, and which entries survived it. The boundary is
 * found by its own entry rather than by the summary's prose: the summary is an
 * ordinary user entry, and keying on its text would key a machine decision on
 * words a model wrote.
 */
export function sessionTranscriptCompaction(
  entries: readonly SessionStoreEntry[],
): SessionTranscriptCompaction | undefined {
  let boundary: SessionStoreEntry | undefined;
  for (const entry of entries)
    if (entry.type === "system" && entry.subtype === compactionSubtype)
      boundary = entry;
  if (boundary === undefined) return undefined;
  const anchor = anchorUuid(boundary.compactMetadata);
  return {
    boundary,
    preserved: preservedUuids(boundary.compactMetadata),
    ...(anchor === undefined ? {} : { anchor }),
  };
}

/**
 * What the context currently holds: the entries the last compaction preserved,
 * and everything appended after it. Without a compaction that is the whole
 * chain, because nothing has been dropped from it.
 */
export function sessionTranscriptHeld(
  entries: readonly SessionStoreEntry[],
): readonly SessionStoreEntry[] {
  const chain = sessionTranscriptChain(entries);
  const compaction = sessionTranscriptCompaction(entries);
  if (compaction === undefined) return chain;
  const appendedAt = new Map<SessionStoreEntry, number>();
  entries.forEach((entry, index) => appendedAt.set(entry, index));
  const cut = appendedAt.get(compaction.boundary) ?? entries.length;
  const preserved = new Set(compaction.preserved);
  return chain.filter(
    (entry) =>
      (entry.uuid !== undefined && preserved.has(entry.uuid)) ||
      (appendedAt.get(entry) ?? -1) > cut,
  );
}
