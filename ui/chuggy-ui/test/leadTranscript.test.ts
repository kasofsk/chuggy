/**
 * The lead page's derivations: how a store page merges into what a pane holds,
 * which entries the lead is working from, and where the seam falls.
 *
 * The case with teeth is the second page. A page that carries no compaction
 * adds to what is held, and one that carries a compaction replaces it — and a
 * pane that unioned across a boundary would mark the entries the lead has
 * stopped holding as held, which is the whole claim the Holding panel makes.
 */

import { expect, test } from "vitest";

import {
  agenticRefusalStanding,
  leadDecisionsNewestFirst,
  leadDecisionSummary,
  leadEntryText,
  leadEntryTools,
  leadFolded,
  leadStreamBatches,
  leadStreamListed,
  leadTranscriptEntriesHeldMax,
  leadTranscriptHeldEmpty,
  leadTranscriptHolding,
  leadTranscriptLines,
  leadTranscriptMerged,
  leadTranscriptNextAfter,
  leadTranscriptReadsMax,
} from "../app/core/leadTranscript.ts";
import type { LeadTranscriptHeld } from "../app/core/leadTranscript.ts";
import type { AgenticRefusalResponse } from "../../../src/contract/responses.ts";
import {
  leadBody,
  leadBoundaryUuid,
  leadDecisionDispatching,
  leadDecisionIdle,
  leadDecisionRefusing,
  leadHistory,
  leadRefusals,
  leadSession,
  leadStream,
  leadTranscriptPage,
  leadUnstarted,
} from "./leadFixture.ts";

function refusalAt(superseded: boolean): AgenticRefusalResponse {
  const held = leadRefusals(superseded).refusals[0];
  if (held === undefined) throw new Error("the fixture has no refusal");
  return held;
}

/** The store walked to its end at two batches, which is three reads: two full
 * pages and the empty one a full page that ends the store is followed by. */
function walkedToEnd(batches: number): LeadTranscriptHeld {
  let held = leadTranscriptHeldEmpty;
  for (let read = 0; read < leadTranscriptReadsMax; read += 1) {
    const after = leadTranscriptNextAfter(held, batches);
    if (after === undefined) return held;
    held = leadTranscriptMerged(
      held,
      leadTranscriptPage(after, batches),
      batches,
    );
  }
  throw new Error("the walk did not stop inside its own budget");
}

function walkedTwice(): LeadTranscriptHeld {
  return walkedToEnd(2);
}

/**
 * `nextAfter` says a page filled its limit, so it means only that there MAY be
 * more: a full page that ends the store still carries one, and the walk has to
 * ask once more to learn that it is done. A pane that read it as "there IS
 * more" would stop one page early on every store whose last page is full.
 */
test("a full page is asked past, and the empty page after it ends the walk", () => {
  expect(leadTranscriptNextAfter(leadTranscriptHeldEmpty, 0)).toBeUndefined();
  expect(leadTranscriptNextAfter(leadTranscriptHeldEmpty, 2)).toBe(0);
  const first = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    leadTranscriptPage(0, 2),
    2,
  );
  expect(leadTranscriptNextAfter(first, 2)).toBe(1);
  const second = leadTranscriptMerged(first, leadTranscriptPage(1, 2), 2);
  expect(
    second.more,
    "a full page that ends the store was read as the end",
  ).toBe(true);
  expect(leadTranscriptNextAfter(second, 2)).toBe(2);
  const third = leadTranscriptMerged(second, leadTranscriptPage(2, 2), 2);
  expect(leadTranscriptNextAfter(third, 2)).toBeUndefined();
  expect(leadTranscriptNextAfter(third, 3)).toBe(2);
});

/** A page with nothing on it cannot have filled a limit, and neither can one
 * whose cursor did not move; neither is asked past on the strength of its own
 * cursor. */
test("an empty page and a cursor that stood still both end the walk", () => {
  const stuck = {
    stream: "1a2b3c",
    entries: [],
    held: [],
    elided: 0,
    truncated: false,
    nextAfter: 1,
  };
  const empty = leadTranscriptMerged(leadTranscriptHeldEmpty, stuck, 4);
  expect(empty.more).toBe(false);
  expect(leadTranscriptNextAfter(empty, 4)).toBe(1);
  const standing = leadTranscriptMerged(
    leadTranscriptMerged(leadTranscriptHeldEmpty, leadTranscriptPage(0, 3), 3),
    { ...leadTranscriptPage(1, 3), nextAfter: 1 },
    3,
  );
  expect(standing.more).toBe(false);
});

