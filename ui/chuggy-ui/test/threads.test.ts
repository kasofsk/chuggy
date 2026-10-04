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
  threadActions,
  threadAnswering,
  threadHeldTurn,
  threadMine,
  threadUnhosted,
  threadRefusalCode,
  threadRefusalWord,
  threadSendFrom,
  threadSendStanding,
  threadTakesMessages,
  threadTurnKindWord,
  threadTurnMinted,
  threadTurnRetained,
  threadTurnsWait,
  threadWakeDrawn,
  threadWriting,
  threadsByStanding,
} from "../app/core/threads.ts";
import type { ThreadDoor } from "../app/core/threads.ts";
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

describe("the actions offered on the thread the pane holds", () => {
  test("the reader's own open thread offers Rename and Close", () => {
    expect(
      threadActions(threadEntry({ session: "s", mine: true })),
    ).toStrictEqual(["Rename", "Close"]);
  });

  test("the reader's own closed thread offers Rename alone", () => {
    expect(
      threadActions(threadEntry({ session: "s", mine: true, state: "Closed" })),
    ).toStrictEqual(["Rename"]);
  });

  test("a stranger's open thread offers Close alone", () => {
    expect(
      threadActions(threadEntry({ session: "s", mine: false })),
    ).toStrictEqual(["Close"]);
  });

  test("a stranger's closed thread offers nothing", () => {
    expect(
      threadActions(
        threadEntry({ session: "s", mine: false, state: "Closed" }),
      ),
    ).toStrictEqual([]);
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

  test("open threads come first, each standing most recent first", () => {
    const moved = [
      threadEntry({
        session: "closed-late",
        state: "Closed",
        lastActivityAt: "2026-09-03T10:00:00Z",
      }),
      threadEntry({
        session: "open-early",
        lastActivityAt: "2026-09-01T10:00:00Z",
      }),
      threadEntry({
        session: "orphaned",
        state: "Orphaned",
        lastActivityAt: "2026-09-04T10:00:00Z",
      }),
      threadEntry({
        session: "open-late",
        lastActivityAt: "2026-09-02T10:00:00Z",
      }),
      threadEntry({
        session: "closed-early",
        state: "Closed",
        lastActivityAt: "2026-08-30T10:00:00Z",
      }),
    ];
    expect(threadsByStanding(moved).map((thread) => thread.session)).toEqual([
      "open-late",
      "open-early",
      "orphaned",
      "closed-late",
      "closed-early",
    ]);
  });

  test("threads that tie keep the order the server gave", () => {
    expect(threadsByStanding(listed)).toEqual(listed);
  });

  test("a listing with none of mine has no thread of mine", () => {
    const others = listed.filter((thread) => !thread.mine);
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

  test("a send the hosted grant refuses stops the thread taking messages, whatever its status", () => {
    expect(
      threadSendFrom({
        outcome: "Rejected",
        code: "HostedRunsNotGranted",
        status: 403,
        body: undefined,
      }),
    ).toStrictEqual({ send: "Unhosted" });
    expect(
      threadSendFrom({
        outcome: "Rejected",
        code: "NotYourThread",
        status: 403,
        body: undefined,
      }),
    ).toStrictEqual({ send: "Unsettled", why: "Elsewhere" });
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

describe("whether a thread's session is writing", () => {
  test("it is while the newest turn is unsettled, whatever order the turns are held in", () => {
    const settled = turnOf({ turn: "thread-turn-1", ordinal: 1 });
    for (const state of ["Queued", "Claimed"] as const) {
      const newest = turnOf({ turn: "thread-turn-2", ordinal: 2, state });
      expect(threadWriting({ turns: [settled, newest] })).toBe(true);
      expect(threadWriting({ turns: [newest, settled] })).toBe(true);
    }
  });

  test("it is not once the newest turn settled, though an older one never did", () => {
    const stuck = turnOf({
      turn: "thread-turn-1",
      ordinal: 1,
      state: "Claimed",
    });
    const newest = turnOf({ turn: "thread-turn-2", ordinal: 2 });
    expect(threadWriting({ turns: [stuck, newest] })).toBe(false);
    expect(threadWriting({ turns: [newest, stuck] })).toBe(false);
    expect(threadWriting({ turns: [] })).toBe(false);
  });
});

test("only an open rejected for the hosted grant is one no retry answers", () => {
  expect(
    threadUnhosted({
      outcome: "Rejected",
      code: "HostedRunsNotGranted",
      status: 403,
      body: undefined,
    }),
  ).toBe(true);
  expect(
    threadUnhosted({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }),
  ).toBe(false);
  expect(
    threadUnhosted({
      outcome: "Conflict",
      code: "HostedRunsNotGranted",
      body: undefined,
    }),
  ).toBe(false);
});

function door(
  route: ThreadDoor["route"],
  granted: ThreadDoor["granted"],
  runner: ThreadDoor["runner"] = undefined,
  reads: ThreadDoor["reads"] = 1,
): ThreadDoor {
  return { route, granted, runner, reads };
}

/**
 * A grant read as withheld is said before a press, on a box that would take
 * one, where the route asks it; a grant not yet read, or given, or a route on
 * runners, says nothing; and a press's own answer is never written over by the
 * read.
 */
test("a composer is held for the grant only before a press, where it takes messages, the route asks it and the read said no", () => {
  const idle = { send: "Idle" } as const;
  expect(
    threadSendStanding(idle, true, door("InCluster", false)),
  ).toStrictEqual({ send: "Unhosted" });
  expect(threadSendStanding(idle, true, door(undefined, false))).toStrictEqual({
    send: "Unhosted",
  });
  expect(threadSendStanding(idle, true, door("Pool", false))).toStrictEqual(
    idle,
  );
  expect(threadSendStanding(idle, true, door("InCluster", true))).toStrictEqual(
    idle,
  );
  expect(
    threadSendStanding(idle, true, door("InCluster", undefined)),
  ).toStrictEqual(idle);
  expect(
    threadSendStanding(idle, false, door("InCluster", false)),
  ).toStrictEqual(idle);
  const waiting = { send: "Waiting", why: "Backlogged" } as const;
  expect(
    threadSendStanding(waiting, true, door("InCluster", false)),
  ).toStrictEqual(waiting);
});

/**
 * On runners the reader's own runner is said by its standing, before a press
 * and after one that landed, since a sent turn waits on it too; any other
 * press's answer stands, and a box that takes nothing says nothing.
 */
test("a composer on runners says the reader's runner where it cannot take a turn now", () => {
  const idle = { send: "Idle" } as const;
  const sent = { send: "Sent", ordinal: 2 } as const;
  expect(
    threadSendStanding(idle, true, door("Pool", false, "Unregistered")),
  ).toStrictEqual({ send: "NoRunner" });
  expect(
    threadSendStanding(sent, true, door("Pool", true, "Offline")),
  ).toStrictEqual({ send: "RunnerOffline" });
  expect(
    threadSendStanding(idle, true, door("Pool", false, "Live")),
  ).toStrictEqual(idle);
  expect(
    threadSendStanding(idle, true, door("InCluster", true, "Unregistered")),
  ).toStrictEqual(idle);
  expect(
    threadSendStanding(idle, false, door("Pool", true, "Unregistered")),
  ).toStrictEqual(idle);
  const refused = { send: "Refused", reason: "Bad" } as const;
  expect(
    threadSendStanding(refused, true, door("Pool", true, "Offline")),
  ).toStrictEqual(refused);
});

/** A press refused for the grant gives way to a read after the one it met
 * that says runners, and never to that read, however often it is drawn. */
test("a press refused for the grant gives way once a later read says runners", () => {
  const unhosted = { send: "Unhosted", readsAt: 1 } as const;
  expect(
    threadSendStanding(unhosted, true, door("Pool", false, "Live", 2)),
  ).toStrictEqual({ send: "Idle" });
  expect(
    threadSendStanding(unhosted, true, door("Pool", false, "Offline", 2)),
  ).toStrictEqual({ send: "RunnerOffline" });
  expect(
    threadSendStanding(unhosted, true, door("Pool", false, "Live", 1)),
  ).toStrictEqual(unhosted);
  expect(
    threadSendStanding(unhosted, true, door("InCluster", true, undefined, 2)),
  ).toStrictEqual(unhosted);
  expect(
    threadSendStanding(unhosted, true, door(undefined, true)),
  ).toStrictEqual(unhosted);
  const unstamped = { send: "Unhosted" } as const;
  expect(
    threadSendStanding(unstamped, true, door("Pool", false, "Live", 2)),
  ).toStrictEqual({ send: "Idle" });
});

test("a send refused for no runner is told apart from any other refusal", () => {
  const rejected = (code: string) =>
    ({ outcome: "Rejected", code, status: 403, body: undefined }) as const;
  expect(threadSendFrom(rejected("NoRunner"))).toStrictEqual({
    send: "NoRunner",
  });
  expect(threadSendFrom(rejected("HostedRunsNotGranted"))).toStrictEqual({
    send: "Unhosted",
  });
});

test("a queued turn waits on the runner only where the route is runners' and the reader's cannot take it", () => {
  expect(threadTurnsWait(door("Pool", true, "Offline"))).toBe(true);
  expect(threadTurnsWait(door("Pool", true, "Unregistered"))).toBe(true);
  expect(threadTurnsWait(door("Pool", true, "Live"))).toBe(false);
  expect(threadTurnsWait(door("InCluster", true, "Offline"))).toBe(false);
  expect(threadTurnsWait(door(undefined, true, "Offline"))).toBe(false);
  expect(threadTurnsWait(door("Pool", true, undefined))).toBe(false);
});
