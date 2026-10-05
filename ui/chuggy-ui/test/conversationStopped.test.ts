/**
 * A turn a member stopped, with no renderer: the exchange it is given, where
 * it stands among the others, and what a page draws at each step of stopping
 * a message and sending another.
 *
 * EVERY RECORD IS TRIED BOTH WAYS. A mailbox whose oldest turn is the thread's
 * first can count its exchanges against its turns, and a long thread's cannot,
 * so each case is drawn under both.
 *
 * EVERY STEP IS DRAWN BY TWO PAGES: one open since the first turn, which
 * remembers what it held before each turn was listed, and one opened at that
 * step, which is what a reload is.
 */

import { describe, expect, test } from "vitest";

import {
  conversationExchanges,
  conversationExchangesStood,
  conversationExchangesStopped,
  conversationIndicator,
  conversationSeenNothing,
  conversationSeenWith,
  conversationTurnStoppable,
  conversationWatchedNothing,
  conversationWatchedWith,
} from "../app/core/conversation.ts";
import type {
  ConversationExchange,
  ConversationItem,
  ConversationMarker,
  ConversationStep,
  ConversationTurn,
} from "../app/core/conversation.ts";

type Said = readonly [id: string, by: "User" | "Assistant", text: string];

function entries(...said: readonly Said[]): readonly ConversationItem[] {
  return said.map(([id, role, text]) => ({
    item: "Entry",
    entry: { id, role, blocks: [{ block: "Text", text }] },
  }));
}

function marked(marker: ConversationMarker): ConversationItem {
  return { item: "Marker", marker };
}

/** How a turn stands in a mailbox read: out, stopped while a runner held it or
 * while it still waited, failed as its session reported or with its attempt
 * lost, or answered in these words. */
type Ended =
  | "Queued"
  | "Claimed"
  | "Stopped"
  | "Waited"
  | "Reported"
  | "Lost"
  | { readonly answer: string };

function turnAt(
  ordinal: number,
  turn: string,
  input: string,
  ended: Ended,
): ConversationTurn {
  const asked = { turn, ordinal, inputKind: "UserMessage", input } as const;
  if (ended === "Queued" || ended === "Claimed")
    return { ...asked, state: ended };
  if (ended === "Stopped")
    return { ...asked, state: "Abandoned", failure: "TurnStopped" };
  if (ended === "Waited")
    return { ...asked, state: "Abandoned", failure: "TurnStoppedQueued" };
  if (ended === "Reported")
    return { ...asked, state: "Failed", failure: "AgentFailed" };
  if (ended === "Lost")
    return { ...asked, state: "Failed", failure: "AttemptLost" };
  return { ...asked, state: "Answered", result: ended.answer };
}

/** One exchange as a reader would say it: which it is, whose, where it stands
 * and the words it ends on. */
function said(exchange: ConversationExchange): string {
  const standing = exchange.standing;
  const word =
    standing.standing === "Running" ? standing.state : standing.standing;
  return [exchange.id, exchange.turn ?? "-", word, exchange.answer ?? "-"].join(
    "/",
  );
}

type Page = (
  items: readonly ConversationItem[],
  turns: readonly ConversationTurn[],
) => readonly ConversationExchange[];

/** A page as the thread's own keeps one: what it held before each turn was
 * listed is remembered from one read to the next. */
function pageOpened(): Page {
  let seen = conversationSeenNothing;
  return (items, turns) => {
    seen = conversationSeenWith(seen, items, turns, true);
    return conversationExchanges(items, turns, undefined, undefined, {
      seen,
      replaced: false,
    });
  };
}

/** The oldest turn a mailbox lists: the thread's first, or one past it. */
const records = [
  { record: "a record that can be counted", oldest: 1 },
  { record: "a record that cannot", oldest: 5 },
] as const;

const asked = "go";
const half: readonly Said[] = [
  ["u1", "User", asked],
  ["a1", "Assistant", "Half an answer"],
];

