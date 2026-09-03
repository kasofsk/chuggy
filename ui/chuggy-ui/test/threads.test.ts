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
  sessionTurnInputKinds,
  sessionTurnStates,
  threadStandings,
} from "../../../src/contract/rosters.ts";
import type { ThreadTurnResponse } from "../../../src/contract/responses.ts";
import {
  threadMine,
  threadOlderAsked,
  threadOlderEmpty,
  threadOlderGathered,
  threadRefusalWord,
  threadSendFrom,
  threadTakesMessages,
  threadTurnAnswer,
  threadTurnKindWord,
  threadTurnMinted,
  threadTurnRetained,
  threadTurnsDrawn,
  threadTurnsHeldMax,
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
  test("every standing the wire carries has a tone the pill can draw", () => {
    for (const standing of threadStandings)
      expect(pillTones).toContain(threadStandingTone(standing));
  });

  /** Only an open thread takes a message, and a composer offered on either of
   * the others is a box a member types into to earn a refusal. */
  test("an open thread takes messages and no other standing does", () => {
    for (const state of threadStandings)
      expect(threadTakesMessages({ state })).toBe(state === "Open");
  });

  test("Orphaned is drawn in the hue that asks for attention, not the live one", () => {
    expect(threadStandingTone("Orphaned")).toBe("parked");
    expect(threadStandingTone("Open")).toBe("live");
  });
});

describe("the word a turn's kind is drawn as", () => {
  test("every kind the wire carries answers a word, and a member's is Message", () => {
    for (const kind of sessionTurnInputKinds)
      expect(threadTurnKindWord(kind).length).toBeGreaterThan(0);
    expect(threadTurnKindWord("UserMessage")).toBe("Message");
    expect(threadTurnKindWord("Wake")).toBe("Wake");
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

describe("walking a mailbox backwards", () => {
  const newest = {
    turns: [turnOf({ turn: "t-9", ordinal: 9 })],
    nextBefore: 9,
  };

  test("the walk starts at the newest read's own cursor and follows the pages'", () => {
    expect(threadOlderAsked(threadOlderEmpty, newest)).toBe(9);
    const gathered = threadOlderGathered(threadOlderEmpty, {
      turns: [turnOf({ turn: "t-8", ordinal: 8 })],
      nextBefore: 8,
    });
    expect(threadOlderAsked(gathered, newest)).toBe(8);
  });

  test("a page with no cursor is the first turn and stops the walk", () => {
    const gathered = threadOlderGathered(threadOlderEmpty, {
      turns: [turnOf({ turn: "t-1", ordinal: 1 })],
    });
    expect(threadOlderAsked(gathered, newest)).toBeUndefined();
  });

  test("the walk stops rather than dropping what the reader gathered", () => {
    const many = {
      turns: Array.from({ length: threadTurnsHeldMax }, (_unused, at) =>
        turnOf({ turn: `older-${String(at)}`, ordinal: at + 1 }),
      ),
      before: 1,
      failure: undefined,
    };
    expect(threadOlderAsked(many, newest)).toBeUndefined();
    expect(threadTurnsDrawn(many, newest).length).toBe(threadTurnsHeldMax + 1);
  });

  /** The newest page is re-read on a frame while a gathered page is not, so a
   * turn in both must be drawn as the later read left it — a page keeping the
   * gathered copy would show a turn answered hours ago as still queued. */
  test("a turn in both pages is drawn as the newest read has it", () => {
    const gathered = threadOlderGathered(threadOlderEmpty, {
      turns: [turnOf({ turn: "t-8", ordinal: 8, state: "Queued" })],
      nextBefore: 7,
    });
    const drawn = threadTurnsDrawn(gathered, {
      turns: [turnOf({ turn: "t-8", ordinal: 8, state: "Answered" })],
    });
    expect(drawn.map((turn) => turn.state)).toStrictEqual(["Answered"]);
  });

  test("every turn is drawn once and in the mailbox's own order", () => {
    const gathered = threadOlderGathered(threadOlderEmpty, {
      turns: [
        turnOf({ turn: "t-7", ordinal: 7 }),
        turnOf({ turn: "t-8", ordinal: 8 }),
      ],
      nextBefore: 7,
    });
    const drawn = threadTurnsDrawn(gathered, {
      turns: [
        turnOf({ turn: "t-8", ordinal: 8 }),
        turnOf({ turn: "t-9", ordinal: 9 }),
      ],
    });
    expect(drawn.map((turn) => turn.ordinal)).toStrictEqual([7, 8, 9]);
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
  test("an accepted message answers the ordinal it took", () => {
    expect(
      threadSendFrom({ outcome: "Ok", value: { turn: "t", ordinal: 4 } }),
    ).toStrictEqual({ send: "Sent", ordinal: 4 });
  });

  /** A conflict is the end of the composer whichever refusal it is, and the
   * envelope's code is what says which — so a sixth the door grows draws its
   * own name rather than the one word a console roster happened to hold. */
  test("every conflict the door states ends the composer and says which", () => {
    expect(
      threadSendFrom({
        outcome: "Conflict",
        code: "ThreadClosed",
        body: undefined,
      }),
    ).toStrictEqual({ send: "Ended", why: "Closed" });
    expect(
      threadSendFrom({
        outcome: "Conflict",
        code: "ThreadOrphaned",
        body: undefined,
      }),
    ).toStrictEqual({ send: "Ended", why: "Orphaned" });
    expect(
      threadSendFrom({
        outcome: "Conflict",
        code: "Whatever",
        body: undefined,
      }),
    ).toStrictEqual({ send: "Ended", why: "Whatever" });
  });

  /**
   * `classify` answers `Retryable` for a 503 as well as a 429, so a wait drawn
   * as one fixed word would report an outage as a mailbox that is full.
   */
  test("a wait says which wait it is", () => {
    expect(
      threadSendFrom({
        outcome: "Retryable",
        code: "ThreadBacklogged",
        retryAfterSeconds: 9,
      }),
    ).toStrictEqual({ send: "Waiting", why: "Backlogged" });
    expect(
      threadSendFrom({
        outcome: "Retryable",
        code: "Unavailable",
        retryAfterSeconds: 9,
      }),
      "a service outage was drawn as a backlogged mailbox",
    ).toStrictEqual({ send: "Waiting", why: "Unavailable" });
  });

  test("a code the console has no word for is drawn as the code", () => {
    expect(threadRefusalWord("SomethingNew")).toBe("SomethingNew");
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
