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
  threadMessageRefusalCodes,
  threadStandings,
} from "../../../src/contract/rosters.ts";
import type { ThreadTurnResponse } from "../../../src/contract/responses.ts";
import {
  threadHeldTurn,
  threadMine,
  threadOlderAsked,
  threadOlderEmpty,
  threadOlderGathered,
  threadOlderHeld,
  threadRefusalCode,
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

  test("the walk follows the pages' own cursors once it has started", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      { turns: [turnOf({ turn: "t-8", ordinal: 8 })], nextBefore: 8 },
      newest,
    );
    expect(threadOlderAsked(gathered, newest)).toBe(8);
  });

  test("a page with no cursor is the first turn and stops the walk", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      { turns: [turnOf({ turn: "t-1", ordinal: 1 })] },
      newest,
    );
    expect(threadOlderAsked(gathered, newest)).toBeUndefined();
  });

  test("the walk stops rather than dropping what the reader gathered", () => {
    const many = {
      turns: Array.from({ length: threadTurnsHeldMax }, (_unused, at) =>
        turnOf({ turn: `older-${String(at)}`, ordinal: at + 1 }),
      ),
      before: 1,
      seam: 9,
      failure: undefined,
    };
    expect(threadOlderAsked(many, newest)).toBeUndefined();
    expect(threadTurnsDrawn(many, newest).length).toBe(threadTurnsHeldMax + 1);
  });

  /**
   * ONLY THE NEWEST PAGE MOVES, AND MOVING SLIDES ITS CURSOR. Everything
   * gathered sits below the cursor the walk began at, so a read whose cursor has
   * moved leaves the turn that was the boundary in neither range — and drawing
   * the union then omits a turn from the middle of a member's own conversation
   * and offers no cursor that reaches it.
   */
  test("a tail that slid past the seam drops what was gathered behind it", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      { turns: [turnOf({ turn: "t-7", ordinal: 7 })], nextBefore: 7 },
      newest,
    );
    const slid = {
      turns: [turnOf({ turn: "t-10", ordinal: 10 })],
      nextBefore: 10,
    };
    const held = threadOlderHeld(gathered, slid);
    expect(held).toStrictEqual(threadOlderEmpty);
    expect(
      threadTurnsDrawn(held, slid).map((turn) => turn.ordinal),
      "a tail that slid was drawn beside a set gathered behind the old seam",
    ).toStrictEqual([10]);
    expect(
      threadOlderAsked(held, slid),
      "a dropped walk was left with no cursor to re-ask from",
    ).toBe(10);
  });

  test("a tail that has not moved keeps what was gathered behind it", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      { turns: [turnOf({ turn: "t-8", ordinal: 8 })], nextBefore: 8 },
      newest,
    );
    expect(threadOlderHeld(gathered, newest)).toStrictEqual(gathered);
  });

  test("a walk that has gathered nothing asks from the newest read", () => {
    expect(threadOlderAsked(threadOlderEmpty, newest)).toBe(9);
  });
});

describe("a tail that slid under a walk", () => {
  const newest = {
    turns: [turnOf({ turn: "t-9", ordinal: 9 })],
    nextBefore: 9,
  };

  test("a walk that has gathered nothing is never dropped", () => {
    expect(threadOlderHeld(threadOlderEmpty, { nextBefore: 41 })).toStrictEqual(
      threadOlderEmpty,
    );
  });

  /** A page answered with a cursor and no turns has still moved the walk, so
   * the seam and not the turn count is what says the walk has started. */
  test("an empty page with a cursor still moves the walk on", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      { turns: [], nextBefore: 4 },
      newest,
    );
    expect(threadOlderAsked(gathered, newest)).toBe(4);
  });
});

describe("what the page draws of a walked mailbox", () => {
  const newest = {
    turns: [turnOf({ turn: "t-9", ordinal: 9 })],
    nextBefore: 9,
  };

  /** The bound is on what the page HOLDS, and a turn in both pages is one turn.
   * Adding the two lengths counts it twice and stops the reader a page early. */
  test("the held bound counts a shared turn once", () => {
    const shared = turnOf({ turn: "t-9", ordinal: 9 });
    const nearly = {
      turns: [
        ...Array.from({ length: threadTurnsHeldMax - 2 }, (_unused, at) =>
          turnOf({ turn: `older-${String(at)}`, ordinal: at + 1 }),
        ),
        shared,
      ],
      before: 1,
      seam: 9,
      failure: undefined,
    };
    const abutting = { turns: [shared], nextBefore: 9 };
    expect(threadTurnsDrawn(nearly, abutting).length).toBe(
      threadTurnsHeldMax - 1,
    );
    expect(
      threadOlderAsked(nearly, abutting),
      "a turn held by both pages was counted twice against the bound",
    ).toBe(1);
  });

  /** The newest page is re-read on a frame while a gathered page is not, so a
   * turn in both must be drawn as the later read left it — a page keeping the
   * gathered copy would show a turn answered hours ago as still queued. */
  test("a turn in both pages is drawn as the newest read has it", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      {
        turns: [turnOf({ turn: "t-8", ordinal: 8, state: "Queued" })],
        nextBefore: 7,
      },
      newest,
    );
    const drawn = threadTurnsDrawn(gathered, {
      turns: [turnOf({ turn: "t-8", ordinal: 8, state: "Answered" })],
    });
    expect(drawn.map((turn) => turn.state)).toStrictEqual(["Answered"]);
  });

  test("every turn is drawn once and in the mailbox's own order", () => {
    const gathered = threadOlderGathered(
      threadOlderEmpty,
      {
        turns: [
          turnOf({ turn: "t-7", ordinal: 7 }),
          turnOf({ turn: "t-8", ordinal: 8 }),
        ],
        nextBefore: 7,
      },
      newest,
    );
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
});

