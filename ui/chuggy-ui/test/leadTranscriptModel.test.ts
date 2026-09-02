/**
 * The pane's fold, driven by random sequences of the events it accepts over a
 * small model store, and checked at every step against a reference that
 * recomputes the answer from the whole history.
 *
 * SIX ROUNDS OF REVIEW FOUND SIX INTERACTIONS BETWEEN STATES, each time in the
 * seam a fix had just added: a re-walk over a capped list, a count carried
 * across a reset, a failure recorded on one, a re-walk whose own pages draw
 * nothing. Named cases pin the states; this pins the transitions between them,
 * because it is the pairs nobody thought of that the named cases keep missing.
 *
 * THE REFERENCE IS A DIFFERENT COMPUTATION AND NOT A SECOND COPY. It cuts the
 * event history into the runs of pages gathered under one cut and recomputes
 * each from scratch; the fold under test patches one value forward. Two ways of
 * saying the same thing disagree where either is wrong.
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

function modelStore(batches: number): ModelStore {
  return {
    batches: Array.from({ length: batches }, (_unused, batch) =>
      Array.from(
        { length: modelEntriesPerBatch },
        (_each, at) => `b${String(batch + 1)}e${String(at + 1)}`,
      ),
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
 * read as the end of the stream or as a lead that has recorded nothing.
 */
function modelPage(
  store: ModelStore,
  after: number,
  shape: {
    readonly decides: boolean;
    readonly draws: boolean;
    readonly elided: number;
  },
): LeadTranscriptResponse {
  const batch = shape.draws ? (store.batches[after] ?? []) : [];
  const cut = store.cut;
  const held =
    cut === undefined ? batch : after + 1 < cut ? [] : batch.slice(0);
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
      elided: random() > 0.85 ? 1 : 0,
    }),
    highWaterBatch,
  };
}

/** One more batch on the end of the store, which is what makes a cursor the
 * walk had exhausted worth asking again. */
function modelGrown(store: ModelStore): ModelStore {
  const batch = store.batches.length + 1;
  return {
    ...store,
    batches: [
      ...store.batches,
      Array.from(
        { length: modelEntriesPerBatch },
        (_each, at) => `b${String(batch)}e${String(at + 1)}`,
      ),
    ],
  };
}

/** One sequence: a store that grows and compacts under a pane being walked. */
function modelRun(seed: number): ModelRun {
  const random = modelRandom(seed);
  let store = modelStore(1 + Math.floor(random() * modelBatchesMax));
  let pane = leadTranscriptPaneEmpty;
  const events: LeadTranscriptEvent[] = [];
  for (let at = 0; at < modelEventsMax; at += 1) {
    if (random() > 0.85)
      store = {
        ...store,
        cut: 1 + Math.floor(random() * store.batches.length),
      };
    if (random() > 0.8) store = modelGrown(store);
    const event = modelEvent(random, store, pane, store.batches.length);
    events.push(event);
    pane = leadTranscriptStep(pane, event);
  }
  return { events, chain: modelChain(store) };
}

/** Every invariant, checked over one prefix of one sequence. */
function modelChecked(
  events: readonly LeadTranscriptEvent[],
  chain: readonly string[],
  pane: LeadTranscriptPane,
  everHadEntries: boolean,
): void {
  const drawn = leadTranscriptDrawn(pane);
  const uuids = drawnUuids(drawn);
  const reference = modelReference(events);
  expect(uuids, "the fold and the recomputed history disagree").toStrictEqual(
    reference.entries,
  );
  expect(drawn.holding).toStrictEqual(reference.holding);
  expect(drawn.holdingUnknown).toBe(reference.holdingUnknown);
  expect(drawn.failure).toBe(reference.failure);
  expect(new Set(uuids).size, "an entry was drawn twice").toBe(uuids.length);
  const places = uuids.map((uuid) => chain.indexOf(uuid));
  expect(
    places.every((place, at) => at === 0 || place > (places[at - 1] ?? -1)),
    "the chain was drawn out of the order the store holds it in",
  ).toBe(true);
  expect(uuids.length).toBeLessThanOrEqual(leadTranscriptEntriesHeldMax);
  expect(
    drawn.holding.every((uuid) => uuids.includes(uuid)),
    "the lead was marked as holding an entry that is not drawn",
  ).toBe(true);
  if (everHadEntries)
    expect(
      uuids.length,
      "a pane that had a whole fold was drawn empty",
    ).toBeGreaterThan(0);
}

test("the fold answers what a recompute over the whole history answers", () => {
  for (let seed = 1; seed <= modelSequences; seed += 1) {
    const run = modelRun(seed);
    let pane = leadTranscriptPaneEmpty;
    let everHadEntries = false;
    const applied: LeadTranscriptEvent[] = [];
    for (const event of run.events) {
      applied.push(event);
      pane = leadTranscriptStep(pane, event);
      const stream = event.event === "StreamChange";
      if (stream) everHadEntries = false;
      modelChecked(applied, run.chain, pane, everHadEntries);
      if (drawnUuids(leadTranscriptDrawn(pane)).length > 0)
        everHadEntries = true;
    }
  }
});

/**
 * The walk's own bound, over the same model: however the store answers, the
 * cursor a pane hands back is asked for a bounded number of times. The loop
 * that spends the budget is the hook's; what is checked here is that no
 * sequence of pages leaves the pane asking for a cursor it has already read
 * without the store having grown.
 */
test("no sequence leaves the pane asking past its own read budget", () => {
  for (let seed = 1; seed <= modelSequences; seed += 1) {
    const random = modelRandom(seed);
    const store = modelStore(1 + Math.floor(random() * modelBatchesMax));
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
          elided: 0,
        }),
        highWaterBatch: store.batches.length,
      });
    }
    expect(reads).toBeLessThanOrEqual(leadTranscriptReadsMax);
  }
});