describe("a turn a member stopped, and the exchange it is given", () => {
  test.each(records)(
    "stopped part way through its answer it is one exchange, its message once and Stopped under what it stored, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(entries(...half), [
        turnAt(oldest, "stopped", asked, "Stopped"),
      ]);
      expect(drawn.map(said)).toEqual(["u1/stopped/Stopped/Half an answer"]);
      expect(drawn[0]?.ask).toEqual({ ask: "Message", text: asked });
    },
  );

  test.each(records)(
    "stopped with its message stored and nothing of an answer it is that message and Stopped, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(entries(["u1", "User", asked]), [
        turnAt(oldest, "stopped", asked, "Stopped"),
      ]);
      expect(drawn.map(said)).toEqual(["u1/stopped/Stopped/-"]);
      expect(drawn[0]?.work).toEqual([]);
    },
  );

  test.each(records)(
    "stopped before anything of it was stored, waiting or just taken, it is its message and Stopped and nothing else, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        entries(["u0", "User", "earlier"], ["a0", "Assistant", "Earlier."]),
        [
          turnAt(oldest, "before", "earlier", { answer: "Earlier." }),
          turnAt(oldest + 1, "stopped", asked, "Stopped"),
        ],
      );
      expect(drawn.map(said)).toEqual([
        "u0/before/Answered/Earlier.",
        "stopped/stopped/Stopped/-",
      ]);
      expect(drawn[1]).toMatchObject({
        ask: { ask: "Message", text: asked },
        work: [],
        before: [],
      });
    },
  );
});

describe("a turn a member stopped whose words were said before it", () => {
  test.each(records)(
    "it takes no exchange that reads as the answer of the same words asked before it, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        entries(["u1", "User", asked], ["a1", "Assistant", "First."]),
        [
          turnAt(oldest, "answered", asked, { answer: "First." }),
          turnAt(oldest + 1, "stopped", asked, "Stopped"),
        ],
      );
      expect(drawn.map(said)).toEqual([
        "u1/answered/Answered/First.",
        "stopped/stopped/Stopped/-",
      ]);
    },
  );

  test.each(records)(
    "its stored words stay its own after the same words answered before it, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        entries(
          ["u1", "User", asked],
          ["a1", "Assistant", "First."],
          ["u2", "User", asked],
          ["a2", "Assistant", "Half an answer"],
        ),
        [
          turnAt(oldest, "answered", asked, { answer: "First." }),
          turnAt(oldest + 1, "stopped", asked, "Stopped"),
        ],
      );
      expect(drawn.map(said)).toEqual([
        "u1/answered/Answered/First.",
        "u2/stopped/Stopped/Half an answer",
      ]);
    },
  );

  test("in a record that cannot be counted, one stopped before it stored anything takes an older exchange of the same words that no listed turn answers for", () => {
    const drawn = conversationExchanges(
      entries(["u-old", "User", asked], ["a-old", "Assistant", "Long ago."]),
      [turnAt(41, "stopped", asked, "Stopped")],
    );
    expect(drawn.map(said)).toEqual(["u-old/stopped/Stopped/Long ago."]);
  });
});

const answeredHalf: readonly Said[] = [
  ...half,
  ["u2", "User", asked],
  ["a2", "Assistant", "Second answer."],
];

describe("a turn a member stopped while it still waited", () => {
  test.each(records)(
    "it is its message and Stopped, and takes no stored exchange of its words, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        entries(["u-old", "User", asked], ["a-old", "Assistant", "Long ago."]),
        [turnAt(oldest, "waited", asked, "Waited")],
      );
      expect(drawn.map(said)).toEqual([
        "u-old/-/Answered/Long ago.",
        "waited/waited/Stopped/-",
      ]);
      expect(drawn[1]).toMatchObject({
        ask: { ask: "Message", text: asked },
        work: [],
      });
    },
  );

  test.each(records)(
    "the half answer of the same words stopped before it stays that turn's, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(entries(...half), [
        turnAt(oldest, "first", asked, "Stopped"),
        turnAt(oldest + 1, "waited", asked, "Waited"),
      ]);
      expect(drawn.map(said)).toEqual([
        "u1/first/Stopped/Half an answer",
        "waited/waited/Stopped/-",
      ]);
    },
  );

  test("a lost turn of the same words keeps the exchange a counted record holds to spare, which the stopped one is not counted against", () => {
    const drawn = conversationExchanges(
      entries(["u1", "User", asked], ["a1", "Assistant", "Half an answer"]),
      [
        turnAt(1, "lost", asked, "Lost"),
        turnAt(2, "waited", asked, "Waited"),
        turnAt(3, "waiting", asked, "Queued"),
      ],
    );
    expect(drawn.map(said)).toEqual([
      "u1/lost/Failed/Half an answer",
      "waited/waited/Stopped/-",
      "waiting/waiting/Queued/-",
    ]);
  });
});

