/**
 * The machine's task key, read back into the structure that named it.
 *
 * The cases that matter are the refusals: a key this console cannot read must
 * arrive as `Unreadable` carrying the key, because every other arm places a run
 * inside a cycle and a wrong placement is invisible to the reader.
 */

import { describe, expect, test } from "vitest";

import {
  ticketTaskKeyCycle,
  ticketTaskKeyNamesTicket,
  ticketTaskKeyParse,
  ticketTaskKeyTicket,
} from "../app/core/ticketTaskKey.ts";

describe("a key the machine wrote", () => {
  test("a work key names its ticket and its cycle", () => {
    expect(ticketTaskKeyParse("work:7:3")).toEqual({
      kind: "Work",
      ticket: 7,
      cycle: 3,
    });
  });

  test("an evaluation key names the work cycle it judged, not a cycle of its own", () => {
    const key = ticketTaskKeyParse("evaluation:7:3:1:2:0");

    expect(key).toEqual({
      kind: "Evaluation",
      ticket: 7,
      workCycle: 3,
      stage: 1,
      generation: 2,
      evaluator: 0,
    });
    expect(ticketTaskKeyCycle(key)).toBe(3);
  });

  test("a zero field is a field like any other", () => {
    expect(ticketTaskKeyParse("evaluation:7:1:0:0:0")).toMatchObject({
      stage: 0,
      generation: 0,
      evaluator: 0,
    });
  });
});

describe("a key this console cannot read", () => {
  test.each([
    ["an unknown prefix", "finalize:7:1"],
    ["a work key of the wrong width", "work:7"],
    ["a work key with a field too many", "work:7:1:2"],
    ["an evaluation key of the wrong width", "evaluation:7:1:0:0"],
    ["a padded field", "work:07:1"],
    ["a signed field", "work:7:-1"],
    ["a fractional field", "work:7:1.5"],
    ["an exponent field", "work:7:1e2"],
    ["an empty field", "work::1"],
    ["a field that is not a number at all", "work:seven:1"],
    ["nothing at all", ""],
  ])("%s is unreadable and carries the key", (_why, taskKey) => {
    expect(ticketTaskKeyParse(taskKey)).toEqual({
      kind: "Unreadable",
      taskKey,
    });
  });

  test("an unreadable key names no ticket and no cycle, rather than a guess", () => {
    const key = ticketTaskKeyParse("work:seven:1");

    expect(ticketTaskKeyTicket(key)).toBeUndefined();
    expect(ticketTaskKeyCycle(key)).toBeUndefined();
  });

  test("one illegible field makes the whole key unreadable", () => {
    expect(ticketTaskKeyParse("evaluation:7:3:1:2:x").kind).toBe("Unreadable");
  });
});

describe("whether a frame belongs to this ticket", () => {
  test("a key of this ticket does and another ticket's does not", () => {
    expect(ticketTaskKeyNamesTicket("work:7:1", 7)).toBe(true);
    expect(ticketTaskKeyNamesTicket("evaluation:7:1:0:0:0", 7)).toBe(true);
    expect(ticketTaskKeyNamesTicket("work:8:1", 7)).toBe(false);
  });

  test("a ticket number that is a prefix of another's is not this ticket", () => {
    expect(ticketTaskKeyNamesTicket("work:70:1", 7)).toBe(false);
  });

  test("an unreadable key belongs to no ticket", () => {
    expect(ticketTaskKeyNamesTicket("work:seven:1", 7)).toBe(false);
  });
});
