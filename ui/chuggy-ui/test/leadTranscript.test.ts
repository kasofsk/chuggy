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
  leadTranscriptPages,
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

function pageAt(after: string): (typeof leadTranscriptPages)[string] {
  const page = leadTranscriptPages[after];
  if (page === undefined) throw new Error("the fixture has no such page");
  return page;
}

function walkedTwice(): LeadTranscriptHeld {
  const first = leadTranscriptMerged(leadTranscriptHeldEmpty, pageAt("0"), 2);
  return leadTranscriptMerged(first, pageAt("1"), 2);
}

test("the walk starts at nothing and stops when the store has written nothing more", () => {
  expect(leadTranscriptNextAfter(leadTranscriptHeldEmpty, 0)).toBeUndefined();
  expect(leadTranscriptNextAfter(leadTranscriptHeldEmpty, 2)).toBe(0);
  const first = leadTranscriptMerged(leadTranscriptHeldEmpty, pageAt("0"), 2);
  expect(leadTranscriptNextAfter(first, 2)).toBe(1);
  const second = leadTranscriptMerged(first, pageAt("1"), 2);
  expect(leadTranscriptNextAfter(second, 2)).toBeUndefined();
  expect(leadTranscriptNextAfter(second, 3)).toBe(2);
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
      ...pageAt("2"),
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
