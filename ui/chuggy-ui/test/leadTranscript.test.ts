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
  leadDecisionSummary,
  leadEntryText,
  leadEntryTools,
  leadFolded,
  leadStreamBatches,
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
  SelectorDecisionResponse,
} from "../../../src/contract/responses.ts";
import {
  leadBody,
  leadBoundaryUuid,
  leadDecisionIdle,
  leadHistory,
  leadRefusals,
  leadSession,
  leadStream,
  leadTranscriptPage,
  leadUnstarted,
} from "./leadFixture.ts";

function decisionAt(at: number): SelectorDecisionResponse {
  const held = leadHistory.decisions[at];
  if (held === undefined) throw new Error("the fixture has no such decision");
  return held;
}

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
 * whose cursor did not move; either asked for again is a walk that spends its
 * whole budget on one batch. */
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

/** A page that carries its own boundary replaces what is held rather than
 * adding to it, which is what a second compaction is. */
test("a later compaction drops what the earlier page said was held", () => {
  const held = leadTranscriptMerged(
    walkedTwice(),
    {
      ...leadTranscriptPage(2, 3),
      held: ["uuid-e"],
      compaction: { boundary: "uuid-e", at: "2026-09-01T11:00:00Z" },
    },
    3,
  );
  expect(leadTranscriptHolding(held).map((line) => line.uuid)).toEqual([
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
  expect(leadStreamBatches({ ...lead, streams: [] })).toBe(0);
  expect(leadStreamBatches(leadUnstarted())).toBe(0);
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
  expect(leadDecisionSummary(decisionAt(0))).toBe("Attention · 1 refused");
  expect(leadDecisionSummary(decisionAt(1))).toBe(
    "Monitoring · 1 dispatched · 1 lifted",
  );
  expect(leadDecisionSummary(leadDecisionIdle)).toBe("None");
});

test("a refusal stands until the ticket is authored again", () => {
  expect(agenticRefusalStanding(refusalAt(false))).toBe("Standing");
  expect(agenticRefusalStanding(refusalAt(true))).toBe("Superseded");
});