/** The chain over the batches read was longer than one page of entries, which
 * is a different shortfall from a batch the read could not draw. */
test("a truncated page is remembered once the walk has moved past it", () => {
  const held = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    { ...leadTranscriptPage(0, 2), truncated: true },
    2,
  );
  expect(held.truncated).toBe(true);
  expect(
    leadTranscriptMerged(held, leadTranscriptPage(1, 2), 2).truncated,
  ).toBe(true);
});

test("each entry lands once, oldest first, over as many pages as it took", () => {
  expect(leadTranscriptLines(walkedTwice()).map((line) => line.uuid)).toEqual([
    "uuid-a",
    "uuid-b",
    leadBoundaryUuid,
    "uuid-d",
  ]);
});

/**
 * The claim the Holding panel makes: the lead is working from the chain that
 * survived the last compaction. Entries below the boundary are read and are not
 * held, and a pane that could not tell the two apart would say the lead still
 * has a conversation it does not.
 */
test("what the lead holds is the chain from the seam on and nothing above it", () => {
  const held = walkedTwice();
  expect(leadTranscriptHolding(held).map((line) => line.uuid)).toEqual([
    leadBoundaryUuid,
    "uuid-d",
  ]);
  expect(
    leadTranscriptLines(held)
      .filter((line) => line.seam)
      .map((line) => line.uuid),
  ).toEqual([leadBoundaryUuid]);
});

/**
 * A PAGE'S ANSWER IS FINAL FOR ITS OWN ENTRIES. The route decides `held` from
 * the last cut in the whole stream, so a page below that cut answers none of
 * its entries and one above it answers all of them; no page can correct or
 * contradict another, and a pane that let a later page replace an earlier
 * page's answer would drop entries the lead is holding.
 */
test("each page answers for its own entries and none overrides another", () => {
  const below = leadTranscriptPage(0, 3);
  expect(below.held).toStrictEqual([leadBoundaryUuid]);
  const held = leadTranscriptMerged(walkedTwice(), leadTranscriptPage(2, 3), 3);
  expect(leadTranscriptHolding(held).map((line) => line.uuid)).toEqual([
    leadBoundaryUuid,
    "uuid-d",
    "uuid-e",
  ]);
});

test("an entry is its text and the tools it named, and never a reference", () => {
  const message = {
    content: [
      { type: "text", text: "resume from /tmp/claude-resume-9" },
      { type: "tool_use", name: "Read" },
    ],
  };
  expect(leadEntryText(message)).toBe("resume from /tmp/claude-resume-9");
  expect(leadEntryTools(message)).toEqual(["Read"]);
  expect(leadEntryText({ content: "plain" })).toBe("plain");
  expect(leadEntryText(null)).toBe("");
});

test("the transcript reads the stream the session's own reference names", () => {
  const lead = leadBody(2, 1);
  expect(leadStreamBatches(lead)).toBe(2);
  expect(leadStreamListed(lead)).toBe(true);
  expect(leadStreamBatches({ ...lead, streams: [] })).toBe(0);
  expect(leadStreamBatches(leadUnstarted())).toBe(0);
});

/** A reference the bounded listing does not carry reads as nothing to walk,
 * which is a different thing from a store with nothing in it. */
test("a reference the store's listing does not carry is not a listed stream", () => {
  const lead = leadBody(2, 1);
  expect(leadStreamListed({ ...lead, streams: [] })).toBe(false);
  expect(
    leadStreamListed({
      ...lead,
      streams: [{ stream: "another-stream", batches: 9 }],
    }),
  ).toBe(false);
  expect(leadStreamListed(leadUnstarted())).toBe(false);
});

/**
 * The pane's own ceiling. A lead's store has no retention, so a pane that kept
 * every entry it ever read would grow without a bound; the oldest leave and the
 * count of them is what stops the log reading as the whole of it.
 */
