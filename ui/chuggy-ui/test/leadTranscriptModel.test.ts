/**
 * The pane's fold, driven by random sequences of the events it accepts over a
 * small model store, and checked at every step against a reference that
 * recomputes the answer from the whole history.
 *
 * NAMED CASES PIN THE STATES AND THIS PINS THE TRANSITIONS BETWEEN THEM. A pane
 * is walked, compacted under, failed on, truncated, capped and re-streamed in
 * whatever order a sequence produces, so the pairs a named case would have to be
 * thought of to cover are reached by being generated instead.
 *
 * THE REFERENCE RECOMPUTES RATHER THAN PATCHES. It cuts the event history into
 * the runs of pages gathered under one cut and computes each run from scratch,
 * where the fold under test carries one value forward — so the two disagree
 * wherever the carrying is wrong. The rule for where a run ends is restated
 * rather than derived, so the reference holds the fold to that rule and cannot
 * tell that the rule itself is wrong.
 */

import { expect, test } from "vitest";

import type { LeadTranscriptResponse } from "../../../src/contract/responses.ts";
import {
  leadTranscriptDrawn,
  leadTranscriptEntriesHeldMax,
  leadTranscriptNextAfter,
  leadTranscriptPaneEmpty,
  leadTranscriptReadsMax,
  leadTranscriptStep,
} from "../app/core/leadTranscript.ts";
import type {
  LeadTranscriptEvent,
  LeadTranscriptHeld,
  LeadTranscriptPane,
} from "../app/core/leadTranscript.ts";

/** How many event sequences one run drives, and how long each is. */
const modelSequences = 200;
const modelEventsMax = 24;
const modelBatchesMax = 6;
const modelEntriesPerBatch = 3;

/** The second run's shape: fewer sequences over a store long enough to reach
 * the cap, which is where the entries a pane drops meet everything else. */
const modelCappedSequences = 6;
const modelCappedEventsMax = 60;
const modelCappedEntriesPerBatch = 60;

/** A seeded generator, so a sequence that finds something can be run again. */
function modelRandom(seed: number): () => number {
  let held = seed >>> 0;
  return () => {
    held = (held * 1_664_525 + 1_013_904_223) >>> 0;
    return held / 0x1_0000_0000;
  };
}

/** The store the model reads: batches of entries, and the batch its last
 * compaction fell in. */
interface ModelStore {
  readonly batches: readonly (readonly string[])[];
  readonly cut: number | undefined;
}

function modelBatch(batch: number, entries: number): readonly string[] {
  return Array.from(
    { length: entries },
    (_each, at) => `b${String(batch)}e${String(at + 1)}`,
  );
}

function modelStore(batches: number, entries: number): ModelStore {
  return {
    batches: Array.from({ length: batches }, (_unused, batch) =>
      modelBatch(batch + 1, entries),
    ),
    cut: undefined,
  };
}

/** Every entry the store holds, oldest first, which is the order the chain has
 * and the order a drawn pane must keep. */
function modelChain(store: ModelStore): readonly string[] {
  return store.batches.flat();
}

/**
 * One page of the store as the route answers it: the batch above `after`, with
 * `held` decided from the last cut in the WHOLE store. A page that `draws`
 * nothing is a full one whose every batch was elided or whose every entry was
 * meta — it carries a cursor and no entries, which is the shape a pane must not
 * read as the end of the stream or as a lead that has recorded nothing, while
 * one that `stalls` hands back the cursor it was asked with, which is a route
 * misbehaving and is what a pane must not be walked in circles by.
 */
