/**
 * The brief's wire bounds, and the interpreter bounds each of them is taken
 * from.
 *
 * `src/contract/` reaches nothing outside itself but the parser, so it cannot
 * import the constants it is bounded by and states them again. A restated
 * bound that nothing ties down is two bounds within a year, so the tie is
 * here: this suite is what fails when either side moves alone.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  briefBranchCharsMax,
  briefBranchPrefix,
  briefIntentCharsMax,
  briefIntentLineCharsMax,
  briefIntentLinesMax,
  briefLinkCharsMax,
  briefLinksMax,
  briefSchema,
} from "../../src/contract/brief.ts";
import { draftCreationSchema } from "../../src/contract/requests.ts";
import {
  proposalBodyCharsMax,
  proposalDisplayUrlCharsMax,
} from "../../src/interpreter/changeProposal.ts";
import { gitRefNameCharsMax } from "../../src/interpreter/finalizer.ts";
import {
  briefingLineCharsMax,
  briefingLinesMax,
} from "../../src/interpreter/taskConfiguration.ts";
import { authoringWireBody } from "./representations.ts";

test("every wire bound on a brief is the interpreter bound it was taken from", () => {
  assert.equal(briefIntentCharsMax, proposalBodyCharsMax);
  assert.equal(briefIntentLineCharsMax, briefingLineCharsMax);
  assert.equal(briefLinkCharsMax, proposalDisplayUrlCharsMax);
  assert.equal(briefLinksMax, briefingLinesMax);
  assert.equal(briefBranchCharsMax, gitRefNameCharsMax);
});

test("the lines an intent renders as are what its two bounds divide out to", () => {
  assert.ok(Number.isSafeInteger(briefIntentLinesMax));
  assert.equal(
    briefIntentLinesMax * briefIntentLineCharsMax,
    briefIntentCharsMax,
  );
});

test("a brief states an intent and bounds what it points at", () => {
  assert.deepEqual(
    briefSchema.parse({
      intent: "Serve the escalation reason on the ticket resource.",
      links: ["https://example.test/issues/340"],
      branch: `${briefBranchPrefix}rt/ticket-brief`,
    }),
    {
      intent: "Serve the escalation reason on the ticket resource.",
      links: ["https://example.test/issues/340"],
      branch: "refs/heads/rt/ticket-brief",
    },
  );
  assert.ok(briefSchema.safeParse({ intent: "Do it.", links: [] }).success);
});

test("a brief carrying no intent, an oversized one or an unreadable link is refused", () => {
  for (const value of [
    { intent: "", links: [] },
    { intent: "a".repeat(briefIntentCharsMax + 1), links: [] },
    { intent: "Do it.", links: ["http://example.test/one"] },
    { intent: "Do it.", links: ["ftp://example.test/one"] },
    {
      intent: "Do it.",
      links: [`https://example.test/${"a".repeat(briefLinkCharsMax)}`],
    },
    {
      intent: "Do it.",
      links: Array.from(
        { length: briefLinksMax + 1 },
        (_, at) => `https://example.test/${String(at)}`,
      ),
    },
    { intent: "Do it.", links: [], branch: "rt/ticket-brief" },
    {
      intent: "Do it.",
      links: [],
      branch: `${briefBranchPrefix}${"a".repeat(briefBranchCharsMax)}`,
    },
    { intent: "Do it.", links: [], unnamed: true },
  ])
    assert.equal(
      briefSchema.safeParse(value).success,
      false,
      `a brief is refused: ${JSON.stringify(value).slice(0, 80)}`,
    );
});

test("a draft creation names a brief beside its authoring and not inside it", () => {
  const body = {
    configurationRevision: "revision-one",
    configurationDigest: "a".repeat(64),
    expectedProjectSequence: 4,
    authoring: authoringWireBody,
    brief: { intent: "Do it.", links: [] },
  };
  assert.ok(draftCreationSchema.safeParse(body).success);
  assert.equal(
    draftCreationSchema.safeParse({
      ...body,
      brief: undefined,
    }).success,
    false,
    "a creation without a brief is refused",
  );
  assert.equal(
    draftCreationSchema.safeParse({
      ...body,
      brief: undefined,
      authoring: { ...authoringWireBody, intent: "Do it." },
    }).success,
    false,
    "an intent inside the authoring event is refused",
  );
});
