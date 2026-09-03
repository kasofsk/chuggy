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

/**
 * A seeded generator, so a sequence that finds something can be run again. It
 * is mulberry32 rather than a bare linear congruential step, whose first draw
 * from a small seed spans a fraction of the unit interval — every sequence then
 * opens on the same shape, and a generator that starts every run in one place
 * explores far less than its seed count suggests.
 */
function modelRandom(seed: number): () => number {
  let held = (seed + 0x6d_2b_79_f5) >>> 0;
  return () => {
    held = (held + 0x6d_2b_79_f5) >>> 0;
    let mixed = Math.imul(held ^ (held >>> 15), held | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
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
 * one that `stalls` hands back the cursor it was asked with and one that
 * `repeats` sends its own entries twice — the two ways a route can misbehave
 * that the walk's cursor rule and the fold's dedupe are each there for.
 */
function modelPage(
  store: ModelStore,
  after: number,
  shape: {
    readonly decides: boolean;
    readonly draws: boolean;
    readonly stalls: boolean;
    readonly repeats: boolean;
    readonly elided: number;
  },
): LeadTranscriptResponse {
  const above = shape.draws ? (store.batches[after] ?? []) : [];
  const batch = shape.repeats ? [...above, ...above] : above;
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
    ...(shape.draws && above.length === 0
      ? {}
      : { nextAfter: shape.stalls ? after : after + 1 }),
  };
}

/** What the reference gathers for one run of pages read under one cut. */
interface ModelSegment {
  readonly entries: readonly string[];
  readonly holding: readonly string[];
  readonly cut: number | undefined;
  readonly unknown: boolean;
  /** Where the run's walk stands, recomputed so a page that would not move the
   * cursor can be told from one that did. */
  readonly asked: number;
  readonly pages: number;
}

const modelSegmentEmpty: ModelSegment = {
  entries: [],
  holding: [],
  cut: undefined,
  unknown: false,
  asked: 0,
  pages: 0,
};

function modelGathered(
  segment: ModelSegment,
  page: LeadTranscriptResponse,
  highWaterBatch: number,
): ModelSegment {
  const stalls =
    page.nextAfter !== undefined && page.nextAfter <= segment.asked;
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
    unknown: segment.unknown || page.held === undefined || stalls,
    asked:
      page.nextAfter === undefined
        ? highWaterBatch
        : stalls
          ? segment.asked
          : page.nextAfter,
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
    else
      runs[runs.length - 1] = modelGathered(
        current,
        event.page,
        event.highWaterBatch,
      );
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
      repeats: random() > 0.8,
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

/** What one driven run reached, so a case can say the shapes it is about were
 * generated rather than assumed. */
interface ModelReached {
  readonly dropped: number;
  /** Whether a pane ever dropped entries at the cap while a re-walk owed its
   * reader a fold, which is the one seam the cap and the reset share. */
  readonly droppedWhileRebuilding: boolean;
  /** Whether a page ever arrived carrying an entry the fold already held, which
   * is what the dedupe is for and what nothing was generating. */
  readonly repeated: boolean;
}

/** One run driven and checked at every step, answering what it reached. */
function modelDriven(seed: number, shape: ModelShape): ModelReached {
  const run = modelRun(seed, shape);
  let pane = leadTranscriptPaneEmpty;
  let everHadEntries = false;
  let dropped = 0;
  let droppedWhileRebuilding = false;
  let repeated = false;
  const applied: LeadTranscriptEvent[] = [];
  for (const event of run.events) {
    applied.push(event);
    if (event.event === "Page") {
      const before = new Set(
        pane.fold.entries.flatMap((entry) =>
          entry.uuid === undefined ? [] : [entry.uuid],
        ),
      );
      repeated =
        repeated ||
        event.page.entries.some(
          (entry) => entry.uuid !== undefined && before.has(entry.uuid),
        );
    }
    pane = leadTranscriptStep(pane, event);
    if (event.event === "StreamChange") everHadEntries = false;
    modelChecked(applied, run.chain, pane, {
      seed,
      step: applied.length,
      everHadEntries,
    });
    dropped = Math.max(dropped, pane.fold.entriesDropped);
    if (pane.kept !== undefined && pane.kept.entriesDropped > 0)
      droppedWhileRebuilding = true;
    if (drawnUuids(leadTranscriptDrawn(pane)).length > 0) everHadEntries = true;
  }
  return { dropped, droppedWhileRebuilding, repeated };
}

test("the fold answers what a recompute over the whole history answers", () => {
  let repeated = false;
  for (let seed = 1; seed <= modelSequences; seed += 1)
    repeated = modelDriven(seed, modelShapeOrdinary).repeated || repeated;
  expect(
    repeated,
    "no page ever repeated an entry, so the dedupe was never exercised",
  ).toBe(true);
});

/**
 * The same invariants over a store long enough to overflow what a pane keeps,
 * so the cap and the entries it drops are reached rather than assumed — and the
 * assertion that they were, because an invariant nothing exercises reports
 * success without looking.
 */
test("the invariants hold over a store past what a pane can keep", () => {
  let dropped = 0;
  let rebuilding = false;
  for (let seed = 1; seed <= modelCappedSequences; seed += 1) {
    const reached = modelDriven(seed, modelShapeCapped);
    dropped = Math.max(dropped, reached.dropped);
    rebuilding = rebuilding || reached.droppedWhileRebuilding;
  }
  expect(
    dropped,
    "no sequence reached the cap, so the invariant over it never bound",
  ).toBeGreaterThan(0);
  expect(
    rebuilding,
    "no sequence held a capped fold for a reader, so the seam was never reached",
  ).toBe(true);
});

/**
 * THE WALK STOPS. Over a store that is not growing, a pane must run out of
 * cursor before it runs out of budget — including on a page whose cursor does
 * not advance, which leaves the walk nowhere to go and must therefore end it
 * rather than spend every read a reader is waiting on re-asking one batch.
 */
test("a walk over a store that stands still stops before its budget", () => {
  const shapes = new Set<string>();
  let stalled = 0;
  for (let seed = 1; seed <= modelSequences; seed += 1) {
    const random = modelRandom(seed);
    const store = modelStore(
      1 + Math.floor(random() * modelBatchesMax),
      modelEntriesPerBatch,
    );
    shapes.add(String(store.batches.length));
    let pane = leadTranscriptPaneEmpty;
    let reads = 0;
    let stalls = false;
    const cursors: number[] = [];
    for (let at = 0; at < leadTranscriptReadsMax; at += 1) {
      const after = leadTranscriptNextAfter(pane, store.batches.length);
      if (after === undefined) break;
      cursors.push(after);
      reads += 1;
      const stalling = random() > 0.7;
      stalls = stalls || stalling;
      pane = leadTranscriptStep(pane, {
        event: "Page",
        page: modelPage(store, after, {
          decides: true,
          draws: true,
          stalls: stalling,
          repeats: false,
          elided: 0,
        }),
        highWaterBatch: store.batches.length,
      });
    }
    if (stalls) stalled += 1;
    expect(
      [...new Set(cursors)],
      `seed ${String(seed)}: the walk skipped a batch below the high-water mark`,
    ).toStrictEqual(
      Array.from({ length: new Set(cursors).size }, (_unused, at) => at),
    );
    expect(
      leadTranscriptNextAfter(pane, store.batches.length),
      `seed ${String(seed)}: the walk was still asking when its budget ran out`,
    ).toBeUndefined();
    expect(
      reads,
      `seed ${String(seed)}: the walk spent its whole budget`,
    ).toBeLessThan(leadTranscriptReadsMax);
  }
  expect(
    shapes.size,
    "the seeds stopped reaching every store shape the generator can build",
  ).toBe(modelBatchesMax);
  expect(
    stalled,
    "no sequence met a cursor that did not advance",
  ).toBeGreaterThan(0);
});

/**
 * THE WALK WAITS AT A STALL RATHER THAN SKIPPING PAST IT. A store written above
 * the mark the stall was read against carries the walk on from exactly the
 * cursor it stopped at, so the batches between are reached rather than
 * abandoned — taking the mark as the cursor instead loses them for the life of
 * the pane, and draws them as a lead holding nothing.
 */
test("a store written past a stall carries the walk on from where it stopped", () => {
  const store = modelStore(5, modelEntriesPerBatch);
  const stalling = (after: number) =>
    modelPage(store, after, {
      decides: true,
      draws: true,
      stalls: after === 1,
      repeats: false,
      elided: 0,
    });
  let pane = leadTranscriptStep(leadTranscriptPaneEmpty, {
    event: "Page",
    page: stalling(0),
    highWaterBatch: 2,
  });
  pane = leadTranscriptStep(pane, {
    event: "Page",
    page: stalling(1),
    highWaterBatch: 2,
  });
  expect(pane.fold.readTo, "the walk gave up the cursor it stalled at").toBe(1);
  expect(leadTranscriptNextAfter(pane, 2)).toBeUndefined();
  expect(
    leadTranscriptDrawn(pane).holdingUnknown,
    "a pane that has not reached the rest of the stream claimed to know",
  ).toBe(true);
  const cursors: number[] = [];
  for (let at = 0; at < leadTranscriptReadsMax; at += 1) {
    const after = leadTranscriptNextAfter(pane, store.batches.length);
    if (after === undefined) break;
    cursors.push(after);
    pane = leadTranscriptStep(pane, {
      event: "Page",
      page: modelPage(store, after, {
        decides: true,
        draws: true,
        stalls: false,
        repeats: false,
        elided: 0,
      }),
      highWaterBatch: store.batches.length,
    });
  }
  expect(
    cursors,
    "the walk did not resume from the cursor it stalled at",
  ).toStrictEqual([1, 2, 3, 4, 5]);
  expect(pane.fold.entries.length).toBe(
    store.batches.length * modelEntriesPerBatch,
  );
});

/** A cursor a page hands back unchanged ends the walk, because asking again
 * returns the page that was just read. */
test("a cursor that does not advance ends the walk where it stands", () => {
  const store = modelStore(4, modelEntriesPerBatch);
  const walked = leadTranscriptStep(leadTranscriptPaneEmpty, {
    event: "Page",
    page: modelPage(store, 0, {
      decides: true,
      draws: true,
      stalls: true,
      repeats: false,
      elided: 0,
    }),
    highWaterBatch: 4,
  });
  expect(walked.fold.entries.length).toBe(modelEntriesPerBatch);
  expect(
    leadTranscriptNextAfter(walked, 4),
    "the walk was sent back to the cursor the page would not move",
  ).toBeUndefined();
});