function modelPage(
  store: ModelStore,
  after: number,
  shape: {
    readonly decides: boolean;
    readonly draws: boolean;
    readonly stalls: boolean;
    readonly elided: number;
  },
): LeadTranscriptResponse {
  const batch = shape.draws ? (store.batches[after] ?? []) : [];
  const cut = store.cut;
  const held =
    cut === undefined
      ? batch
      : after + 1 < cut
        ? []
        : batch.slice(after + 1 === cut ? 1 : 0);
  return {
    stream: "model-stream",
    entries: batch.map((uuid) => ({
      uuid,
      type: "assistant",
      message: { content: [] },
    })),
    ...(shape.decides ? { held: [...held] } : {}),
    ...(shape.decides && cut !== undefined ? { cut } : {}),
    elided: shape.elided,
    truncated: !shape.decides,
    ...(shape.draws && batch.length === 0 ? {} : { nextAfter: after + 1 }),
  };
}

/** What the reference gathers for one run of pages read under one cut. */
interface ModelSegment {
  readonly entries: readonly string[];
  readonly holding: readonly string[];
  readonly cut: number | undefined;
  readonly unknown: boolean;
  readonly pages: number;
}

const modelSegmentEmpty: ModelSegment = {
  entries: [],
  holding: [],
  cut: undefined,
  unknown: false,
  pages: 0,
};

function modelGathered(
  segment: ModelSegment,
  page: LeadTranscriptResponse,
): ModelSegment {
  const arriving = page.entries.flatMap((entry) =>
    entry.uuid === undefined ? [] : [entry.uuid],
  );
  const merged = [...segment.entries];
  for (const uuid of arriving) if (!merged.includes(uuid)) merged.push(uuid);
  const kept = merged.slice(-leadTranscriptEntriesHeldMax);
  const holding = [
    ...new Set([...segment.holding, ...(page.held ?? [])]),
  ].filter((uuid) => kept.includes(uuid));
  return {
    entries: kept,
    holding,
    cut: page.held === undefined ? segment.cut : page.cut,
    unknown: segment.unknown || page.held === undefined,
    pages: segment.pages + 1,
  };
}

/** Whether this page belongs to the run being gathered, or begins a new one. */
function modelStartsRun(
  segment: ModelSegment,
  page: LeadTranscriptResponse,
): boolean {
  if (page.held === undefined) return false;
  return segment.pages > 0 && page.cut !== segment.cut;
}

interface ModelReference {
  readonly entries: readonly string[];
  readonly holding: readonly string[];
  readonly holdingUnknown: boolean;
  readonly failure: string | undefined;
}

/**
 * The whole history, recomputed: the runs of pages gathered under one cut, the
 * last of them, and the last earlier run with entries where the last has none.
 */
function modelReference(
  events: readonly LeadTranscriptEvent[],
): ModelReference {
  let runs: ModelSegment[] = [modelSegmentEmpty];
  let failure: string | undefined;
  for (const event of events) {
    if (event.event === "StreamChange") {
      runs = [modelSegmentEmpty];
      failure = undefined;
      continue;
    }
    if (event.event === "Failure") {
      failure = event.reason;
      continue;
    }
    if (event.event === "BudgetEnd") continue;
    failure = undefined;
    const current = runs[runs.length - 1] ?? modelSegmentEmpty;
    if (modelStartsRun(current, event.page))
      runs.push({
        ...modelSegmentEmpty,
        ...(event.page.cut === undefined ? {} : { cut: event.page.cut }),
      });
    else runs[runs.length - 1] = modelGathered(current, event.page);
  }
  const last = runs[runs.length - 1] ?? modelSegmentEmpty;
  if (last.entries.length > 0)
    return {
      entries: last.entries,
      holding: last.holding,
      holdingUnknown: last.unknown,
      failure,
    };
  const kept = [...runs]
    .slice(0, -1)
    .reverse()
    .find((run) => run.entries.length > 0);
  if (kept === undefined)
    return {
      entries: [],
      holding: last.holding,
      holdingUnknown: last.unknown,
      failure,
    };
  return {
    entries: kept.entries,
    holding: [],
    holdingUnknown: true,
    failure,
  };
}

function drawnUuids(drawn: LeadTranscriptHeld): readonly string[] {
  return drawn.entries.flatMap((entry) =>
    entry.uuid === undefined ? [] : [entry.uuid],
  );
}