describe("a turn stopped while it waited, among the same words answered", () => {
  test.each(records)(
    "it stands where it was sent, between the answers before and after it, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        entries(
          ["u1", "User", asked],
          ["a1", "Assistant", "First."],
          ["u3", "User", asked],
          ["a3", "Assistant", "Third."],
        ),
        [
          turnAt(oldest, "first", asked, { answer: "First." }),
          turnAt(oldest + 1, "waited", asked, "Waited"),
          turnAt(oldest + 2, "third", asked, { answer: "Third." }),
        ],
      );
      expect(drawn.map(said)).toEqual([
        "u1/first/Answered/First.",
        "waited/waited/Stopped/-",
        "u3/third/Answered/Third.",
      ]);
    },
  );
});

describe("a turn stopped just as a runner took it, the same words asked around it", () => {
  test.each(records)(
    "the answer the same words got before it stays under its own message, and the half answer before that under its own, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(entries(...answeredHalf), [
        turnAt(oldest, "first", asked, "Stopped"),
        turnAt(oldest + 1, "second", asked, { answer: "Second answer." }),
        turnAt(oldest + 2, "third", asked, "Stopped"),
      ]);
      expect(drawn.map(said)).toEqual([
        "u1/first/Stopped/Half an answer",
        "u2/second/Answered/Second answer.",
        "third/third/Stopped/-",
      ]);
    },
  );

  test.each(records)(
    "the same holds with the same words answered again after it, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        entries(
          ...answeredHalf,
          ["u4", "User", asked],
          ["a4", "Assistant", "Fourth answer."],
        ),
        [
          turnAt(oldest, "first", asked, "Stopped"),
          turnAt(oldest + 1, "second", asked, { answer: "Second answer." }),
          turnAt(oldest + 2, "third", asked, "Stopped"),
          turnAt(oldest + 3, "fourth", asked, { answer: "Fourth answer." }),
        ],
      );
      expect(drawn.map(said)).toEqual([
        "u1/first/Stopped/Half an answer",
        "u2/second/Answered/Second answer.",
        "third/third/Stopped/-",
        "u4/fourth/Answered/Fourth answer.",
      ]);
    },
  );

  test.each(records)(
    "a page that held the stopped turn's half answer before the next was sent keeps it there, and one opened afterwards cannot tell the two apart, in $record",
    ({ oldest }) => {
      const first = turnAt(oldest, "first", asked, "Stopped");
      const turns = [first, turnAt(oldest + 1, "second", asked, "Stopped")];
      const page = pageOpened();
      page(entries(...half), [first]);
      expect(page(entries(...half), turns).map(said)).toEqual([
        "u1/first/Stopped/Half an answer",
        "second/second/Stopped/-",
      ]);
      expect(pageOpened()(entries(...half), turns).map(said)).toEqual([
        "first/first/Stopped/-",
        "u1/second/Stopped/Half an answer",
      ]);
    },
  );
});

/** One read of a thread: what its store holds and what its mailbox lists. */
interface Step {
  readonly step: string;
  readonly items: readonly ConversationItem[];
  readonly turns: readonly ConversationTurn[];
  /** What a page open since the first turn draws. */
  readonly drawn: readonly string[];
}

/** A message stopped and another sent, read by read: the first stored its
 * message and half an answer or nothing, and the second says `again`. */
