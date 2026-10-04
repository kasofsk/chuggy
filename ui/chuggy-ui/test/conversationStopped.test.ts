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
  conversationExchangesStopped,
  conversationIndicator,
  conversationSeenNothing,
  conversationSeenWith,
  conversationTurnStoppable,
} from "../app/core/conversation.ts";
import type {
  ConversationExchange,
  ConversationItem,
  ConversationMarker,
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

/** How a turn stands in a mailbox read: out, stopped, failed as its session
 * reported, or answered in these words. */
type Ended =
  "Queued" | "Claimed" | "Stopped" | "Reported" | { readonly answer: string };

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
  if (ended === "Reported")
    return { ...asked, state: "Failed", failure: "AgentFailed" };
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
 * reported failed, which the rule pairs alike and never moves. */
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