/** One sequence's worth of events, and the store they were read from. */
interface ModelRun {
  readonly events: readonly LeadTranscriptEvent[];
  readonly chain: readonly string[];
}

function modelEvent(
  random: () => number,
  store: ModelStore,
  pane: LeadTranscriptPane,
  highWaterBatch: number,
): LeadTranscriptEvent {
  const roll = random();
  if (roll < 0.08) return { event: "Failure", reason: "the API failed" };
  if (roll < 0.14) return { event: "BudgetEnd" };
  if (roll < 0.18) return { event: "StreamChange", stream: "model-stream" };
  const after = leadTranscriptNextAfter(pane, highWaterBatch);
  if (after === undefined) return { event: "BudgetEnd" };
  return {
    event: "Page",
    page: modelPage(store, after, {
      decides: random() > 0.15,
      draws: random() > 0.25,
      stalls: random() > 0.9,
      elided: random() > 0.85 ? 1 : 0,
    }),
    highWaterBatch,
  };
}

/** One more batch on the end of the store, which is what makes a cursor the
 * walk had exhausted worth asking again. */
function modelGrown(store: ModelStore, entries: number): ModelStore {
  return {
    ...store,
    batches: [...store.batches, modelBatch(store.batches.length + 1, entries)],
  };
}

/** What one sequence is generated under: how long it runs, how big its store
 * grows and how much of it each batch holds. */
interface ModelShape {
  readonly events: number;
  readonly batches: number;
  readonly entries: number;
}

const modelShapeOrdinary: ModelShape = {
  events: modelEventsMax,
  batches: modelBatchesMax,
  entries: modelEntriesPerBatch,
};

const modelShapeCapped: ModelShape = {
  events: modelCappedEventsMax,
  batches: modelBatchesMax,
  entries: modelCappedEntriesPerBatch,
};

/** One sequence: a store that grows and compacts under a pane being walked. */
function modelRun(seed: number, shape: ModelShape): ModelRun {
  const random = modelRandom(seed);
  let store = modelStore(
    1 + Math.floor(random() * shape.batches),
    shape.entries,
  );
  let pane = leadTranscriptPaneEmpty;
  const events: LeadTranscriptEvent[] = [];
  for (let at = 0; at < shape.events; at += 1) {
    if (random() > 0.85)
      store = {
        ...store,
        cut: 1 + Math.floor(random() * store.batches.length),
      };
    if (random() > 0.6) store = modelGrown(store, shape.entries);
    const event = modelEvent(random, store, pane, store.batches.length);
    events.push(event);
    pane = leadTranscriptStep(pane, event);
  }
  return { events, chain: modelChain(store) };
}

/** What a failing assertion has to name, because a sequence is only worth
 * generating if the one that broke can be run again. */
interface ModelWhere {
  readonly seed: number;
  readonly step: number;
}

function modelSaid(where: ModelWhere, said: string): string {
  return `seed ${String(where.seed)}, step ${String(where.step)}: ${said}`;
}

