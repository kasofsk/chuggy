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
import type {
  AgenticRefusalResponse,
  LeadTranscriptResponse,
} from "../../../src/contract/responses.ts";
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
 * cursor, and the store growing above it is what reaches it instead. */
test("neither an empty page nor a standing cursor is asked past on its own", () => {
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
    "uuid-p",
    "uuid-q",
    "uuid-a",
    "uuid-b",
    leadBoundaryUuid,
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
  const held = leadTranscriptMerged(walkedTwice(), leadTranscriptPage(2, 3), 3);
  expect(leadTranscriptHolding(held).map((line) => line.uuid)).toEqual([
    leadBoundaryUuid,
    "uuid-d",
  ]);
});

/**
 * A PAGE WHOLLY BELOW THE CUT ANSWERS NONE OF ITS ENTRIES, and an empty answer
 * is an answer. A pane falling back to the page's own entries there — the rule
 * that was right when only one page could answer — would mark the whole of a
 * lead's dropped context as the context it is working from.
 */
test("a page that holds none of its entries is drawn holding none of them", () => {
  const below = leadTranscriptPage(0, 3);
  expect(below.entries.length).toBeGreaterThan(0);
  expect(below.held).toStrictEqual([]);
  const held = leadTranscriptMerged(leadTranscriptHeldEmpty, below, 3);
  expect(held.holdingUnknown).toBe(false);
  expect(
    leadTranscriptHolding(held),
    "a page answering no entries was read as a page answering all of them",
  ).toStrictEqual([]);
});

/** One page of a stream whose last cut fell in `cut`, answering `held` over its
 * own entries. */
function cutPage(
  cut: number | undefined,
  entries: readonly string[],
  held: readonly string[],
  nextAfter?: number,
): LeadTranscriptResponse {
  return {
    stream: leadStream,
    entries: entries.map((uuid) => ({
      uuid,
      type: "assistant",
      message: { content: [] },
    })),
    held: [...held],
    ...(cut === undefined ? {} : { cut }),
    ...(held.length === 0 ? {} : { compaction: { boundary: held[0] ?? "" } }),
    elided: 0,
    truncated: false,
    ...(nextAfter === undefined ? {} : { nextAfter }),
  };
}

/**
 * A CUT THAT MOVES INVALIDATES WHAT WAS GATHERED UNDER THE OLD ONE. The pane
 * walks a stream that is compacted beneath it, so answers from pages ago were
 * decided against a cut that no longer exists; keeping them leaves the lead
 * marked as holding entries it has dropped, drawn above the seam the same page
 * moved.
 */
test("a page naming a different cut drops what was gathered under the old one", () => {
  const first = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    cutPage(1, ["uuid-a", "uuid-b"], ["uuid-a", "uuid-b"], 1),
    1,
  );
  expect(first.cut).toBe(1);
  expect(first.holding).toStrictEqual(["uuid-a", "uuid-b"]);
  const compacted = leadTranscriptMerged(
    first,
    cutPage(3, ["uuid-c", "uuid-d"], ["uuid-d"]),
    2,
  );
  expect(compacted.cut).toBe(3);
  expect(
    leadTranscriptHolding(compacted).map((line) => line.uuid),
    "entries below a new cut stayed marked held",
  ).toStrictEqual(["uuid-d"]);
  const lines = leadTranscriptLines(compacted);
  expect(lines.map((line) => line.uuid)).toStrictEqual([
    "uuid-a",
    "uuid-b",
    "uuid-c",
    "uuid-d",
  ]);
  expect(lines.filter((line) => line.seam).map((line) => line.uuid)).toEqual([
    "uuid-d",
  ]);
  expect(compacted.readTo, "the pane did not re-walk the moved stream").toBe(0);
});

/**
 * A STREAM COMPACTED FOR THE FIRST TIME UNDER AN OPEN PANE moves its cut from
 * absent to a batch, and the answers gathered before it — every entry, because
 * nothing had been dropped — are exactly the ones that are now stale.
 */
test("a first compaction invalidates as surely as a later one", () => {
  const uncut = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    cutPage(undefined, ["uuid-a", "uuid-b"], ["uuid-a", "uuid-b"], 1),
    1,
  );
  expect(uncut.cut).toBeUndefined();
  const compacted = leadTranscriptMerged(
    uncut,
    cutPage(2, ["uuid-c"], ["uuid-c"]),
    2,
  );
  expect(
    leadTranscriptHolding(compacted).map((line) => line.uuid),
    "a stream compacted for the first time kept its pre-cut answers",
  ).toStrictEqual(["uuid-c"]);
  expect(compacted.readTo).toBe(0);
});

/**
 * A WALK OUTAGE SAYS NOTHING ABOUT THE CUT. The route answers `200` with `held`
 * and `cut` both absent, which is undecided; reading that as a cut that moved
 * would throw away every answer the pane holds and re-walk the whole stream
 * every time the route could not reach its end.
 */
test("a page that decided nothing does not move the cut or the walk", () => {
  const first = leadTranscriptMerged(
    leadTranscriptHeldEmpty,
    cutPage(1, ["uuid-a"], ["uuid-a"], 1),
    2,
  );
  const outage = leadTranscriptMerged(
    first,
    {
      stream: leadStream,
      entries: [{ uuid: "uuid-b", type: "user", message: { content: [] } }],
      elided: 0,
      truncated: true,
    },
    2,
  );
  expect(outage.cut).toBe(1);
  expect(outage.holdingUnknown).toBe(true);
  expect(outage.readTo, "an undecided page re-walked the stream").toBe(2);
  expect(leadTranscriptHolding(outage).map((line) => line.uuid)).toStrictEqual([
    "uuid-a",
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
      held: Array.from(
        { length: overflowing },
        (_unused, at) => `uuid-${String(at)}`,
      ),
      elided: 0,
      truncated: false,
    },
    1,
  );
  expect(held.entries.length).toBe(leadTranscriptEntriesHeldMax);
  expect(held.entriesDropped).toBe(3);
  expect(leadTranscriptLines(held)[0]?.uuid).toBe("uuid-3");
  expect(
    held.holding.length,
    "the holding set outlived the entries it names",
  ).toBe(leadTranscriptEntriesHeldMax);
  expect(held.holding).not.toContain("uuid-0");
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
