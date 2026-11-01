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
  sessionTurnStates,
  threadLimitReachedCode,
  threadMessageRefusalCodes,
  threadStandings,
} from "../../../src/contract/rosters.ts";
import {
  threadBacklogMax,
  threadOpenKeyCharsMax,
  threadOpenKeyPattern,
} from "../../../src/contract/http.ts";
import type { ThreadTurnResponse } from "../../../src/contract/responses.ts";
import {
  threadActions,
  threadKeptClosed,
  threadKeptWith,
  threadSendBegan,
  threadSendEnded,
  threadSendFirstLeft,
  threadSendOpened,
  threadSendRecordEmpty,
  threadSendRecordWith,
  threadSendTaken,
  threadSendTurnsNamed,
  threadOpenAtLimit,
  threadOpenKeyBytesCount,
  threadOpenKeyMinted,
  threadUnhosted,
  threadRefusalCode,
  threadRefusalLine,
  threadRefusalWord,
  threadSendFrom,
  threadUploadRefused,
  threadSendingWith,
  threadSendingWithout,
  threadSendStanding,
  threadStopFrom,
  threadStopPressedOn,
  threadStopTakenBack,
  threadStoppingWith,
  threadStoppingWithout,
  threadStoreDue,
  threadTakesMessages,
  threadTurnKindWord,
  threadTurnMinted,
  threadTurnRetained,
  threadTurnsEnded,
  threadTurnsWait,
  threadWakeDrawn,
  threadWriting,
  threadsByStanding,
} from "../app/core/threads.ts";
import type {
  ThreadDoor,
  ThreadSending,
  ThreadSendRecord,
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
    const held = { text: "one more", attached: [], turn: "thread-turn-a" };
    expect(threadTurnRetained(held, { text: "one more", attached: [] })).toBe(
      "thread-turn-a",
    );
    expect(
      threadTurnRetained(held, { text: "one more, and", attached: [] }),
    ).toBeUndefined();
    expect(
      threadTurnRetained(undefined, { text: "one more", attached: [] }),
    ).toBeUndefined();
  });

  test("the same images keep the identity, and attaching one or removing one releases it", () => {
    const shot = { mediaType: "image/png", content: new Uint8Array([1]) };
    const other = { mediaType: "image/png", content: new Uint8Array([1]) };
    const held = { text: "see", attached: [shot], turn: "thread-turn-a" };
    expect(threadTurnRetained(held, { text: "see", attached: [shot] })).toBe(
      "thread-turn-a",
    );
    expect(
      threadTurnRetained(held, { text: "see", attached: [shot, other] }),
    ).toBeUndefined();
    expect(
      threadTurnRetained(held, { text: "see", attached: [] }),
    ).toBeUndefined();
    expect(
      threadTurnRetained(held, { text: "see", attached: [other] }),
    ).toBeUndefined();
  });
});

describe("the messages a page sent that its mailbox does not list yet", () => {
  const first = { turn: "thread-turn-a", text: "one" };
  const second = { turn: "thread-turn-b", text: "two" };

  test("are held in the order sent, each turn once", () => {
    const held = threadSendingWith(threadSendingWith([], first), second);
    expect(held).toStrictEqual([first, second]);
    expect(threadSendingWith(held, first)).toStrictEqual([second, first]);
  });

  test("are no more than the mailbox takes turns, and a press past that is not held", () => {
    let held: readonly ThreadSending[] = [];
    for (let at = 0; at < threadBacklogMax; at += 1)
      held = threadSendingWith(held, { turn: `turn-${at}`, text: "again" });
    expect(held).toHaveLength(threadBacklogMax);
    expect(threadSendingWith(held, first)).toBe(held);
  });

  test("leave with the turns named, and are the same list where none of theirs is", () => {
    const held = [first, second];
    expect(threadSendingWithout(held, [first.turn])).toStrictEqual([second]);
    expect(threadSendingWithout(held, ["thread-turn-c"])).toBe(held);
    expect(threadSendingWithout(held, [])).toBe(held);
  });
});

