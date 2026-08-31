/**
 * The tone every state of the machine is drawn in.
 *
 * Each map is walked over its whole roster, so a member the wire gains fails
 * here at run time as well as at the compiler, and the arms a stage row has
 * without a set are checked by name: a stage that was short-circuited and one
 * that has not started are different facts and are not allowed to draw alike.
 */

import { expect, test } from "vitest";

import { phaseRoster } from "../../../src/contract/rosters.ts";
import {
  pillTones,
  phaseTone,
  stageArm,
  standingTone,
  verdictTone,
} from "../app/core/tones.ts";
import type { SetVerdict } from "../app/core/ticketLedger.ts";

const verdicts: readonly SetVerdict[] = [
  "Passed",
  "Failed",
  "Running",
  "Cancelled",
  "Blocked",
];

test("every phase, verdict and standing draws a tone the pill knows", () => {
  for (const phase of phaseRoster)
    expect(pillTones).toContain(phaseTone(phase));
  for (const verdict of verdicts)
    expect(pillTones).toContain(verdictTone(verdict));
  expect(standingTone("Current")).toBe("live");
  expect(standingTone("Superseded")).toBe("retired");
});

test("the machine's own meanings keep their own hues", () => {
  expect(phaseTone("Escalated")).toBe("parked");
  expect(phaseTone("HandoffBlocked")).toBe("parked");
  expect(phaseTone("Evaluating")).toBe("live");
  expect(phaseTone("Pending")).toBe("queued");
  expect(phaseTone("Done")).toBe("pass");
  expect(phaseTone("Revoked")).toBe("retired");
  expect(verdictTone("Passed")).toBe("pass");
  expect(verdictTone("Failed")).toBe("fail");
  expect(verdictTone("Running")).toBe("live");
  expect(verdictTone("Blocked")).toBe("retired");
});

test("each arm a stage has without a set is its own word and its own tone", () => {
  expect(stageArm({ kind: "Skipped", stage: 1, after: 0 })).toEqual({
    word: "Skipped",
    tone: "retired",
  });
  expect(stageArm({ kind: "Queued", stage: 1, after: 0 })).toEqual({
    word: "Queued",
    tone: "queued",
  });
  expect(stageArm({ kind: "Missing", stage: 1 })).toEqual({
    word: "Missing",
    tone: "parked",
  });
  expect(
    stageArm({
      kind: "Ran",
      stage: 0,
      set: {
        executions: [],
        expected: 1,
        verdict: "Failed",
        span: { from: undefined, to: undefined },
      },
    }),
  ).toEqual({ word: "Failed", tone: "fail" });
});
