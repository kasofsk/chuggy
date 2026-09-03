/**
 * The thread pages' decisions, with no renderer: where a thread stands, which
 * turn identity a press posts under, what a turn is waiting for, and what a
 * document that is not a wake reads as.
 *
 * Every roster the pages draw a word from is walked here, because a page that
 * draws one state and is asserted on that state alone says nothing about the
 * one nobody wrote a case for.
 */

import { describe, expect, test } from "vitest";

import {
  sessionStates,
  sessionTurnStates,
} from "../../../src/contract/rosters.ts";
import type { ThreadTurnResponse } from "../../../src/contract/responses.ts";
import {
  threadMine,
  threadSendFrom,
  threadStanding,
  threadStandings,
  threadTurnAnswer,
  threadTurnMinted,
  threadTurnRetained,
  threadWakeDrawn,
  threadsMineFirst,
} from "../app/core/threads.ts";
import { threadStandingTone } from "../app/core/tones.ts";
import { pillTones } from "../app/core/tones.ts";
import { threadEntry, threadWakeInput } from "./threadFixture.ts";

function turnOf(turn: Partial<ThreadTurnResponse>): ThreadTurnResponse {
  return {
    turn: "thread-turn-1",
    ordinal: 1,
    inputKind: "UserMessage",
    state: "Answered",
    input: "asked",
    ...turn,
  };
}

describe("where a thread stands", () => {
  test("an open thread with no owner is Orphaned and every other is its state", () => {
    for (const state of sessionStates) {
      expect(threadStanding({ state, owner: "geoff" })).toBe(state);
      expect(threadStanding({ state, owner: undefined })).toBe(
        state === "Open" ? "Orphaned" : state,
      );
    }
  });

  test("every standing has a tone the pill can draw", () => {
    for (const standing of threadStandings)
      expect(pillTones).toContain(threadStandingTone(standing));
  });
});

describe("the listing's order", () => {
  const listed = [
    threadEntry({ session: "thread-ada" }),
    threadEntry({ session: "thread-geoff", mine: true }),
    threadEntry({ session: "thread-lee" }),
  ];

  test("mine comes first and the rest keep the order the server gave", () => {
    expect(threadsMineFirst(listed).map((thread) => thread.session)).toEqual([
      "thread-geoff",
      "thread-ada",
      "thread-lee",
    ]);
  });

  test("a listing with none of mine is left as it stands", () => {
    const others = listed.filter((thread) => !thread.mine);
    expect(threadsMineFirst(others)).toEqual(others);
    expect(threadMine(others)).toBeUndefined();
  });
});

describe("what a turn is waiting for", () => {
  test("every turn state answers, and only a settled one carries a result", () => {
    for (const state of sessionTurnStates) {
      const answer = threadTurnAnswer(turnOf({ state, result: "said" }));
      expect(answer.answer).toBe(
        state === "Queued" || state === "Claimed" ? "Awaiting" : "Result",
      );
    }
  });

  test("a settled turn with no result says how it failed, or nothing", () => {
    expect(
      threadTurnAnswer(turnOf({ state: "Failed", failure: "AgentFailed" })),
    ).toStrictEqual({ answer: "Failure", failure: "AgentFailed" });
    expect(threadTurnAnswer(turnOf({ state: "Abandoned" }))).toStrictEqual({
      answer: "None",
    });
  });
});

describe("a wake read for its pointer", () => {
  test("a document names its reason and its resource", () => {
    expect(threadWakeDrawn(threadWakeInput("TicketRefused", "41"))).toEqual({
      wake: "TicketRefused",
      resource: "41",
    });
  });

  test("anything that is not one reads as nothing at all", () => {
    for (const said of [
      "",
      "a member's message",
      "{",
      JSON.stringify({ wake: "TicketRefused" }),
      JSON.stringify({ wake: "", resource: "41" }),
      JSON.stringify([1, 2]),
      JSON.stringify(null),
    ])
      expect(threadWakeDrawn(said), said).toBeUndefined();
  });
});

describe("the turn a press posts under", () => {
  test("a minted identity says what door it came through", () => {
    expect(
      threadTurnMinted(new Uint8Array([1, 2, 3])).startsWith("thread-turn-"),
    ).toBe(true);
  });

  test("unchanged text keeps the identity and edited text releases it", () => {
    const held = { text: "one more", turn: "thread-turn-a" };
    expect(threadTurnRetained(held, "one more")).toBe("thread-turn-a");
    expect(threadTurnRetained(held, "one more, and")).toBeUndefined();
    expect(threadTurnRetained(undefined, "one more")).toBeUndefined();
  });
});

describe("what a press ended as", () => {
  test("the three the door states are drawn as themselves", () => {
    expect(
      threadSendFrom({ outcome: "Ok", value: { turn: "t", ordinal: 4 } }),
    ).toStrictEqual({ send: "Sent", ordinal: 4 });
    expect(
      threadSendFrom({
        outcome: "Retryable",
        code: "ThreadBacklogged",
        retryAfterSeconds: 9,
      }),
    ).toStrictEqual({ send: "Backlogged", retryAfterSeconds: 9 });
    expect(
      threadSendFrom({
        outcome: "Conflict",
        code: "ThreadClosed",
        body: undefined,
      }).send,
    ).toBe("Closed");
  });

  test("a door that refused another member's thread is one refusal with a reason", () => {
    const refused = threadSendFrom({
      outcome: "Rejected",
      code: "NotYourThread",
      status: 403,
      body: undefined,
    });
    expect(refused.send).toBe("Refused");
    expect(refused.send === "Refused" ? refused.reason : "").toContain(
      "NotYourThread",
    );
  });
});
