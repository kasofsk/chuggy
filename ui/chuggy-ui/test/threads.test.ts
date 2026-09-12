/**
 * The thread pages' decisions, with no renderer: where a thread stands, which
 * turn identity a press posts under, and what a document that is not a wake
 * reads as.
 *
 * Every roster the pages draw a word from is walked here, because a page that
 * draws one state and is asserted on that state alone says nothing about the
 * one nobody wrote a case for.
 */

import { describe, expect, test } from "vitest";

import {
  sessionTurnInputKinds,
  threadMessageRefusalCodes,
  threadStandings,
} from "../../../src/contract/rosters.ts";
import type { ThreadTurnResponse } from "../../../src/contract/responses.ts";
import {
  threadAnswering,
  threadHeldTurn,
  threadMine,
  threadRefusalCode,
  threadRefusalWord,
  threadRowActions,
  threadSendFrom,
  threadTakesMessages,
  threadTurnKindWord,
  threadTurnMinted,
  threadTurnRetained,
  threadWakeDrawn,
  threadsMineFirst,
} from "../app/core/threads.ts";
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
  /** Only an open thread takes a message, and a composer offered on either of
   * the others is a box a member types into to earn a refusal. */
  test("an open thread takes messages and no other standing does", () => {
    for (const state of threadStandings)
      expect(threadTakesMessages({ state })).toBe(state === "Open");
  });
});

describe("the actions one row's menu offers", () => {
  test("the reader's own open thread offers Rename, Close and Hide", () => {
    expect(
      threadRowActions(threadEntry({ session: "s", mine: true })),
    ).toStrictEqual(["Rename", "Close", "Hide"]);
  });

  test("the reader's own closed thread offers Rename and Hide, not Close", () => {
    expect(
      threadRowActions(
        threadEntry({ session: "s", mine: true, state: "Closed" }),
      ),
    ).toStrictEqual(["Rename", "Hide"]);
  });

  test("the reader's own hidden thread offers Show in Hide's place", () => {
    expect(
      threadRowActions(threadEntry({ session: "s", mine: true, hidden: true })),
    ).toStrictEqual(["Rename", "Close", "Show"]);
  });

  test("a stranger's open thread offers Close alone", () => {
    expect(
      threadRowActions(threadEntry({ session: "s", mine: false })),
    ).toStrictEqual(["Close"]);
  });

  test("a stranger's closed thread offers nothing — no trigger is drawn", () => {
    expect(
      threadRowActions(
        threadEntry({ session: "s", mine: false, state: "Closed" }),
      ),
    ).toStrictEqual([]);
  });

  test("a stranger's hidden thread still offers Close alone — Show is the owner's", () => {
    expect(
      threadRowActions(
        threadEntry({ session: "s", mine: false, hidden: true }),
      ),
    ).toStrictEqual(["Close"]);
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

  /** A closed thread is readable and still mine, but it is not the thread an
   * Open is withheld for: the member's next thread is a new session. */
  test("a closed thread of mine is not the one I hold", () => {
    const ended = threadEntry({
      session: "thread-geoff-old",
      mine: true,
      state: "Closed",
    });
    expect(threadMine([ended, ...listed.filter((t) => !t.mine)])).toBe(
      undefined,
    );
    expect(threadMine([ended, ...listed])?.session).toBe("thread-geoff");
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

describe("whether a thread is still answering", () => {
  test("a queued or a claimed turn is answering, and a settled one is not", () => {
    expect(threadAnswering({ turns: [turnOf({ state: "Queued" })] })).toBe(
      true,
    );
    expect(threadAnswering({ turns: [turnOf({ state: "Claimed" })] })).toBe(
      true,
    );
    expect(threadAnswering({ turns: [turnOf({ state: "Answered" })] })).toBe(
      false,
    );
    expect(threadAnswering({ turns: [] })).toBe(false);
  });
});