test("the oldest entries leave at the cap, and the pane counts them going", () => {
  const overflowing = leadTranscriptEntriesHeldMax + 3;
  const held = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    {
      stream: "1a2b3c",
      entries: Array.from({ length: overflowing }, (_unused, at) => ({
        uuid: `uuid-${String(at)}`,
        type: "assistant",
        message: { content: [] },
      })),
      elided: 0,
      truncated: false,
    },
    1,
  );
  expect(held.entries.length).toBe(leadTranscriptEntriesHeldMax);
  expect(held.entriesDropped).toBe(3);
  expect(leadTranscriptLines(held)[0]?.uuid).toBe("uuid-3");
});

test("a Session frame replaces the lead it names and leaves another alone", () => {
  const held = leadBody(2, 1);
  const arriving = leadBody(3, 2);
  expect(leadFolded(held, leadSession, arriving)).toStrictEqual(arriving);
  expect(leadFolded(held, "lead-other", arriving)).toStrictEqual(held);
  expect(leadFolded(held, leadSession, { stream: leadStream })).toStrictEqual(
    held,
  );
  expect(leadFolded(undefined, leadSession, arriving)).toBeUndefined();
});

test("a decision says what it did, and says so when it did nothing", () => {
  expect(leadDecisionSummary(leadDecisionRefusing)).toBe(
    "Attention · 1 refused",
  );
  expect(leadDecisionSummary(leadDecisionDispatching)).toBe(
    "Monitoring · 1 dispatched · 1 lifted",
  );
  expect(leadDecisionSummary(leadDecisionIdle)).toBe("None");
});

test("a refusal stands until the ticket is authored again", () => {
  expect(agenticRefusalStanding(refusalAt(false))).toBe("Standing");
  expect(agenticRefusalStanding(refusalAt(true))).toBe("Superseded");
});

/**
 * `held` ABSENT IS UNDECIDED AND NEVER EMPTY, the route omitting it only where
 * it could not reach the stream's end to decide it. A pane reading absence as
 * an empty set would tell a reader the lead has forgotten everything at the
 * moment the server said it could not tell.
 */
test("a page that could not decide what is held is not a page holding nothing", () => {
  const undecided = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    {
      stream: "1a2b3c",
      entries: [{ uuid: "uuid-x", type: "user", message: { content: [] } }],
      elided: 0,
      truncated: true,
      nextAfter: 1,
    },
    2,
  );
  expect(undecided.holdingUnknown).toBe(true);
  expect(undecided.holding).toStrictEqual([]);
  const decided = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    {
      stream: "1a2b3c",
      entries: [{ uuid: "uuid-x", type: "user", message: { content: [] } }],
      held: [],
      elided: 0,
      truncated: false,
      nextAfter: 1,
    },
    2,
  );
  expect(decided.holdingUnknown).toBe(false);
});

/** A route that answered the log's other end would put a months-old decision at
 * the top of the panel, so which one is newest is read off the ordinals. */
test("the decisions are ordered by ordinal whichever way the page arrived", () => {
  const ascending = [leadDecisionRefusing, leadDecisionDispatching];
  expect(
    leadDecisionsNewestFirst(ascending).map((decision) => decision.ordinal),
  ).toStrictEqual([1_202, 1_201]);
  expect(
    leadDecisionsNewestFirst(leadHistory.decisions).map(
      (decision) => decision.ordinal,
    ),
  ).toStrictEqual([1_202, 1_201]);
});

/**
 * THE CURSOR AND THE ENTRIES ARE DIFFERENT QUESTIONS: a full page can draw no
 * entries at all — every batch on it elided, or every entry meta — and still
 * have most of the store above it. A walk that read "no entries" as "no more
 * store" and jumped its cursor to the high-water mark would abandon everything
 * above that page.
 */
test("a page that drew nothing still hands the walk the cursor it gave", () => {
  const drawnEmpty = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    {
      stream: "1a2b3c",
      entries: [],
      held: [],
      elided: 3,
      truncated: false,
      nextAfter: 4,
    },
    20,
  );
  expect(drawnEmpty.readTo).toBe(4);
  expect(
    leadTranscriptNextAfter(drawnEmpty, 20),
    "a page that drew no entries took the walk to the end of the store",
  ).toBe(4);
});