function stoppedThenSent(
  stored: boolean,
  again: string,
  oldest: number,
): readonly Step[] {
  const kept = stored ? entries(...half) : [];
  const first = (ended: Ended): ConversationTurn =>
    turnAt(oldest, "first", asked, ended);
  const second = (ended: Ended): ConversationTurn =>
    turnAt(oldest + 1, "second", again, ended);
  const firstAs = (word: string): string =>
    stored ? `u1/first/${word}/Half an answer` : `first/first/${word}/-`;
  const own = (answer: string): readonly ConversationItem[] => [
    ...kept,
    ...entries(["u2", "User", again], ["a2", "Assistant", answer]),
  ];
  return [
    {
      step: "the first is taken",
      items: kept,
      turns: [first("Claimed")],
      drawn: [firstAs("Claimed")],
    },
    {
      step: "the first is stopped",
      items: kept,
      turns: [first("Stopped")],
      drawn: [firstAs("Stopped")],
    },
    {
      step: "the second waits",
      items: kept,
      turns: [first("Stopped"), second("Queued")],
      drawn: [firstAs("Stopped"), "second/second/Queued/-"],
    },
    {
      step: "the second is taken",
      items: kept,
      turns: [first("Stopped"), second("Claimed")],
      drawn: [firstAs("Stopped"), "second/second/Claimed/-"],
    },
    {
      step: "the second's message is stored",
      items: own("Second"),
      turns: [first("Stopped"), second("Claimed")],
      drawn: [firstAs("Stopped"), "u2/second/Claimed/Second"],
    },
    {
      step: "the second is answered",
      items: own("Second answer."),
      turns: [first("Stopped"), second({ answer: "Second answer." })],
      drawn: [firstAs("Stopped"), "u2/second/Answered/Second answer."],
    },
  ];
}

const sequences = records.flatMap(({ record, oldest }) =>
  [true, false].flatMap((stored) =>
    [asked, "then this"].map((again) => ({
      sequence: `${stored ? "its message and half an answer stored" : "nothing of it stored"}, then ${again === asked ? "the same words" : "other words"}, in ${record}`,
      stored,
      same: again === asked,
      steps: stoppedThenSent(stored, again, oldest),
    })),
  ),
);

/** The one step a page opened at it draws otherwise than one open throughout:
 * the same words sent again and taken, before their own message is stored. */
const takenBeforeStored = "the second is taken";

describe("a message stopped and another sent", () => {
  test.each(sequences)(
    "a page open throughout draws each step: $sequence",
    ({ steps }) => {
      const page = pageOpened();
      for (const step of steps)
        expect(page(step.items, step.turns).map(said), step.step).toEqual(
          step.drawn,
        );
    },
  );

  test.each(sequences)(
    "a page opened at any step draws what the open one does: $sequence",
    ({ steps, stored, same }) => {
      for (const step of steps) {
        if (stored && same && step.step === takenBeforeStored) continue;
        expect(
          pageOpened()(step.items, step.turns).map(said),
          step.step,
        ).toEqual(step.drawn);
      }
    },
  );

  test.each(records)(
    "a page opened while the same words sent again are taken and not yet stored draws the stopped turn's words under them until they are, in $record",
    ({ oldest }) => {
      const steps = stoppedThenSent(true, asked, oldest);
      const opened = (named: string): readonly string[] => {
        const step = steps.find((held) => held.step === named);
        if (step === undefined) throw new Error(`no step ${named}`);
        return pageOpened()(step.items, step.turns).map(said);
      };
      expect(opened(takenBeforeStored)).toEqual([
        "first/first/Stopped/-",
        "u1/second/Claimed/Half an answer",
      ]);
      expect(opened("the second's message is stored")).toEqual([
        "u1/first/Stopped/Half an answer",
        "u2/second/Claimed/Second",
      ]);
    },
  );
});

/** The same turns with each one a member stopped read as one its session
 * reported failed, which these reads pair alike and nothing moves. */
function reportedInstead(
  turns: readonly ConversationTurn[],
): readonly ConversationTurn[] {
  return turns.map((turn) =>
    turn.failure === "TurnStopped"
      ? { ...turn, state: "Failed", failure: "AgentFailed" }
      : turn,
  );
}