describe("the turns a press of Stop named", () => {
  test("are held each once, in the order pressed", () => {
    const held = threadStoppingWith(threadStoppingWith([], "a"), "b");
    expect(held).toStrictEqual(["a", "b"]);
    expect(threadStoppingWith(held, "a")).toBe(held);
  });

  test("are no more than the mailbox takes turns, the oldest leaving past that", () => {
    let held: readonly string[] = [];
    for (let at = 0; at <= threadBacklogMax; at += 1)
      held = threadStoppingWith(held, `turn-${at}`);
    expect(held).toHaveLength(threadBacklogMax);
    expect(held[0]).toBe("turn-1");
    expect(held.at(-1)).toBe(`turn-${threadBacklogMax}`);
  });

  test("are less the one a door refused to stop, and the same list where it is not held", () => {
    const held = ["a", "b"];
    expect(threadStoppingWithout(held, "a")).toStrictEqual(["b"]);
    expect(threadStoppingWithout(held, "c")).toBe(held);
  });
});

describe("the turns a mailbox read lists as ended", () => {
  test("are every turn no runner has and none waits on, however it ended", () => {
    const turns = sessionTurnStates.map((state) =>
      turnOf({ turn: `turn-${state}`, state }),
    );
    expect(threadTurnsEnded({ turns })).toStrictEqual([
      "turn-Answered",
      "turn-Failed",
      "turn-Abandoned",
    ]);
  });
});

describe("what a press of Stop came to", () => {
  test("a door that stopped the turn ends it, and one that says it had ended stopped nothing", () => {
    expect(
      threadStopFrom({ outcome: "Ok", value: { stopped: "Stopped" } }),
    ).toStrictEqual({ stop: "Ended" });
    expect(
      threadStopFrom({ outcome: "Ok", value: { stopped: "AlreadyEnded" } }),
    ).toStrictEqual({ stop: "AlreadyEnded" });
  });

  test("a thread closed under the turn has nothing left to stop, and no other conflict says so", () => {
    expect(
      threadStopFrom({
        outcome: "Conflict",
        code: "ThreadClosed",
        body: undefined,
      }),
    ).toStrictEqual({ stop: "Ended" });
    expect(
      threadStopFrom({
        outcome: "Conflict",
        code: "Whatever",
        body: undefined,
      }),
    ).toMatchObject({ stop: "Refused" });
  });

  test("any other answer leaves the turn out, with a cause only where a member can act on one", () => {
    expect(
      threadStopFrom({
        outcome: "Rejected",
        code: "NotYourThread",
        status: 403,
        body: undefined,
      }),
    ).toStrictEqual({ stop: "Refused" });
    expect(
      threadStopFrom({ outcome: "Unreachable", reason: "offline" }),
    ).toStrictEqual({ stop: "Refused", cause: "Unreachable" });
    expect(threadStopFrom({ outcome: "Unauthenticated" })).toStrictEqual({
      stop: "Refused",
      cause: "Signed out",
    });
    expect(threadStopFrom({ outcome: "Absent" })).toStrictEqual({
      stop: "Refused",
    });
  });

  test("a stop answered once its record no longer names the turn leaves the record as it is, and writes no record", () => {
    const answered = { stop: "Refused" } as const;
    expect(threadStopTakenBack(threadSendRecordEmpty, "t1", answered)).toBe(
      threadSendRecordEmpty,
    );
    const records = {};
    expect(
      threadSendRecordWith(records, "a", (record) =>
        threadStopTakenBack(record, "t1", answered),
      ),
    ).toBe(records);
    const stopping = threadStopPressedOn(threadSendRecordEmpty, "t1");
    expect(threadStopTakenBack(stopping, "t1", answered).takenBack).toBe(1);
  });
});

describe("the line a refusal is said in", () => {
  test("it says what was not done, and the cause where there is one", () => {
    expect(threadRefusalLine({ what: "Send" })).toBe("Not sent");
    expect(threadRefusalLine({ what: "Stop", turn: "turn-2" })).toBe(
      "Not stopped",
    );
    expect(threadRefusalLine({ what: "Send", cause: "Unreachable" })).toBe(
      "Not sent · Unreachable",
    );
    expect(
      threadRefusalLine({ what: "Stop", turn: "turn-2", cause: "Signed out" }),
    ).toBe("Not stopped · Signed out");
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
    ).toStrictEqual({ send: "Refused", what: "Send", cause: "Elsewhere" });
  });

  test("a code the console has no word for is drawn as the code", () => {
    expect(threadRefusalWord("SomethingNew")).toBe("SomethingNew");
  });
});