/** Every invariant, checked over one prefix of one sequence. */
function modelChecked(
  events: readonly LeadTranscriptEvent[],
  chain: readonly string[],
  pane: LeadTranscriptPane,
  where: ModelWhere & { readonly everHadEntries: boolean },
): void {
  const drawn = leadTranscriptDrawn(pane);
  const uuids = drawnUuids(drawn);
  const reference = modelReference(events);
  expect(
    uuids,
    modelSaid(where, "the fold and the recomputed history disagree"),
  ).toStrictEqual(reference.entries);
  expect(
    drawn.holding,
    modelSaid(where, "the held sets disagree"),
  ).toStrictEqual(reference.holding);
  expect(
    drawn.holdingUnknown,
    modelSaid(where, "the undecided verdicts disagree"),
  ).toBe(reference.holdingUnknown);
  expect(drawn.failure, modelSaid(where, "the failures disagree")).toBe(
    reference.failure,
  );
  expect(
    new Set(uuids).size,
    modelSaid(where, "an entry was drawn twice"),
  ).toBe(uuids.length);
  const places = uuids.map((uuid) => chain.indexOf(uuid));
  expect(
    places.every((place, at) => at === 0 || place > (places[at - 1] ?? -1)),
    modelSaid(where, "the chain was drawn out of the store's own order"),
  ).toBe(true);
  expect(
    uuids.length,
    modelSaid(where, "a pane drew more entries than it may keep"),
  ).toBeLessThanOrEqual(leadTranscriptEntriesHeldMax);
  expect(
    drawn.holding.every((uuid) => uuids.includes(uuid)),
    modelSaid(where, "the lead was marked as holding an entry not drawn"),
  ).toBe(true);
  if (where.everHadEntries)
    expect(
      uuids.length,
      modelSaid(where, "a pane that had a whole fold was drawn empty"),
    ).toBeGreaterThan(0);
}

/** One run driven and checked at every step, answering how much of the store
 * the pane ever had to drop. */
function modelDriven(seed: number, shape: ModelShape): number {
  const run = modelRun(seed, shape);
  let pane = leadTranscriptPaneEmpty;
  let everHadEntries = false;
  let dropped = 0;
  const applied: LeadTranscriptEvent[] = [];
  for (const event of run.events) {
    applied.push(event);
    pane = leadTranscriptStep(pane, event);
    if (event.event === "StreamChange") everHadEntries = false;
    modelChecked(applied, run.chain, pane, {
      seed,
      step: applied.length,
      everHadEntries,
    });
    dropped = Math.max(dropped, pane.fold.entriesDropped);
    if (drawnUuids(leadTranscriptDrawn(pane)).length > 0) everHadEntries = true;
  }
  return dropped;
}

test("the fold answers what a recompute over the whole history answers", () => {
  for (let seed = 1; seed <= modelSequences; seed += 1)
    modelDriven(seed, modelShapeOrdinary);
});

/**
 * The same invariants over a store long enough to overflow what a pane keeps,
 * so the cap and the entries it drops are reached rather than assumed — and the
 * assertion that they were, because an invariant nothing exercises reports
 * success without looking.
 */
test("the invariants hold over a store past what a pane can keep", () => {
  let dropped = 0;
  for (let seed = 1; seed <= modelCappedSequences; seed += 1)
    dropped = Math.max(dropped, modelDriven(seed, modelShapeCapped));
  expect(
    dropped,
    "no sequence reached the cap, so the invariant over it never bound",
  ).toBeGreaterThan(0);
});

/**
 * THE WALK STOPS. Over a store that is not growing, a pane must run out of
 * cursor before it runs out of budget — a cursor it has already read, handed
 * back while the store stands still, is a walk that spends every read on one
 * batch and reports the rest of the stream as unread.
 */
test("a walk over a store that stands still stops before its budget", () => {
  for (let seed = 1; seed <= modelSequences; seed += 1) {
    const random = modelRandom(seed);
    const store = modelStore(
      1 + Math.floor(random() * modelBatchesMax),
      modelEntriesPerBatch,
    );
    let pane = leadTranscriptPaneEmpty;
    let reads = 0;
    for (let at = 0; at < leadTranscriptReadsMax; at += 1) {
      const after = leadTranscriptNextAfter(pane, store.batches.length);
      if (after === undefined) break;
      reads += 1;
      pane = leadTranscriptStep(pane, {
        event: "Page",
        page: modelPage(store, after, {
          decides: true,
          draws: true,
          stalls: random() > 0.7,
          elided: 0,
        }),
        highWaterBatch: store.batches.length,
      });
    }
    expect(
      leadTranscriptNextAfter(pane, store.batches.length),
      `seed ${String(seed)}: the walk was still asking when its budget ran out`,
    ).toBeUndefined();
    expect(reads).toBeLessThan(leadTranscriptReadsMax);
  }
});