/** Whose each exchange is, whatever order they are drawn in. */
function pairs(exchanges: readonly ConversationExchange[]): readonly string[] {
  return exchanges
    .map((exchange) => `${exchange.id}/${exchange.turn ?? "-"}`)
    .sort();
}

/** The exchanges read from the store, in the order drawn. */
function fromStore(
  exchanges: readonly ConversationExchange[],
): readonly string[] {
  return exchanges
    .filter((exchange) => exchange.id !== exchange.turn)
    .map((exchange) => exchange.id);
}

type Read = Pick<Step, "items" | "turns">;

/** Two drawings of one read give each exchange the same turn, and draw the
 * exchanges read from the store in the store's own order. */
function samePairing(
  placed: readonly ConversationExchange[],
  unplaced: readonly ConversationExchange[],
  items: readonly ConversationItem[],
): void {
  expect(pairs(placed)).toEqual(pairs(unplaced));
  expect(fromStore(placed)).toEqual(fromStore(unplaced));
  expect(fromStore(placed)).toEqual(
    items.flatMap((item) =>
      item.item === "Entry" && item.entry.role === "User"
        ? [item.entry.id]
        : [],
    ),
  );
}

const interleaved = {
  items: entries(
    ["u1", "User", "one"],
    ["a1", "Assistant", "One."],
    ["u4", "User", "four"],
    ["a4", "Assistant", "Four."],
    ["u6", "User", "six"],
    ["a6", "Assistant", "Six."],
  ),
  turns: (oldest: number): readonly ConversationTurn[] => [
    turnAt(oldest, "t1", "one", { answer: "One." }),
    turnAt(oldest + 1, "t2", "two", "Stopped"),
    turnAt(oldest + 2, "t3", "three", "Stopped"),
    turnAt(oldest + 3, "t4", "four", { answer: "Four." }),
    turnAt(oldest + 4, "t5", "five", "Stopped"),
    turnAt(oldest + 5, "t6", "six", { answer: "Six." }),
    turnAt(oldest + 6, "t7", "seven", "Stopped"),
  ],
};

describe("where a stopped turn that took no exchange is drawn", () => {
  test.each(records)(
    "several stopped in a row and among answered ones are drawn in the order they were sent, in $record",
    ({ oldest }) => {
      const drawn = conversationExchanges(
        interleaved.items,
        interleaved.turns(oldest),
      );
      expect(drawn.map((exchange) => exchange.turn)).toEqual([
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "t7",
      ]);
    },
  );

  test("placing it changes no pairing and moves no exchange read from the store, at every read of every sequence by either page", () => {
    const scripts: readonly (readonly Read[])[] = [
      ...sequences.map(({ steps }) => steps),
      ...records.map(({ oldest }) => [
        { items: interleaved.items, turns: interleaved.turns(oldest) },
      ]),
    ];
    for (const script of scripts) {
      const placed = pageOpened();
      const unplaced = pageOpened();
      for (const { items, turns } of script) {
        const reported = reportedInstead(turns);
        samePairing(placed(items, turns), unplaced(items, reported), items);
        samePairing(
          pageOpened()(items, turns),
          pageOpened()(items, reported),
          items,
        );
      }
    }
  });

  test.each(records)(
    "it stands above a later message where it stood before that message was stored, in $record",
    ({ oldest }) => {
      const older = entries(
        ["u0", "User", "earlier"],
        ["a0", "Assistant", "Earlier."],
      );
      const turns = (later: Ended): readonly ConversationTurn[] => [
        turnAt(oldest, "before", "earlier", { answer: "Earlier." }),
        turnAt(oldest + 1, "stopped", asked, "Stopped"),
        turnAt(oldest + 2, "later", "then this", later),
      ];
      const page = pageOpened();
      const order = (
        items: readonly ConversationItem[],
        later: Ended,
      ): readonly (string | undefined)[] =>
        page(items, turns(later)).map((exchange) => exchange.turn);
      expect(order(older, "Queued")).toEqual(["before", "stopped", "later"]);
      expect(order(older, "Claimed")).toEqual(["before", "stopped", "later"]);
      const stored = [...older, ...entries(["u2", "User", "then this"])];
      expect(order(stored, "Claimed")).toEqual(["before", "stopped", "later"]);
      expect(
        pageOpened()(stored, turns("Claimed")).map((exchange) => exchange.turn),
      ).toEqual(["before", "stopped", "later"]);
    },
  );
});

