/**
 * The tone every state of the machine is drawn in.
 *
 * Each map is walked over its whole roster, so a member the wire gains fails
 * here at run time as well as at the compiler, and the arms a stage row has
 * without a set are checked by name: a stage that was short-circuited and one
 * that has not started are different facts and are not allowed to draw alike.
 */

import { expect, test } from "vitest";

import {
  executionOutcomes,
  executionStatuses,
  phaseRoster,
} from "../../../src/contract/rosters.ts";
import {
  conversationStandingArm,
  executionTone,
  pillTones,
  phaseTone,
  stageArm,
  verdictTone,
} from "../app/core/tones.ts";
import type { SetVerdict } from "../app/core/ticketLedger.ts";

const verdicts: readonly SetVerdict[] = [
  "Passed",
  "Failed",
  "Starting",
  "Running",
  "Cancelled",
  "Blocked",
];

test("every phase and verdict draws a tone the pill knows", () => {
  for (const phase of phaseRoster)
    expect(pillTones).toContain(phaseTone(phase));
  for (const verdict of verdicts)
    expect(pillTones).toContain(verdictTone(verdict));
});

test("the machine's own meanings keep their own hues", () => {
  expect(phaseTone("Escalated")).toBe("parked");
  expect(phaseTone("Evaluation")).toBe("live");
  expect(phaseTone("Pending")).toBe("queued");
  expect(phaseTone("Done")).toBe("pass");
  expect(phaseTone("Revoked")).toBe("retired");
  expect(verdictTone("Passed")).toBe("pass");
  expect(verdictTone("Failed")).toBe("fail");
  expect(verdictTone("Starting")).toBe("queued");
  expect(verdictTone("Running")).toBe("live");
  expect(verdictTone("Blocked")).toBe("retired");
});

test("each arm a stage has without evaluators is its own word and its own tone", () => {
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
      evaluators: [],
      expected: 1,
      verdict: "Failed",
      span: { from: undefined, to: undefined },
    }),
  ).toEqual({ word: "Failed", tone: "fail" });
});

test("every execution status and every outcome draws a tone the pill knows", () => {
  for (const status of executionStatuses)
    expect(pillTones).toContain(executionTone(status, undefined));
  for (const outcome of executionOutcomes)
    expect(pillTones).toContain(executionTone("Terminal", outcome));
});

test("each standing the arm draws is its own word and its own tone", () => {
  expect(conversationStandingArm({ standing: "Answered" }, true)).toEqual({
    word: "Answered",
    tone: "pass",
  });
  expect(
    conversationStandingArm({ standing: "Running", state: "Queued" }, false),
  ).toEqual({ word: "Queued", tone: "queued" });
  expect(
    conversationStandingArm({ standing: "Running", state: "Waiting" }, false),
  ).toEqual({ word: "Waiting", tone: "parked" });
  expect(
    conversationStandingArm(
      { standing: "Failed", failure: "AgentFailed" },
      true,
    ),
  ).toEqual({ word: "Failed", tone: "fail" });
  expect(conversationStandingArm({ standing: "Abandoned" }, true)).toEqual({
    word: "Abandoned",
    tone: "retired",
  });
  expect(conversationStandingArm({ standing: "Open" }, true)).toEqual({
    word: "Open",
    tone: "live",
  });
});

test("a turn a runner has is starting until something has come of it, and working from then", () => {
  const claimed = { standing: "Running", state: "Claimed" } as const;
  expect(conversationStandingArm(claimed, false)).toEqual({
    word: "Starting",
    tone: "live",
  });
  expect(conversationStandingArm(claimed, true)).toEqual({
    word: "Working",
    tone: "live",
  });
});

test("a turn nobody has taken is called the same whatever was heard of it before", () => {
  for (const state of ["Queued", "Waiting"] as const)
    expect(
      conversationStandingArm({ standing: "Running", state }, true).word,
    ).toBe(state);
});