describe("an open the door answers", () => {
  /** The key is what a retried open is answered the same thread by, so it is
   * spelled in the characters the door takes one in and fits its bound. */
  test("a minted key is one the door takes", () => {
    const key = threadOpenKeyMinted(new Uint8Array(threadOpenKeyBytesCount));
    expect(threadOpenKeyPattern.test(key)).toBe(true);
    expect(key.length).toBeLessThanOrEqual(threadOpenKeyCharsMax);
    expect(key).not.toBe(
      threadOpenKeyMinted(new Uint8Array(threadOpenKeyBytesCount).fill(1)),
    );
  });

  test("an open refused at the reader's limit is told apart from any other conflict", () => {
    expect(
      threadOpenAtLimit({
        outcome: "Conflict",
        code: threadLimitReachedCode,
        body: undefined,
      }),
    ).toBe(true);
    expect(
      threadOpenAtLimit({
        outcome: "Conflict",
        code: "Conflict",
        body: undefined,
      }),
    ).toBe(false);
    expect(
      threadOpenAtLimit({
        outcome: "Rejected",
        code: threadLimitReachedCode,
        status: 400,
        body: undefined,
      }),
    ).toBe(false);
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
      ["ThreadImageUnknown", "Image missing"],
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

  test("every other rejection is one refusal of a send, and carries no code", () => {
    const refused = threadSendFrom({
      outcome: "Rejected",
      code: "MessageTooLong",
      status: 400,
      body: undefined,
    });
    expect(refused).toStrictEqual({ send: "Refused", what: "Send" });
    expect(
      threadSendFrom({ outcome: "Unreachable", reason: "offline" }),
    ).toStrictEqual({ send: "Refused", what: "Send", cause: "Unreachable" });
  });
});

describe("an image as the reason a send is refused", () => {
  test("an image the door says is not the project's is said as the image, in the refusal's own line", () => {
    const refused = threadSendFrom({
      outcome: "Rejected",
      code: "ThreadImageUnknown",
      status: 400,
      body: undefined,
    });
    expect(refused).toStrictEqual({
      send: "Refused",
      what: "Send",
      cause: "Image missing",
    });
  });

  test("a store that could not say whether an image is the project's is a wait, said as the images", () => {
    expect(
      threadSendFrom({
        outcome: "Retryable",
        code: "ArtifactUnavailable",
        retryAfterSeconds: 1,
      }),
    ).toStrictEqual({ send: "Waiting", why: "Images unavailable" });
  });

  test("an upload that failed is a send refused, in the words of the image", () => {
    const rejected = (code: string) =>
      threadUploadRefused({
        outcome: "Rejected",
        code,
        status: 400,
        body: undefined,
      }).cause;
    expect(rejected("ArtifactTooLarge")).toBe("Image too large");
    expect(rejected("UnsupportedMediaType")).toBe("Image type refused");
    expect(rejected("Invalid")).toBe("Image not uploaded");
    expect(
      threadUploadRefused({
        outcome: "Retryable",
        code: "ArtifactUnavailable",
        retryAfterSeconds: 1,
      }).cause,
    ).toBe("Images unavailable");
    expect(
      threadUploadRefused({ outcome: "Unreachable", reason: "offline" }).cause,
    ).toBe("Unreachable");
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

describe("whether a store the thread does not name is missing", () => {
  test("a thread whose every turn is unsettled has not written one yet", () => {
    expect(threadStoreDue({ turns: [] })).toBe(false);
    expect(threadStoreDue({ turns: [turnOf({ state: "Queued" })] })).toBe(
      false,
    );
    expect(threadStoreDue({ turns: [turnOf({ state: "Claimed" })] })).toBe(
      false,
    );
  });

  test("a thread with a settled turn should have one, however that turn ended", () => {
    for (const state of sessionTurnStates) {
      if (state === "Queued" || state === "Claimed") continue;
      const settled = turnOf({ turn: "thread-turn-1", ordinal: 1, state });
      const asked = turnOf({
        turn: "thread-turn-2",
        ordinal: 2,
        state: "Queued",
      });
      expect(threadStoreDue({ turns: [settled] })).toBe(true);
      expect(threadStoreDue({ turns: [settled, asked] })).toBe(true);
    }
  });

  test("a turn a member stopped is no sign of one, since it may never have been taken", () => {
    const stopped = turnOf({ state: "Abandoned", failure: "TurnStopped" });
    expect(threadStoreDue({ turns: [stopped] })).toBe(false);
    const waited = turnOf({ state: "Abandoned", failure: "TurnStoppedQueued" });
    expect(threadStoreDue({ turns: [waited] })).toBe(false);
    const withdrawn = turnOf({ state: "Abandoned", failure: "TurnWithdrawn" });
    expect(threadStoreDue({ turns: [withdrawn] })).toBe(true);
    expect(threadStoreDue({ turns: [stopped, turnOf({ ordinal: 2 })] })).toBe(
      true,
    );
  });
});

describe("what is kept for a thread that is not drawn", () => {
  const refused = { send: "Refused", what: "Send" } as const;
  const one = { turn: "t1", text: "one" };
  const two = { turn: "t2", text: "two" };
  const pressed = (
    record: ThreadSendRecord,
    sent: { readonly turn: string; readonly text: string },
    away: boolean,
  ): ThreadSendRecord =>
    threadSendEnded(threadSendBegan(record, sent), {
      sent,
      send: refused,
      away,
    });

  test("a thread is kept one text, a second handed back going under the first as a text no one turn sent", () => {
    const first = pressed(threadSendRecordEmpty, one, true);
    expect(first.kept).toStrictEqual({ text: "one", turns: ["t1"] });
    expect(first.held, "the kept text is the record's last press").toBe(one);
    const both = pressed(first, two, true);
    expect(both.kept).toStrictEqual({
      text: "one\n\ntwo",
      turns: ["t1", "t2"],
    });
    expect(both.held, "no one turn sent what is kept").toBeUndefined();
    expect(threadKeptWith(undefined, { text: "x", turns: [] })).toStrictEqual({
      text: "x",
      turns: [],
    });
  });

  test("a press refused while a box that pressed is drawn keeps nothing, and is held for the next press", () => {
    const drawn = pressed(threadSendRecordEmpty, one, false);
    expect(drawn.kept).toBeUndefined();
    expect(drawn.held).toBe(one);
    expect(drawn.sending).toStrictEqual([]);
    expect(drawn.pressesOut).toBe(0);
  });

  test("what a box took is kept no longer, and the turns it named are named no longer", () => {
    const kept = pressed(threadSendRecordEmpty, one, true);
    expect([...threadSendTurnsNamed({ a: kept })]).toStrictEqual(["t1"]);
    const taken = threadSendTaken(kept);
    expect(taken.kept).toBeUndefined();
    expect([...threadSendTurnsNamed({ a: taken })], "held").toStrictEqual([
      "t1",
    ]);
    const sent = threadSendEnded(threadSendBegan(taken, one), {
      sent: one,
      send: { send: "Sent", ordinal: 1 },
      away: true,
    });
    expect([...threadSendTurnsNamed({ a: sent })]).toStrictEqual([]);
  });

  test("a thread that takes nothing more is one to keep nothing for", () => {
    const kept = pressed(threadSendRecordEmpty, one, true);
    expect(threadKeptClosed(kept, false)).toBe(true);
    expect(threadKeptClosed(kept, true)).toBe(false);
    expect(threadKeptClosed(threadSendRecordEmpty, false)).toBe(false);
  });

  test("a first record leaves nothing unless a press is out or a message kept", () => {
    const out = threadSendBegan(threadSendRecordEmpty, one);
    expect(threadSendFirstLeft(out)).toBe(out);
    const kept = pressed(threadSendRecordEmpty, one, true);
    expect(threadSendFirstLeft(kept)).toBe(kept);
    const opened = threadSendOpened(
      pressed(threadSendRecordEmpty, one, false),
      "thread-1",
    );
    expect(threadSendFirstLeft(opened)).toBe(threadSendRecordEmpty);
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
  const refused = { send: "Refused", what: "Send" } as const;
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