test("a stopped turn stands under the answer its own words got before it, though a later turn holds an exchange stored earlier", () => {
  const drawn = conversationExchanges(
    entries(
      ["u1", "User", "again"],
      ["u2", "User", asked],
      ["a2", "Assistant", "Second."],
    ),
    [
      turnAt(1, "first", "again", "Stopped"),
      turnAt(2, "second", asked, { answer: "Second." }),
      turnAt(3, "waited", asked, "Waited"),
      turnAt(4, "fourth", "again", "Claimed"),
    ],
  );
  expect(drawn.map(said)).toEqual([
    "first/first/Stopped/-",
    "u1/fourth/Claimed/-",
    "u2/second/Answered/Second.",
    "waited/waited/Stopped/-",
  ]);
});

describe("where a turn that took no exchange and was not stopped is drawn", () => {
  test("a turn its session reported failed that took none is still drawn at the foot", () => {
    const drawn = conversationExchanges(
      entries(["u2", "User", "then this"], ["a2", "Assistant", "Second."]),
      [
        turnAt(1, "failed", asked, "Reported"),
        turnAt(2, "later", "then this", { answer: "Second." }),
      ],
    );
    expect(drawn.map((exchange) => exchange.turn)).toEqual(["later", "failed"]);
  });

  test("it stays there with a stopped turn sent after it, which is drawn where that one was sent", () => {
    const drawn = conversationExchanges(
      entries(["u3", "User", "then this"], ["a3", "Assistant", "Third."]),
      [
        turnAt(1, "failed", asked, "Reported"),
        turnAt(2, "stopped", "and this", "Stopped"),
        turnAt(3, "later", "then this", { answer: "Third." }),
      ],
    );
    expect(drawn.map((exchange) => exchange.turn)).toEqual([
      "stopped",
      "later",
      "failed",
    ]);
  });

  test("one carrying what the record could not draw stays at the foot with it", () => {
    const drawn = conversationExchanges(
      [
        ...entries(["u2", "User", "then this"], ["a2", "Assistant", "Second."]),
        marked({ marker: "Unreached" }),
      ],
      [
        turnAt(1, "stopped", asked, "Stopped"),
        turnAt(2, "later", "then this", { answer: "Second." }),
      ],
    );
    expect(drawn.map((exchange) => exchange.turn)).toEqual([
      "later",
      "stopped",
    ]);
    expect(drawn[1]?.before).toEqual([{ marker: "Unreached" }]);
  });
});

describe("the turn a press of Stop ends", () => {
  const running = (
    items: readonly ConversationItem[],
    turns: readonly ConversationTurn[],
  ): string | undefined => {
    const exchanges = conversationExchanges(items, turns);
    return conversationTurnStoppable(
      exchanges,
      conversationIndicator(exchanges, { drawn: true, sending: false }),
    );
  };

  test("it is the turn being answered, and the first waiting where none is", () => {
    expect(
      running(entries(...half), [
        turnAt(1, "answering", asked, "Claimed"),
        turnAt(2, "waiting", "then this", "Queued"),
      ]),
    ).toBe("answering");
    expect(
      running(
        [],
        [
          turnAt(1, "waiting", asked, "Queued"),
          turnAt(2, "behind", "then this", "Queued"),
        ],
      ),
    ).toBe("waiting");
  });

  test("there is none where no turn is out, and none for a send no exchange stands for yet", () => {
    expect(
      running(entries(...half), [turnAt(1, "t1", asked, "Stopped")]),
    ).toBeUndefined();
    expect(
      conversationTurnStoppable([], { indicator: "Engine" }),
    ).toBeUndefined();
  });

  test("an exchange no turn speaks for is nothing a press can end", () => {
    const exchanges = conversationExchanges(entries(["u1", "User", asked]));
    expect(
      conversationTurnStoppable(exchanges, { indicator: "Exchange", id: "u1" }),
    ).toBeUndefined();
  });
});