describe("a door whose answer does not say what happened", () => {
  /**
   * The door resolves the mailbox from the caller's principal and compares the
   * URL afterwards, so a 403 can arrive after the turn was enqueued. Reporting
   * it as a refusal would drop a message the thread already holds.
   */
  test("a NotYourThread is unsettled rather than refused", () => {
    expect(
      threadSendFrom({
        outcome: "Rejected",
        code: "NotYourThread",
        status: 403,
        body: undefined,
      }),
      "a refusal the door may have raised after enqueuing was treated as final",
    ).toStrictEqual({ send: "Unsettled", why: "Elsewhere" });
  });

  /**
   * THE SPELLING THIS CONSOLE ACTS ON IS THE CONTRACT'S AND NOT ITS OWN. A door
   * that renamed the code while this compared the old one would tell a member
   * their message was refused for a turn the mailbox already holds — so the
   * literal the settlement turns on is asserted to be a member of the roster,
   * and the roster is what the door reads too.
   */
  test("the code the settlement turns on is the roster's own member", () => {
    expect(
      threadMessageRefusalCodes as readonly string[],
      "the console settles on a code the contract's roster does not carry",
    ).toContain("NotYourThread");
    expect(threadRefusalCode("NotYourThread")).toBe("NotYourThread");
  });
});

describe("the door's own vocabulary", () => {
  /**
   * THE WORDS ARE A SWITCH TOTAL OVER THE ROSTER, so a code the roster renames
   * stops the module compiling — and one it grows has no word until somebody
   * writes it. The case names each word, because a roster walk asserting only
   * that a word exists would pass over two codes drawn as one noun.
   */
  test("every code the roster carries is drawn as its own word", () => {
    const said = threadMessageRefusalCodes.map((code) => [
      code,
      threadRefusalWord(code),
    ]);
    expect(said).toStrictEqual([
      ["NotYourThread", "Elsewhere"],
      ["ThreadClosed", "Closed"],
      ["ThreadOrphaned", "Orphaned"],
      ["ThreadBacklogged", "Backlogged"],
      ["ThreadTurnTooLarge", "Oversize"],
    ]);
    expect(
      new Set(said.map(([, word]) => word)).size,
      "two of the door's codes are drawn as one word",
    ).toBe(threadMessageRefusalCodes.length);
  });

  test("every code the roster carries is narrowed to itself", () => {
    for (const code of threadMessageRefusalCodes)
      expect(threadRefusalCode(code)).toBe(code);
  });

  /** A code the roster does not carry is one this console neither acts on nor
   * has a noun for, so it is drawn as the name the server sent. */
  test("a code outside the roster is its own word and narrows to nothing", () => {
    for (const code of ["ThreadNotYours", "ThreadRetired"]) {
      expect(threadRefusalCode(code)).toBeUndefined();
      expect(threadRefusalWord(code)).toBe(code);
    }
  });

  /** A door that renamed the code answers a rejection this console reports
   * rather than settles, which is the arm it must not silently take. */
  test("a rejection whose code the roster lacks is refused, not unsettled", () => {
    expect(
      threadSendFrom({
        outcome: "Rejected",
        code: "ThreadNotYours",
        status: 403,
        body: undefined,
      }).send,
    ).toBe("Refused");
  });

  test("every other rejection is one refusal with a reason", () => {
    const refused = threadSendFrom({
      outcome: "Rejected",
      code: "MessageTooLong",
      status: 400,
      body: undefined,
    });
    expect(refused.send).toBe("Refused");
    expect(refused.send === "Refused" ? refused.reason : "").toContain(
      "MessageTooLong",
    );
  });

  /** The mailbox tail is the only thing that says whether the turn landed. */
  test("a mailbox holding the turn is what settles it", () => {
    const turn = turnOf({ turn: "thread-turn-a", ordinal: 7 });
    expect(threadHeldTurn({ turns: [turn] }, "thread-turn-a")?.ordinal).toBe(7);
    expect(threadHeldTurn({ turns: [turn] }, "thread-turn-b")).toBeUndefined();
  });
});