describe("a turn read as stopped from the press", () => {
  const exchanges = conversationExchanges(entries(...half), [
    turnAt(1, "answering", asked, "Claimed"),
    turnAt(2, "waiting", "then this", "Queued"),
  ]).map((exchange) =>
    exchange.turn === "answering"
      ? { ...exchange, activity: { activity: "Writing" } as const }
      : exchange,
  );

  test("the turn pressed is stopped and says nothing of what it was doing, and no other is touched", () => {
    const stopped = conversationExchangesStopped(
      exchanges,
      new Set(["answering"]),
    );
    expect(stopped.map(said)).toEqual([
      "u1/answering/Stopped/Half an answer",
      "waiting/waiting/Queued/-",
    ]);
    expect(stopped[0]).not.toHaveProperty("activity");
    expect(stopped[1]).toBe(exchanges[1]);
  });

  test("a turn the mailbox has already ended keeps the mailbox's word", () => {
    const ended = conversationExchanges(entries(...half), [
      turnAt(1, "answered", asked, { answer: "Half an answer" }),
    ]);
    expect(conversationExchangesStopped(ended, new Set(["answered"]))).toBe(
      ended,
    );
  });

  test("the list is handed back itself where no turn of it was pressed, and a stopped exchange is the same one each time", () => {
    expect(conversationExchangesStopped(exchanges, new Set())).toBe(exchanges);
    expect(conversationExchangesStopped(exchanges, new Set(["gone"]))).toBe(
      exchanges,
    );
    const pressed = new Set(["answering"]);
    expect(conversationExchangesStopped(exchanges, pressed)[0]).toBe(
      conversationExchangesStopped(exchanges, pressed)[0],
    );
  });
});

const watchedDrawn = (
  standing: ConversationExchange["standing"],
  answer?: string,
): ConversationExchange => ({
  id: "e",
  turn: "t",
  work: [],
  ...(answer === undefined ? {} : { answer }),
  standing,
  before: [],
});
const watchedRunning = watchedDrawn(
  { standing: "Running", state: "Claimed" },
  "Half",
);
const watchedStopped = (answer?: string): ConversationExchange =>
  watchedDrawn({ standing: "Stopped" }, answer);
const watchedOut = conversationWatchedWith(
  conversationWatchedNothing,
  [watchedRunning],
  true,
);
const watchedAnswers = (
  exchanges: readonly ConversationExchange[],
  watched = watchedOut,
  looking = true,
): readonly (string | undefined)[] =>
  conversationExchangesStood(
    exchanges,
    conversationWatchedWith(watched, exchanges, looking),
  ).map((exchange) => exchange.answer);

describe("a turn a page watched stop", () => {
  test("says what it said when the page first drew it stopped, whatever its record holds since", () => {
    const first = [watchedStopped("Half")];
    const stood = conversationWatchedWith(watchedOut, first, true);
    expect(conversationExchangesStood(first, stood)).toBe(first);
    const later = [watchedStopped("Half of it")];
    expect(conversationWatchedWith(stood, later, true)).toBe(stood);
    expect(watchedAnswers(later, stood)).toStrictEqual(["Half"]);
    const same = conversationExchangesStood(later, stood);
    expect(conversationExchangesStood(later, stood)[0]).toBe(same[0]);
  });

  test("stays without a word where it was stopped before one was drawn", () => {
    const waiting = conversationWatchedWith(
      conversationWatchedNothing,
      [watchedDrawn({ standing: "Running", state: "Queued" })],
      true,
    );
    const stood = conversationWatchedWith(waiting, [watchedStopped()], true);
    const later = conversationExchangesStood([watchedStopped("Half")], stood);
    expect(later.map((exchange) => "answer" in exchange)).toStrictEqual([
      false,
    ]);
  });

  test("is drawn as its record has it by a page that first drew it stopped", () => {
    const later = [watchedStopped("Half of it")];
    expect(watchedAnswers(later, conversationWatchedNothing)).toStrictEqual([
      "Half of it",
    ]);
    const seen = conversationWatchedWith(
      conversationWatchedNothing,
      [watchedStopped("Half")],
      true,
    );
    expect(watchedAnswers(later, seen)).toStrictEqual(["Half of it"]);
  });

  test("is drawn as its record has it by a page nobody was looking at when it stopped, then and when somebody is", () => {
    const hidden = conversationWatchedWith(
      watchedOut,
      [watchedStopped("Half")],
      false,
    );
    expect(
      watchedAnswers([watchedStopped("Half of it")], hidden, true),
    ).toStrictEqual(["Half of it"]);
  });

  test("is let go of when its stop is taken back, out again or answered", () => {
    const stood = conversationWatchedWith(
      watchedOut,
      [watchedStopped("Half")],
      true,
    );
    const again = [
      watchedDrawn({ standing: "Running", state: "Claimed" }, "Half of it"),
    ];
    expect(watchedAnswers(again, stood)).toStrictEqual(["Half of it"]);
    expect(conversationExchangesStood(again, stood)).toBe(again);
    const whole = [watchedDrawn({ standing: "Answered" }, "Half of it all")];
    expect(watchedAnswers(whole, stood)).toStrictEqual(["Half of it all"]);
    const after = conversationWatchedWith(stood, whole, true);
    expect(watchedAnswers([watchedStopped("More")], after)).toStrictEqual([
      "More",
    ]);
  });
});

const callHeard: ConversationStep = {
  step: "ToolCall",
  id: "",
  name: "Bash",
  input: undefined,
};

function callStored(id: string, name = "Bash"): ConversationStep {
  return {
    step: "ToolCall",
    id,
    name,
    input: { command: id },
    result: { text: "done", isError: false },
  };
}

function callsDrawn(
  standing: ConversationExchange["standing"],
  work: readonly ConversationStep[],
  answer = "Half",
): readonly ConversationExchange[] {
  return [{ id: "e", turn: "t", work, answer, standing, before: [] }];
}

/** What a page that watched the turn stop over `work` reads of `later`. */
function callsStood(
  work: readonly ConversationStep[],
  later: readonly ConversationStep[],
  joined: readonly string[] = [],
): readonly ConversationStep[] | undefined {
  const out = conversationWatchedWith(
    conversationWatchedNothing,
    callsDrawn({ standing: "Running", state: "Claimed" }, work),
    true,
  );
  const stood = conversationWatchedWith(
    out,
    callsDrawn({ standing: "Stopped" }, work),
    true,
    joined,
  );
  const [read] = conversationExchangesStood(
    callsDrawn({ standing: "Stopped" }, later, "Half of it"),
    stood,
  );
  expect(read?.answer).toBe("Half");
  return read?.work;
}

describe("a call that stood on a page that watched its turn stop", () => {
  test("takes what the record holds of the call at its place, where it was heard by name alone, and no step that did not stand", () => {
    expect(
      callsStood(
        [callHeard],
        [
          callStored("toolu_1"),
          { step: "Text", text: "Half of it" },
          callStored("toolu_2"),
        ],
      ),
    ).toStrictEqual([callStored("toolu_1")]);
  });

  test("takes what the record holds of the call of its id, where the record held it already", () => {
    const begun: ConversationStep = {
      step: "ToolCall",
      id: "toolu_2",
      name: "Bash",
      input: { command: "toolu_2" },
    };
    expect(
      callsStood([begun], [callStored("toolu_1"), callStored("toolu_2")]),
    ).toStrictEqual([callStored("toolu_2")]);
  });

  test("stays as it was heard where the call at its place bears another name, or is itself only heard", () => {
    expect(
      callsStood([callHeard], [callStored("toolu_1", "Read")]),
    ).toStrictEqual([callHeard]);
    expect(callsStood([callHeard], [{ ...callHeard }])).toStrictEqual([
      callHeard,
    ]);
  });

  test("stays as it was heard on a page that joined its turn part way, which cannot place it", () => {
    expect(
      callsStood([callHeard], [callStored("toolu_1")], ["t"]),
    ).toStrictEqual([callHeard]);
    expect(
      callsStood([callHeard], [callStored("toolu_1")], ["another"]),
    ).toStrictEqual([callStored("toolu_1")]);
  });
});
