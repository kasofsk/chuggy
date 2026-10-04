/**
 * The conversation model, with no renderer: what a content block is read as,
 * and how the blocks and the mailbox become exchanges.
 */

import { describe, expect, test } from "vitest";

import {
  threadDraftsHeading,
  threadNorthStarHeading,
  threadStandingRulesDefault,
  threadStandingHeading,
  threadStandingSection,
  threadTurnBoundaryHeading,
} from "../../../src/contract/threadSeeding.ts";
import {
  conversationAskMessage,
  conversationArgumentSummary,
  conversationArgumentSummaryCharsMax,
  conversationArgumentText,
  conversationBlocksMax,
  conversationBlocksOf,
  conversationBlockUnreadable,
  conversationExchangeContinued,
  conversationExchangeParts,
  conversationExchanges,
  conversationExchangesMax,
  conversationExchangesWaiting,
  conversationSeenNothing,
  conversationSeenWith,
  conversationStepsMax,
  conversationWorkSummary,
} from "../app/core/conversation.ts";
import type {
  ConversationBlock,
  ConversationExchange,
  ConversationItem,
  ConversationRecord,
  ConversationTurn,
} from "../app/core/conversation.ts";
import { conversationStoreItems } from "./conversationFixture.ts";

function entryOf(
  id: string,
  role: "User" | "Assistant",
  blocks: readonly ConversationBlock[],
): ConversationItem {
  return { item: "Entry", entry: { id, role, blocks } };
}

function askOf(id: string, text: string): ConversationItem {
  return entryOf(id, "User", [{ block: "Text", text }]);
}

function answerOf(id: string, text: string): ConversationItem {
  return entryOf(id, "Assistant", [{ block: "Text", text }]);
}

function turnOf(turn: Partial<ConversationTurn>): ConversationTurn {
  return {
    turn: "thread-turn-1",
    ordinal: 1,
    inputKind: "UserMessage",
    state: "Answered",
    ...turn,
  };
}

/** The exchanges a page draws of these items under these turns, each with the
 * turn it was paired with, given what the page knows of the record. */
function pairedUnder(
  items: readonly ConversationItem[],
  turns: readonly ConversationTurn[],
  record?: ConversationRecord,
): readonly (readonly [string, string | undefined])[] {
  return conversationExchanges(items, turns, undefined, undefined, record).map(
    (exchange) => [exchange.id, exchange.turn] as const,
  );
}

/** A page that held these exchanges while `newest` was the newest turn its
 * mailbox listed. */
function heldBefore(
  newest: number,
  ...exchanges: readonly string[]
): ConversationRecord {
  return {
    seen: new Map(exchanges.map((id) => [id, newest])),
    replaced: false,
  };
}

describe("the block parser", () => {
  test("a string content is one text block", () => {
    expect(conversationBlocksOf({ content: "resumed" })).toEqual([
      { block: "Text", text: "resumed" },
    ]);
  });

  test("a message that is not an object holds no blocks", () => {
    expect(conversationBlocksOf(undefined)).toEqual([]);
    expect(conversationBlocksOf("bare")).toEqual([]);
    expect(conversationBlocksOf({ content: 7 })).toEqual([]);
  });

  test("each kind the runtime writes is read as itself", () => {
    const blocks = conversationBlocksOf({
      content: [
        { type: "text", text: "said" },
        { type: "thinking", thinking: "weighed", signature: "sig" },
        { type: "tool_use", id: "call-1", name: "Read", input: { path: "a" } },
        {
          type: "tool_result",
          tool_use_id: "call-1",
          content: "bytes",
          is_error: true,
        },
      ],
    });
    expect(blocks).toEqual([
      { block: "Text", text: "said" },
      { block: "Thinking", text: "weighed" },
      { block: "ToolUse", id: "call-1", name: "Read", input: { path: "a" } },
      { block: "ToolResult", toolUse: "call-1", text: "bytes", isError: true },
    ]);
  });
});

describe("the block parser, on a result and an unknown kind", () => {
  test("a result's characters are read out of its own content array", () => {
    const blocks = conversationBlocksOf({
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-1",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      ],
    });
    expect(blocks).toEqual([
      {
        block: "ToolResult",
        toolUse: "call-1",
        text: "first\nsecond",
        isError: false,
      },
    ]);
  });

  test("a kind this module does not know is carried, not dropped", () => {
    expect(
      conversationBlocksOf({
        content: [{ type: "server_tool_use" }, 7, { text: "no kind" }],
      }),
    ).toEqual([
      { block: "Other", kind: "server_tool_use" },
      { block: "Other", kind: conversationBlockUnreadable },
      { block: "Other", kind: conversationBlockUnreadable },
    ]);
  });

  test("the blocks past the bound are counted rather than lost", () => {
    const content = Array.from({ length: conversationBlocksMax + 3 }, () => ({
      type: "text",
      text: "x",
    }));
    const blocks = conversationBlocksOf({ content });
    expect(blocks).toHaveLength(conversationBlocksMax + 1);
    expect(blocks.at(-1)).toEqual({ block: "Capped", count: 3 });
  });

  test("a result's own nested content is bounded the same way", () => {
    const nested = Array.from({ length: conversationBlocksMax + 2 }, () => ({
      type: "text",
      text: "part",
    }));
    const blocks = conversationBlocksOf({
      content: [
        { type: "tool_result", tool_use_id: "call-1", content: nested },
      ],
    });
    const result = blocks[0];
    expect(result?.block).toBe("ToolResult");
    const expected = [
      ...Array.from({ length: conversationBlocksMax }, () => "part"),
      "Result cut · 2",
    ].join("\n");
    expect(result?.block === "ToolResult" ? result.text : undefined).toBe(
      expected,
    );
  });
});

describe("grouping", () => {
  test("an exchange opens at a user entry and ends on the last text", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "what"),
      answerOf("a1", "this"),
      askOf("u2", "and now"),
      answerOf("a2", "that"),
    ]);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]?.ask).toEqual({ ask: "Message", text: "what" });
    expect(exchanges[0]?.answer).toBe("this");
    expect(exchanges[0]?.standing).toEqual({ standing: "Answered" });
    expect(exchanges[1]?.answer).toBe("that");
  });

  test("a user entry of only results attaches them to the open call", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "read it"),
      entryOf("a1", "Assistant", [
        { block: "ToolUse", id: "call-1", name: "Read", input: { path: "a" } },
      ]),
      entryOf("u2", "User", [
        {
          block: "ToolResult",
          toolUse: "call-1",
          text: "bytes",
          isError: false,
        },
      ]),
      answerOf("a2", "done"),
    ]);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.work).toEqual([
      {
        step: "ToolCall",
        id: "call-1",
        name: "Read",
        input: { path: "a" },
        result: { text: "bytes", isError: false },
      },
    ]);
    expect(exchanges[0]?.answer).toBe("done");
  });

  test("a result whose call is not open stands as a call with no name", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "read it"),
      entryOf("u2", "User", [
        {
          block: "ToolResult",
          toolUse: "call-9",
          text: "orphan",
          isError: true,
        },
      ]),
    ]);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.work).toEqual([
      {
        step: "ToolCall",
        id: "call-9",
        input: undefined,
        result: { text: "orphan", isError: true },
      },
    ]);
  });
});

describe("grouping, past the first exchange", () => {
  test("a text followed by work demotes into the work", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "go"),
      answerOf("a1", "first, a look"),
      entryOf("a2", "Assistant", [
        { block: "ToolUse", id: "call-1", name: "Read", input: {} },
      ]),
      answerOf("a3", "the answer"),
    ]);
    expect(exchanges[0]?.work).toEqual([
      { step: "Text", text: "first, a look" },
      { step: "ToolCall", id: "call-1", name: "Read", input: {} },
    ]);
    expect(exchanges[0]?.answer).toBe("the answer");
  });

  test("thinking and an unknown kind are work, and texts join", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "go"),
      entryOf("a1", "Assistant", [
        { block: "Thinking", text: "weighed" },
        { block: "Other", kind: "redacted_thinking" },
        { block: "Text", text: "one" },
        { block: "Text", text: "" },
        { block: "Text", text: "two" },
      ]),
    ]);
    expect(exchanges[0]?.work).toEqual([
      { step: "Thinking", text: "weighed" },
      { step: "Other", kind: "redacted_thinking" },
    ]);
    expect(exchanges[0]?.answer).toBe("one\ntwo");
  });

  test("entries before any ask open an exchange with no ask", () => {
    const exchanges = conversationExchanges([
      answerOf("a1", "spoke first"),
      askOf("u1", "now you"),
      answerOf("a2", "replied"),
    ]);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]?.ask).toBeUndefined();
    expect(exchanges[0]?.answer).toBe("spoke first");
  });

  test("an exchange with no answer and no turn stands open", () => {
    const exchanges = conversationExchanges([askOf("u1", "still going")]);
    expect(exchanges[0]?.standing).toEqual({ standing: "Open" });
  });
});

describe("markers", () => {
  const compaction: ConversationItem = {
    item: "Marker",
    marker: { marker: "Compaction", at: "2026-09-06T00:00:00.000Z" },
  };

  test("a marker lands on the exchange it precedes", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "before"),
      answerOf("a1", "done"),
      compaction,
      askOf("u2", "after"),
    ]);
    expect(exchanges[0]?.before).toEqual([]);
    expect(exchanges[1]?.before).toEqual([compaction.marker]);
  });

  test("a marker with nothing after it lands on a trailing exchange, which stands as markers and not as Open", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "before"),
      answerOf("a1", "done"),
      { item: "Marker", marker: { marker: "Truncated" } },
    ]);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1]?.ask).toBeUndefined();
    expect(exchanges[1]?.work).toEqual([]);
    expect(exchanges[1]?.before).toEqual([{ marker: "Truncated" }]);
    expect(exchanges[1]?.standing).toEqual({ standing: "Markers" });
  });

  test("an entry with no readable blocks still opens an exchange, and only the trailing carrier stands as markers", () => {
    const exchanges = conversationExchanges([
      entryOf("u1", "User", []),
      { item: "Marker", marker: { marker: "Truncated" } },
    ]);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]?.standing).toEqual({ standing: "Open" });
    expect(exchanges[1]?.standing).toEqual({ standing: "Markers" });
  });

  test("a trailing marker set becomes the before of the first turn the overlay appends", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "before"), answerOf("a1", "done"), compaction],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "queued", state: "Queued" }),
        turnOf({ turn: "t2", ordinal: 2, input: "claimed", state: "Claimed" }),
      ],
    );
    expect(exchanges).toHaveLength(3);
    expect(exchanges[1]?.before).toEqual([compaction.marker]);
    expect(exchanges[1]?.ask).toEqual({ ask: "Message", text: "queued" });
    expect(exchanges[1]?.standing).toEqual({
      standing: "Running",
      state: "Queued",
    });
    expect(exchanges[2]?.before).toEqual([]);
  });
});

describe("the mailbox overlay", () => {
  test("a turn matches its exchange by exact input and speaks for it", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "what did it say"), answerOf("a1", "this")],
      [
        turnOf({
          turn: "t1",
          input: "what did it say",
          tokens: 900,
          durationMs: 4200,
        }),
      ],
    );
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.standing).toEqual({ standing: "Answered" });
    expect(exchanges[0]?.measures).toEqual({ tokens: 900, durationMs: 4200 });
  });

  test("the matched turn's kind is what the ask is drawn as", () => {
    const input = JSON.stringify({ wake: "TicketDone", resource: "ticket-44" });
    const exchanges = conversationExchanges(
      [askOf("u1", input)],
      [turnOf({ turn: "t1", inputKind: "Wake", input })],
    );
    expect(exchanges[0]?.ask).toEqual({
      ask: "Wake",
      wake: "TicketDone",
      resource: "ticket-44",
    });
  });

  test("a wake whose pointer cannot be read draws as its kind", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "not a document")],
      [turnOf({ turn: "t1", inputKind: "Wake", input: "not a document" })],
    );
    expect(exchanges[0]?.ask).toEqual({ ask: "Document", kind: "Wake" });
  });
});

describe("the mailbox overlay, on turns that asked the same thing", () => {
  test("two identical inputs each take their own exchange, in the order written", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u1", "again"),
        answerOf("a1", "first"),
        askOf("u2", "again"),
        answerOf("a2", "second"),
      ],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "again", tokens: 1 }),
        turnOf({ turn: "t2", ordinal: 2, input: "again", tokens: 2 }),
      ],
    );
    expect(exchanges[0]?.measures).toEqual({ tokens: 1 });
    expect(exchanges[1]?.measures).toEqual({ tokens: 2 });
  });

  test("the same thing asked again is not given the earlier ask's exchange while its own is unstored", () => {
    const first = [askOf("u1", "again"), answerOf("a1", "first")];
    const turns = [
      turnOf({ turn: "t1", ordinal: 1, input: "again" }),
      turnOf({ turn: "t2", ordinal: 2, input: "again", state: "Claimed" }),
    ];
    const before = conversationExchanges(first, turns);
    expect(before.map((exchange) => exchange.turn)).toEqual(["t1", "t2"]);
    expect(before.map((exchange) => exchange.answer)).toEqual([
      "first",
      undefined,
    ]);
    const after = conversationExchanges(
      [...first, askOf("u2", "again"), answerOf("a2", "sec")],
      turns,
    );
    expect(after.map((exchange) => exchange.turn)).toEqual(["t1", "t2"]);
    expect(after.map((exchange) => exchange.answer)).toEqual(["first", "sec"]);
    expect(after.map((exchange) => exchange.id)).toEqual(["u1", "u2"]);
  });
});

describe("the mailbox overlay, on the same thing asked of a turn that did not answer", () => {
  test("a turn that failed before storing its ask does not keep the exchange of the same ask sent again", () => {
    const failed = turnOf({
      turn: "t1",
      ordinal: 1,
      input: "again",
      state: "Failed",
    });
    for (const state of ["Claimed", "Answered"] as const) {
      const exchanges = conversationExchanges(
        [askOf("u2", "again"), answerOf("a2", "second")],
        [failed, turnOf({ turn: "t2", ordinal: 2, input: "again", state })],
      );
      expect(exchanges.map((exchange) => exchange.turn)).toEqual(["t2", "t1"]);
      expect(exchanges[0]?.answer).toBe("second");
      expect(exchanges[1]?.standing).toEqual({ standing: "Failed" });
      expect(exchanges[1]?.answer).toBeUndefined();
    }
  });

  test("a turn lost before it ran does not keep the exchange of the same ask sent again", () => {
    const failed = turnOf({
      turn: "t1",
      ordinal: 1,
      input: "again",
      state: "Failed",
      failure: "AttemptLost",
    });
    for (const state of ["Claimed", "Answered"] as const) {
      const exchanges = conversationExchanges(
        [askOf("u2", "again"), answerOf("a2", "second")],
        [failed, turnOf({ turn: "t2", ordinal: 2, input: "again", state })],
      );
      expect(exchanges.map((exchange) => exchange.turn)).toEqual(["t2", "t1"]);
      expect(exchanges[0]?.answer).toBe("second");
      expect(exchanges[1]?.standing).toEqual({
        standing: "Failed",
        failure: "AttemptLost",
      });
      expect(exchanges[1]?.answer).toBeUndefined();
    }
  });

  test("a turn a runner took keeps its exchange from the same ask waiting behind it", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "again"), answerOf("a1", "so far")],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "again", state: "Claimed" }),
        turnOf({ turn: "t2", ordinal: 2, input: "again", state: "Queued" }),
      ],
    );
    expect(exchanges.map((exchange) => exchange.turn)).toEqual(["t1", "t2"]);
    expect(exchanges[0]?.answer).toBe("so far");
    expect(exchanges[1]?.standing).toEqual({
      standing: "Running",
      state: "Queued",
    });
  });
});

describe("the mailbox overlay, on the exchanges of one ask counted against its turns", () => {
  test("two answered turns of one ask and one exchange read so far: the older turn is the one that stored it", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "again"), answerOf("a1", "first")],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "again", tokens: 1 }),
        turnOf({ turn: "t2", ordinal: 2, input: "again", tokens: 2 }),
      ],
    );
    expect(exchanges.map((exchange) => exchange.turn)).toEqual(["t1"]);
    expect(exchanges[0]?.measures).toEqual({ tokens: 1 });
  });

  test("more exchanges of one ask than turns leaves the oldest to the transcript", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u1", "again"),
        answerOf("a1", "first"),
        askOf("u2", "again"),
        answerOf("a2", "second"),
      ],
      [turnOf({ turn: "t2", ordinal: 2, input: "again", tokens: 2 })],
    );
    expect(exchanges.map((exchange) => exchange.turn)).toEqual([
      undefined,
      "t2",
    ]);
  });
});

const half = [askOf("u1", "go"), answerOf("a1", "Half an answer")];

describe("the mailbox overlay, on the same thing asked again of a turn that ran and failed", () => {
  test("a turn its session reported failed keeps its exchange while the same ask waits and is taken", () => {
    for (const failure of ["AgentTurnsExhausted", undefined] as const) {
      const failed = turnOf({
        turn: "t1",
        ordinal: 1,
        input: "go",
        state: "Failed",
        ...(failure === undefined ? {} : { failure }),
      });
      for (const state of ["Queued", "Claimed"] as const) {
        const exchanges = conversationExchanges(
          half,
          [failed, turnOf({ turn: "t2", ordinal: 2, input: "go", state })],
          undefined,
          undefined,
          heldBefore(1, "u1"),
        );
        expect(exchanges.map((exchange) => exchange.turn)).toEqual([
          "t1",
          "t2",
        ]);
        expect(exchanges[0]?.answer).toBe("Half an answer");
        expect(exchanges[0]?.standing.standing).toBe("Failed");
        expect(exchanges[1]?.work).toEqual([]);
        expect(exchanges[1]?.answer).toBeUndefined();
      }
    }
  });
});

describe("the mailbox overlay, on a turn its session reported failed and the same ask left waiting", () => {
  test("its stored words stay its own on a page opened while the same ask waits, whatever failure it was reported in", () => {
    for (const failure of ["AgentFailed", "StoreRefused", undefined] as const) {
      const failed = turnOf({
        turn: "t1",
        ordinal: 1,
        input: "go",
        state: "Failed",
        ...(failure === undefined ? {} : { failure }),
      });
      const waiting = turnOf({
        turn: "t2",
        ordinal: 2,
        input: "go",
        state: "Queued",
      });
      expect(pairedUnder(half, [failed, waiting])).toEqual([
        ["u1", "t1"],
        ["t2", "t2"],
      ]);
    }
  });

  test("one exchange left between a turn whose attempts were lost and a later one its session reported is the reported one's", () => {
    const exchanges = pairedUnder(
      [
        askOf("u2", "go"),
        answerOf("a2", "Half an answer"),
        askOf("u3", "go"),
        answerOf("a3", "Third."),
      ],
      [
        turnOf({
          turn: "t1",
          ordinal: 1,
          input: "go",
          state: "Failed",
          failure: "AttemptLost",
        }),
        turnOf({
          turn: "t2",
          ordinal: 2,
          input: "go",
          state: "Failed",
          failure: "AgentFailed",
        }),
        turnOf({ turn: "t3", ordinal: 3, input: "go", result: "Third." }),
      ],
    );
    expect(exchanges).toEqual([
      ["u2", "t2"],
      ["u3", "t3"],
      ["t1", "t1"],
    ]);
  });
});

describe("the mailbox overlay, on a turn that ended on a failure only a run names", () => {
  test("a failure only a run names keeps its exchange on a page opened while the same ask is taken", () => {
    for (const failure of [
      "AgentTurnsExhausted",
      "AgentBudgetExhausted",
      "AgentRateLimited",
    ] as const) {
      const exchanges = conversationExchanges(half, [
        turnOf({
          turn: "t1",
          ordinal: 1,
          input: "go",
          state: "Failed",
          failure,
        }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
      ]);
      expect(pairs(exchanges)).toEqual([
        ["u1", "t1"],
        ["t2", "t2"],
      ]);
    }
  });

  test("the retry takes the exchange its own ask opened and leaves the failed turn its own", () => {
    const exchanges = conversationExchanges(
      [...half, askOf("u2", "go")],
      [
        turnOf({
          turn: "t1",
          ordinal: 1,
          input: "go",
          state: "Failed",
          failure: "AgentBudgetExhausted",
        }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
      ],
    );
    expect(exchanges.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u1", "t1"],
      ["u2", "t2"],
    ]);
  });
});

describe("the mailbox overlay, on the same thing asked a third time", () => {
  const items = [
    askOf("u1", "go"),
    answerOf("a1", "First answer."),
    askOf("u2", "go"),
    answerOf("a2", "Half a second"),
  ];
  const turns = [
    turnOf({ turn: "t1", ordinal: 1, input: "go" }),
    turnOf({
      turn: "t2",
      ordinal: 2,
      input: "go",
      state: "Failed",
      failure: "AgentFailed",
    }),
    turnOf({ turn: "t3", ordinal: 3, input: "go", state: "Claimed" }),
  ];
  const drawn = (
    record?: ConversationRecord,
  ): readonly (readonly [string | undefined, string, string | undefined])[] =>
    conversationExchanges(items, turns, undefined, undefined, record).map(
      (exchange) =>
        [exchange.turn, exchange.standing.standing, exchange.answer] as const,
    );

  test("answered, failed with its ask stored, and asked a third time: each keeps its own", () => {
    expect(drawn(heldBefore(2, "u1", "u2"))).toEqual([
      ["t1", "Answered", "First answer."],
      ["t2", "Failed", "Half a second"],
      ["t3", "Running", undefined],
    ]);
  });

  test("on a page opened while the third is out, nothing says whose the second exchange is and the turn that is out takes it", () => {
    expect(drawn()).toEqual([
      ["t1", "Answered", "First answer."],
      ["t3", "Running", "Half a second"],
      ["t2", "Failed", undefined],
    ]);
  });
});

const hello = [askOf("u2", "hello"), answerOf("a2", "Hi, I am here.")];

/** A turn its session reported failed, in the failure it named or, with
 * `Unnamed`, in none. */
function refusedAt(
  ordinal: number,
  failure: "AgentFailed" | "StoreRefused" | "Unnamed" = "AgentFailed",
): ConversationTurn {
  return turnOf({
    turn: `t${String(ordinal)}`,
    ordinal,
    input: "hello",
    state: "Failed",
    ...(failure === "Unnamed" ? {} : { failure }),
  });
}

function helloAnswered(ordinal: number, result: string): ConversationTurn {
  return turnOf({
    turn: `t${String(ordinal)}`,
    ordinal,
    input: "hello",
    result,
  });
}

describe("the mailbox overlay, on a turn its session refused without running", () => {
  test("refused, sent again and answered: the answer is the second turn's and the refused one is its ask and its failure", () => {
    for (const failure of ["AgentFailed", "StoreRefused", "Unnamed"] as const) {
      const exchanges = conversationExchanges(hello, [
        refusedAt(1, failure),
        helloAnswered(2, "Hi, I am here."),
      ]);
      expect(pairs(exchanges)).toEqual([
        ["u2", "t2"],
        ["t1", "t1"],
      ]);
      expect(exchanges[0]?.standing).toEqual({ standing: "Answered" });
      expect(exchanges[0]?.answer).toBe("Hi, I am here.");
      expect(exchanges[1]?.standing.standing).toBe("Failed");
      expect(exchanges[1]?.work).toEqual([]);
      expect(exchanges[1]?.answer).toBeUndefined();
    }
  });

  test("the same while the retry is being answered, on a page opened part way through it", () => {
    const exchanges = conversationExchanges(
      [askOf("u2", "hello"), answerOf("a2", "Hi, I am")],
      [
        refusedAt(1),
        turnOf({ turn: "t2", ordinal: 2, input: "hello", state: "Claimed" }),
      ],
    );
    expect(pairs(exchanges)).toEqual([
      ["u2", "t2"],
      ["t1", "t1"],
    ]);
    expect(exchanges[0]?.answer).toBe("Hi, I am");
  });

  test("three refusals then an answer: the one exchange is the answered turn's", () => {
    const exchanges = conversationExchanges(
      [askOf("u4", "hello"), answerOf("a4", "Hi, I am here.")],
      [
        refusedAt(1),
        refusedAt(2),
        refusedAt(3),
        helloAnswered(4, "Hi, I am here."),
      ],
    );
    expect(pairs(exchanges)).toEqual([
      ["u4", "t4"],
      ["t1", "t1"],
      ["t2", "t2"],
      ["t3", "t3"],
    ]);
  });
});

describe("the mailbox overlay, on a refused turn among answered ones that asked the same", () => {
  const first = [askOf("u1", "hello"), answerOf("a1", "First.")];
  const third = [askOf("u3", "hello"), answerOf("a3", "Third.")];

  test("refused, then answered twice: each answered turn keeps its own", () => {
    const exchanges = conversationExchanges(
      [askOf("u2", "hello"), answerOf("a2", "Second."), ...third],
      [refusedAt(1), helloAnswered(2, "Second."), helloAnswered(3, "Third.")],
    );
    expect(pairs(exchanges)).toEqual([
      ["u2", "t2"],
      ["u3", "t3"],
      ["t1", "t1"],
    ]);
  });

  test("refused between two answered turns: neither answered turn's exchange moves", () => {
    const exchanges = conversationExchanges(
      [...first, ...third],
      [helloAnswered(1, "First."), refusedAt(2), helloAnswered(3, "Third.")],
    );
    expect(pairs(exchanges)).toEqual([
      ["u1", "t1"],
      ["u3", "t3"],
      ["t2", "t2"],
    ]);
  });

  test("its stored words reading as the answer before them are still its own where the count leaves one over", () => {
    const exchanges = conversationExchanges(
      [...first, askOf("u2", "hello"), answerOf("a2", "First.")],
      [helloAnswered(1, "First."), refusedAt(2)],
    );
    expect(pairs(exchanges)).toEqual([
      ["u1", "t1"],
      ["u2", "t2"],
    ]);
  });

  test("a turn that ran and was reported failed between two answered ones keeps the exchange left over", () => {
    const exchanges = conversationExchanges(
      [...first, askOf("u2", "hello"), answerOf("a2", "Half"), ...third],
      [helloAnswered(1, "First."), refusedAt(2), helloAnswered(3, "Third.")],
    );
    expect(pairs(exchanges)).toEqual([
      ["u1", "t1"],
      ["u2", "t2"],
      ["u3", "t3"],
    ]);
  });
});

describe("the mailbox overlay, on a turn its session reported failed in a record that cannot be counted", () => {
  const fortieth = [askOf("u40", "hello"), answerOf("a40", "Fortieth.")];
  const last = [askOf("u42", "hello"), answerOf("a42", "Forty-second.")];
  const turns = [
    helloAnswered(40, "Fortieth."),
    refusedAt(41),
    helloAnswered(42, "Forty-second."),
  ];

  test("it keeps the words it stored where no answered turn's answer reads as them", () => {
    const items = [
      dropped,
      ...fortieth,
      askOf("u41", "hello"),
      answerOf("a41", "Half"),
      ...last,
    ];
    expect(pairedUnder(items, turns)).toEqual([
      ["u40", "t40"],
      ["u41", "t41"],
      ["u42", "t42"],
    ]);
    for (const failure of ["StoreRefused", "Unnamed"] as const) {
      const named = [turns[0], refusedAt(41, failure), turns[2]].flatMap(
        (turn) => (turn === undefined ? [] : [turn]),
      );
      expect(pairedUnder(items, named)[1]).toEqual(["u41", "t41"]);
    }
  });

  test("refused after two answered turns, it leaves the exchange reading as the nearer one's answer to that one", () => {
    const exchanges = conversationExchanges(
      [dropped, ...fortieth],
      [
        helloAnswered(39, "Thirty-ninth."),
        helloAnswered(40, "Fortieth."),
        refusedAt(41),
      ],
    );
    expect(pairs(exchanges)).toEqual([
      ["u40", "t40"],
      ["t41", "t41"],
    ]);
  });

  test("refused, it takes no exchange that reads as the answer of the answered turn before it", () => {
    const exchanges = conversationExchanges(
      [dropped, ...fortieth, ...last],
      turns,
    );
    expect(pairs(exchanges)).toEqual([
      ["u40", "t40"],
      ["u42", "t42"],
      ["t41", "t41"],
    ]);
  });

  test("with no answered turn before it, it takes the exchange that is there", () => {
    const exchanges = conversationExchanges(
      [dropped, askOf("u41", "hello"), answerOf("a41", "Half"), ...last],
      turns.slice(1),
    );
    expect(pairs(exchanges)).toEqual([
      ["u41", "t41"],
      ["u42", "t42"],
    ]);
  });
});

describe("the mailbox overlay, on an exchange a page held before the turn that is out was listed", () => {
  const out = turnOf({
    turn: "t41",
    ordinal: 41,
    input: "go",
    state: "Claimed",
  });

  test("in a record that cannot be counted, a reported turn's stored words stay its own while the same is taken", () => {
    const turns = [
      turnOf({
        turn: "t40",
        ordinal: 40,
        input: "go",
        state: "Failed",
        failure: "AgentFailed",
      }),
      out,
    ];
    const items = [dropped, ...half];
    expect(pairedUnder(items, turns)).toEqual([
      ["u1", "t41"],
      ["t40", "t40"],
    ]);
    expect(pairedUnder(items, turns, heldBefore(40, "u1"))).toEqual([
      ["u1", "t40"],
      ["t41", "t41"],
    ]);
  });

  test("an answered turn's exchange read short of its last words stays its own", () => {
    const short = [dropped, askOf("u1", "go"), answerOf("a1", "Looking.")];
    const turns = [
      turnOf({ turn: "t40", ordinal: 40, input: "go", result: "Fortieth." }),
      out,
    ];
    expect(pairedUnder(short, turns)).toEqual([["u1", "t41"]]);
    expect(pairedUnder(short, turns, heldBefore(40, "u1"))).toEqual([
      ["u1", "t40"],
      ["t41", "t41"],
    ]);
  });

  test("a message heard under the turn that is out outweighs what the page held before", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "go"), storedOf("a1", "m1", "Half an answer")],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go", state: "Failed" }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
      ],
      undefined,
      new Map([["m1", "t2"]]),
      heldBefore(1, "u1"),
    );
    expect(pairs(exchanges)).toEqual([
      ["u1", "t2"],
      ["t1", "t1"],
    ]);
  });
});

describe("what a page has seen of its exchanges", () => {
  const first = turnOf({ turn: "t1", ordinal: 1, input: "go" });
  const second = turnOf({ turn: "t2", ordinal: 2, input: "go" });

  test("nothing is noted until the walk has nothing left to read", () => {
    expect(
      conversationSeenWith(conversationSeenNothing, half, [first], false),
    ).toBe(conversationSeenNothing);
  });

  test("an exchange is given the newest turn listed when it was first held, and keeps it", () => {
    const seen = conversationSeenWith(
      conversationSeenNothing,
      half,
      [first],
      true,
    );
    expect([...seen]).toEqual([["u1", 1]]);
    const later = conversationSeenWith(
      seen,
      [...half, askOf("u2", "go")],
      [first, second],
      true,
    );
    expect([...later]).toEqual([
      ["u1", 1],
      ["u2", 2],
    ]);
  });

  test("what was seen is handed back itself while the same exchanges are held", () => {
    const seen = conversationSeenWith(
      conversationSeenNothing,
      half,
      [first],
      true,
    );
    expect(
      conversationSeenWith(
        seen,
        [...half, answerOf("a2", "more")],
        [first, second],
        true,
      ),
    ).toBe(seen);
  });

  test("an exchange no longer held is let go of, and one held under no turn is held before every turn", () => {
    const seen = conversationSeenWith(conversationSeenNothing, half, [], true);
    expect([...seen]).toEqual([["u1", 0]]);
    expect([
      ...conversationSeenWith(seen, [askOf("u2", "go")], [first], true),
    ]).toEqual([["u2", 1]]);
  });

  test("no more exchanges are remembered than a page draws, the oldest leaving first", () => {
    const asks = Array.from(
      { length: conversationExchangesMax + 1 },
      (_unused, at) => askOf(`u${String(at)}`, `ask ${String(at)}`),
    );
    const seen = conversationSeenWith(
      conversationSeenNothing,
      asks,
      [first],
      true,
    );
    expect(seen.size).toBe(conversationExchangesMax);
    expect(seen.has("u0")).toBe(false);
    expect(seen.has(`u${String(conversationExchangesMax)}`)).toBe(true);
  });
});

describe("the mailbox overlay, on a record that is not the thread's whole record", () => {
  const replaced: ConversationRecord = {
    seen: conversationSeenNothing,
    replaced: true,
  };
  const old = turnOf({
    turn: "t1",
    ordinal: 1,
    input: "go",
    result: "Old answer.",
  });
  const paired = (
    items: readonly ConversationItem[],
    newer: ConversationTurn,
    record?: ConversationRecord,
  ): readonly (readonly [string, string | undefined])[] =>
    pairedUnder(items, [old, newer], record);

  test("a replaced stream holding the new turn's stored words, none heard: they are its own", () => {
    const items = [askOf("u2", "go"), answerOf("a2", "New answer so far")];
    const out = turnOf({
      turn: "t2",
      ordinal: 2,
      input: "go",
      state: "Claimed",
    });
    expect(paired(items, out, replaced)).toEqual([["u2", "t2"]]);
    expect(paired(items, out)).toEqual([
      ["u2", "t1"],
      ["t2", "t2"],
    ]);
  });

  test("a replaced stream, both answered: the newer answer is under its own turn whatever it reads as", () => {
    const items = [
      askOf("u2", "go"),
      answerOf("a2", "New answer, with a secret."),
    ];
    const newer = turnOf({
      turn: "t2",
      ordinal: 2,
      input: "go",
      result: "New answer, with a [scrubbed].",
    });
    expect(paired(items, newer, replaced)).toEqual([["u2", "t2"]]);
    expect(paired(items, newer)).toEqual([["u2", "t1"]]);
  });

  test("fewer exchanges than answered turns, the newest reading as the newest turn's answer: the page is not behind", () => {
    const items = [askOf("u2", "go"), answerOf("a2", "New answer.")];
    const newer = turnOf({
      turn: "t2",
      ordinal: 2,
      input: "go",
      result: "New answer.",
    });
    expect(paired(items, newer)).toEqual([["u2", "t2"]]);
    expect(
      paired([askOf("u1", "go"), answerOf("a1", "Old answer.")], newer),
    ).toEqual([["u1", "t1"]]);
  });
});

describe("the mailbox overlay, on a record holding more exchanges than a page draws", () => {
  test("the one exchange of an ask left on the page is the turn's that is out, though the mailbox holds its first turn", () => {
    const old = turnOf({
      turn: "t1",
      ordinal: 1,
      input: "go",
      result: "Old answer.",
    });
    const filling = Array.from(
      { length: conversationExchangesMax - 1 },
      (_unused, at) => askOf(`f${String(at)}`, `ask ${String(at)}`),
    );
    const items = [
      askOf("u1", "go"),
      answerOf("a1", "Old answer."),
      ...filling,
      askOf("u2", "go"),
      answerOf("a2", "New answer so far"),
    ];
    const out = turnOf({
      turn: "t2",
      ordinal: 2,
      input: "go",
      state: "Claimed",
    });
    const exchanges = conversationExchanges(items, [old, out]);
    expect(exchanges).toHaveLength(conversationExchangesMax);
    expect(exchanges.at(-1)?.id).toBe("u2");
    expect(exchanges.at(-1)?.turn).toBe("t2");
    expect(exchanges.some((exchange) => exchange.turn === "t1")).toBe(false);
  });
});

describe("the mailbox overlay, on the same thing asked again of a turn whose attempts were lost", () => {
  test("a turn lost before it ran, between two answered ones, takes neither's exchange", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u1", "go"),
        answerOf("a1", "First."),
        askOf("u3", "go"),
        answerOf("a3", "Third."),
      ],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go", tokens: 1 }),
        turnOf({
          turn: "t2",
          ordinal: 2,
          input: "go",
          state: "Failed",
          failure: "AttemptLost",
        }),
        turnOf({ turn: "t3", ordinal: 3, input: "go", tokens: 3 }),
      ],
    );
    expect(
      exchanges.map((exchange) => [
        exchange.turn,
        exchange.answer,
        exchange.measures,
      ]),
    ).toEqual([
      ["t1", "First.", { tokens: 1 }],
      ["t3", "Third.", { tokens: 3 }],
      ["t2", undefined, undefined],
    ]);
  });

  const lost = turnOf({
    turn: "t1",
    ordinal: 1,
    input: "go",
    state: "Failed",
    failure: "AttemptLost",
  });

  test("a turn whose attempts were lost after it ran keeps its exchange while the same ask waits, and once the retry's own is stored", () => {
    const waiting = conversationExchanges(half, [
      lost,
      turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Queued" }),
    ]);
    expect(waiting.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u1", "t1"],
      ["t2", "t2"],
    ]);
    const retried = conversationExchanges(
      [...half, askOf("u2", "go")],
      [lost, turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" })],
    );
    expect(retried.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u1", "t1"],
      ["u2", "t2"],
    ]);
    expect(retried[0]?.standing).toEqual({
      standing: "Failed",
      failure: "AttemptLost",
    });
  });
});

const lostSecond = turnOf({
  turn: "t2",
  ordinal: 2,
  input: "go",
  state: "Failed",
  failure: "AttemptLost",
});

describe("the mailbox overlay, on a turn that ended saying nothing of itself", () => {
  test("a turn lost after it ran, between two answered ones, keeps the exchange no other turn accounts for", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u1", "go"),
        answerOf("a1", "First."),
        ...half.map((item, at) =>
          item.item === "Entry"
            ? { ...item, entry: { ...item.entry, id: `lost-${String(at)}` } }
            : item,
        ),
        askOf("u3", "go"),
        answerOf("a3", "Third."),
      ],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go" }),
        lostSecond,
        turnOf({ turn: "t3", ordinal: 3, input: "go" }),
      ],
    );
    expect(
      exchanges.map((exchange) => [exchange.turn, exchange.answer]),
    ).toEqual([
      ["t1", "First."],
      ["t2", "Half an answer"],
      ["t3", "Third."],
    ]);
  });

  test("two turns that ended saying nothing and one exchange to spare: neither is given it", () => {
    const exchanges = conversationExchanges(
      [...half, askOf("u3", "go"), answerOf("a3", "Third.")],
      [
        { ...lostSecond, turn: "t1", ordinal: 1 },
        lostSecond,
        turnOf({ turn: "t3", ordinal: 3, input: "go", result: "Third." }),
      ],
    );
    expect(exchanges.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u1", undefined],
      ["u3", "t3"],
      ["t1", "t1"],
      ["t2", "t2"],
    ]);
  });
});

describe("the mailbox overlay, on a turn withdrawn before a runner had it", () => {
  test("a turn withdrawn while it waited behind one waiting again takes nothing from it", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "go"), answerOf("a1", "so far")],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go", state: "Queued" }),
        turnOf({
          turn: "t2",
          ordinal: 2,
          input: "go",
          state: "Abandoned",
          failure: "TurnWithdrawn",
        }),
      ],
    );
    expect(exchanges.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u1", "t1"],
      ["t2", "t2"],
    ]);
  });

  test("a withdrawn turn takes no exchange from the same ask sent after it", () => {
    const exchanges = conversationExchanges(
      [askOf("u2", "go")],
      [
        turnOf({
          turn: "t1",
          ordinal: 1,
          input: "go",
          state: "Abandoned",
          failure: "TurnWithdrawn",
        }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
      ],
    );
    expect(exchanges.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u2", "t2"],
      ["t1", "t1"],
    ]);
  });
});

/** An entry of a model message, which is what tells a stored block's message
 * from another's. */
function storedOf(id: string, message: string, text: string): ConversationItem {
  return {
    item: "Entry",
    entry: {
      id,
      role: "Assistant",
      message,
      blocks: [{ block: "Text", text }],
    },
  };
}

const dropped: ConversationItem = {
  item: "Marker",
  marker: { marker: "Dropped", count: 40 },
};

describe("the mailbox overlay, on a page holding fewer exchanges of an ask than turns stored it", () => {
  const twentieth = [
    askOf("ask-20", "continue"),
    answerOf("a20", "Twentieth answer."),
  ];
  const answered = [
    turnOf({ turn: "turn-5", ordinal: 5, input: "continue", costMicros: 5 }),
    turnOf({ turn: "turn-20", ordinal: 20, input: "continue", costMicros: 20 }),
  ];

  test("an answered turn keeps its own exchange when an older one that asked the same has left the page", () => {
    const exchanges = conversationExchanges(twentieth, answered);
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.turn).toBe("turn-20");
    expect(exchanges[0]?.measures).toEqual({ costMicros: 20 });
  });

  test("the turn being answered keeps its own exchange, and the older answered one draws nothing", () => {
    const exchanges = conversationExchanges(
      [
        ...twentieth,
        askOf("ask-33", "continue"),
        answerOf("a33", "Working on it"),
      ],
      [
        ...answered,
        turnOf({
          turn: "turn-33",
          ordinal: 33,
          input: "continue",
          state: "Claimed",
        }),
      ],
    );
    expect(exchanges.map((exchange) => exchange.turn)).toEqual([
      "turn-20",
      "turn-33",
    ]);
    expect(exchanges[0]?.measures).toEqual({ costMicros: 20 });
    expect(exchanges[1]?.answer).toBe("Working on it");
  });
});

describe("the mailbox overlay, on a page whose record is cut and the same ask out again", () => {
  const second = [askOf("u2", "go"), answerOf("a2", "Second.")];
  const turns = [
    turnOf({ turn: "t1", ordinal: 1, input: "go", result: "First." }),
    turnOf({ turn: "t2", ordinal: 2, input: "go", result: "Second." }),
    turnOf({ turn: "t3", ordinal: 3, input: "go", state: "Claimed" }),
  ];
  const paired = (
    items: readonly ConversationItem[],
    heardUnder?: ReadonlyMap<string, string>,
  ): readonly (readonly [string, string | undefined])[] =>
    conversationExchanges(
      [dropped, ...items],
      turns,
      undefined,
      heardUnder,
    ).map((exchange) => [exchange.id, exchange.turn] as const);

  test("its ask not stored yet: the newest exchange reads as the answer before it and stays that turn's", () => {
    expect(paired(second)).toEqual([
      ["u2", "t2"],
      ["t3", "t3"],
    ]);
  });

  test("its ask stored and nothing written under it yet: the exchange is its own", () => {
    expect(paired([...second, askOf("u3", "go")])).toEqual([
      ["u2", "t2"],
      ["u3", "t3"],
    ]);
  });

  test("its ask and some work stored, none of it heard: the exchange does not read as the answer before it and is its own", () => {
    expect(
      paired([...second, askOf("u3", "go"), answerOf("a3", "Working on it")]),
    ).toEqual([
      ["u2", "t2"],
      ["u3", "t3"],
    ]);
  });

  test("with only its own exchange left on the page, the answered turns draw nothing", () => {
    expect(
      paired([askOf("u3", "go"), answerOf("a3", "Working on it")]),
    ).toEqual([["u3", "t3"]]);
  });

  test("a stored message heard under the turn that is out says the exchange is its own whatever it reads as", () => {
    const same = [askOf("u3", "go"), storedOf("a3", "m3", "Second.")];
    expect(paired(same)).toEqual([
      ["u3", "t2"],
      ["t3", "t3"],
    ]);
    expect(paired(same, new Map([["m3", "t3"]]))).toEqual([["u3", "t3"]]);
  });

  test("a turn that is waiting is given no exchange of a record that cannot be counted", () => {
    const waiting = conversationExchanges(
      [dropped, ...second, askOf("u3", "go")],
      [
        ...turns.slice(0, 2),
        turnOf({ turn: "t3", ordinal: 3, input: "go", state: "Queued" }),
      ],
    );
    expect(waiting.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u2", "t1"],
      ["u3", "t2"],
      ["t3", "t3"],
    ]);
  });
});

describe("the mailbox overlay, on a whole record", () => {
  test("an exchange that ends on no answer is not the answered turn's, whatever the count says", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u2", "go"),
        entryOf("a2", "Assistant", [
          { block: "Text", text: "Looking at 41." },
          { block: "ToolUse", id: "call-1", name: "Read", input: {} },
        ]),
      ],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go", result: "Old answer." }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
      ],
    );
    expect(exchanges.map((exchange) => [exchange.id, exchange.turn])).toEqual([
      ["u2", "t2"],
    ]);
  });

  test("a turn waiting again takes the exchange its first attempt stored", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "go"), answerOf("a1", "so far")],
      [turnOf({ turn: "t1", ordinal: 1, input: "go", state: "Queued" })],
    );
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.standing).toEqual({
      standing: "Running",
      state: "Queued",
    });
  });
});

describe("the mailbox overlay, on a whole record the page is behind on", () => {
  test("a walk stopped part way through an exchange leaves it the turn that stored it, however it ends", () => {
    for (const marker of ["Unreached", "Failure"] as const) {
      const exchanges = conversationExchanges(
        [
          askOf("u1", "go"),
          entryOf("a1", "Assistant", [
            { block: "ToolUse", id: "call-1", name: "Read", input: {} },
          ]),
          {
            item: "Marker",
            marker:
              marker === "Failure"
                ? { marker, reason: "read failed" }
                : { marker },
          },
        ],
        [
          turnOf({ turn: "t1", ordinal: 1, input: "go", result: "Done." }),
          turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
        ],
      );
      expect(exchanges[0]?.turn).toBe("t1");
    }
  });

  test("a page behind by whole exchanges gives the ones it holds to the oldest turns, whatever the newest ends on", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u1", "go"),
        answerOf("a1", "First."),
        askOf("u2", "go"),
        entryOf("a2", "Assistant", [
          { block: "ToolUse", id: "call-1", name: "Read", input: {} },
        ]),
      ],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go", result: "First." }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", result: "Second." }),
        turnOf({ turn: "t3", ordinal: 3, input: "go", result: "Third." }),
        turnOf({ turn: "t4", ordinal: 4, input: "go", state: "Claimed" }),
      ],
    );
    expect(exchanges.map((exchange) => exchange.turn)).toEqual([
      "t1",
      "t2",
      "t4",
    ]);
  });

  test("a walk still reading holds the oldest exchanges, and the oldest turns take them", () => {
    const exchanges = conversationExchanges(
      [
        { item: "Marker", marker: { marker: "Unreached" } },
        askOf("u1", "go"),
        answerOf("a1", "First."),
      ],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "go", tokens: 1 }),
        turnOf({ turn: "t2", ordinal: 2, input: "go", tokens: 2 }),
      ],
    );
    expect(exchanges[0]?.turn).toBe("t1");
  });
});

/** Each exchange drawn, by the entry that opened it and the turn it is drawn
 * under. */
function pairs(
  exchanges: readonly ConversationExchange[],
): readonly (readonly [string, string | undefined])[] {
  return exchanges.map((exchange) => [exchange.id, exchange.turn] as const);
}

const calling = entryOf("a1", "Assistant", [
  { block: "ToolUse", id: "call-1", name: "Read", input: {} },
]);

describe("the mailbox overlay, on a long thread whose mailbox holds only its newest turns", () => {
  test("an exchange more than the turns the mailbox still holds is an older turn's, and says nothing of the turn that is out", () => {
    const exchanges = conversationExchanges(
      [
        askOf("u4", "go"),
        answerOf("a4", "Zeroth."),
        askOf("u5", "go"),
        answerOf("a5", "First."),
        askOf("u6", "go"),
        answerOf("a6", "Second."),
      ],
      [
        turnOf({ turn: "t5", ordinal: 5, input: "go", result: "First." }),
        turnOf({ turn: "t6", ordinal: 6, input: "go", result: "Second." }),
        turnOf({ turn: "t7", ordinal: 7, input: "go", state: "Claimed" }),
      ],
    );
    expect(pairs(exchanges)).toEqual([
      ["u4", undefined],
      ["u5", "t5"],
      ["u6", "t6"],
      ["t7", "t7"],
    ]);
  });

  test("the only turn of its ask the mailbox holds takes the exchange its ask opened", () => {
    const exchanges = conversationExchanges(
      [dropped, askOf("u9", "something new"), calling],
      [
        turnOf({ turn: "t8", ordinal: 8, input: "go", result: "Second." }),
        turnOf({
          turn: "t9",
          ordinal: 9,
          input: "something new",
          state: "Claimed",
        }),
      ],
    );
    expect(pairs(exchanges)).toEqual([["u9", "t9"]]);
  });

  test("a turn that ended saying nothing of itself takes no exchange of a record that cannot be counted", () => {
    const exchanges = conversationExchanges(
      [
        dropped,
        askOf("u4", "go"),
        answerOf("a4", "Second."),
        askOf("u6", "go"),
        answerOf("a6", "Third."),
      ],
      [
        turnOf({
          turn: "t5",
          ordinal: 5,
          input: "go",
          state: "Failed",
          failure: "AttemptLost",
        }),
        turnOf({ turn: "t6", ordinal: 6, input: "go", result: "Third." }),
      ],
    );
    expect(pairs(exchanges)).toEqual([
      ["u4", undefined],
      ["u6", "t6"],
      ["t5", "t5"],
    ]);
  });
});

describe("the mailbox overlay, on an answered turn that ended on no words", () => {
  const turns = [
    turnOf({ turn: "t1", ordinal: 1, input: "go" }),
    turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
  ];
  const called = [askOf("u1", "go"), calling];

  test("its exchange on a whole record stays its own while the same is asked again", () => {
    expect(pairs(conversationExchanges(called, turns))).toEqual([
      ["u1", "t1"],
      ["t2", "t2"],
    ]);
  });

  test("on a record that cannot be counted, the newest exchange does not read as its answer and is the taken turn's", () => {
    expect(
      pairs(
        conversationExchanges([dropped, ...called, askOf("u2", "go")], turns),
      ),
    ).toEqual([
      ["u1", "t1"],
      ["u2", "t2"],
    ]);
  });
});

describe("the mailbox overlay, on what a turn that ran and failed left stored", () => {
  const turns = [
    turnOf({
      turn: "t1",
      ordinal: 1,
      input: "go",
      state: "Failed",
      failure: "AgentRateLimited",
    }),
    turnOf({ turn: "t2", ordinal: 2, input: "go", state: "Claimed" }),
  ];

  test("an ask it stored and wrote nothing under stays its own on a whole record while the same is taken", () => {
    expect(pairs(conversationExchanges([askOf("u1", "go")], turns))).toEqual([
      ["u1", "t1"],
      ["t2", "t2"],
    ]);
  });

  test("on a record that cannot be counted it keeps the words it stored, and an exchange nothing was written in is the retry's", () => {
    expect(pairs(conversationExchanges([dropped, ...half], turns))).toEqual([
      ["u1", "t1"],
      ["t2", "t2"],
    ]);
    expect(
      pairs(
        conversationExchanges([dropped, ...half, askOf("u2", "go")], turns),
      ),
    ).toEqual([
      ["u1", "t1"],
      ["u2", "t2"],
    ]);
  });
});

describe("the mailbox overlay, on turns the transcript does not hold", () => {
  test("an unmatched turn that is not answered appends in ordinal order", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "read"), answerOf("a1", "done")],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "read" }),
        turnOf({ turn: "t3", ordinal: 3, input: "third", state: "Queued" }),
        turnOf({
          turn: "t2",
          ordinal: 2,
          input: "second",
          state: "Failed",
          failure: "AgentBudgetExhausted",
        }),
      ],
    );
    expect(exchanges.map((exchange) => exchange.id)).toEqual([
      "u1",
      "t2",
      "t3",
    ]);
    expect(exchanges[1]?.standing).toEqual({
      standing: "Failed",
      failure: "AgentBudgetExhausted",
    });
    expect(exchanges[2]?.standing).toEqual({
      standing: "Running",
      state: "Queued",
    });
    expect(exchanges[2]?.work).toEqual([]);
  });
});

describe("the mailbox overlay, on a turn with no exchange of its own", () => {
  test("an unmatched answered turn contributes nothing", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "read")],
      [turnOf({ turn: "t9", input: "elsewhere" })],
    );
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]?.id).toBe("u1");
  });

  test("a turn carrying no input can only append, and draws its kind's ask", () => {
    const exchanges = conversationExchanges(
      [askOf("u1", "read")],
      [
        turnOf({
          turn: "t1",
          inputKind: "Observation",
          state: "Claimed",
        }),
      ],
    );
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1]?.ask).toEqual({ ask: "Observation" });
    expect(exchanges[1]?.standing).toEqual({
      standing: "Running",
      state: "Claimed",
    });
  });

  test("a Queued Observation turn with no input draws the Observation ask; a UserMessage with no input draws none", () => {
    const observed = conversationExchanges(
      [],
      [turnOf({ turn: "t1", inputKind: "Observation", state: "Queued" })],
    );
    expect(observed[0]?.ask).toEqual({ ask: "Observation" });
    expect(observed[0]?.standing).toEqual({
      standing: "Running",
      state: "Queued",
    });

    const messaged = conversationExchanges(
      [],
      [turnOf({ turn: "t2", inputKind: "UserMessage", state: "Queued" })],
    );
    expect(messaged[0]?.ask).toBeUndefined();
  });

  test("an abandoned turn keeps its own word", () => {
    const exchanges = conversationExchanges(
      [],
      [turnOf({ turn: "t1", input: "gone", state: "Abandoned" })],
    );
    expect(exchanges[0]?.standing).toEqual({ standing: "Abandoned" });
  });
});

describe("bounds", () => {
  test("the steps past the bound are counted rather than lost", () => {
    const calls: ConversationItem[] = Array.from(
      { length: conversationStepsMax + 2 },
      (_unused, at) =>
        entryOf(`a${String(at)}`, "Assistant", [
          {
            block: "ToolUse",
            id: `call-${String(at)}`,
            name: "Read",
            input: {},
          },
        ]),
    );
    const exchanges = conversationExchanges([askOf("u1", "go"), ...calls]);
    expect(exchanges[0]?.work).toHaveLength(conversationStepsMax);
    expect(exchanges[0]?.before).toEqual([
      { marker: "Capped", sentence: "Steps cut · 2" },
    ]);
  });

  test("the exchanges past the bound are counted rather than lost", () => {
    const asks = Array.from(
      { length: conversationExchangesMax + 2 },
      (_unused, at) => askOf(`u${String(at)}`, `ask ${String(at)}`),
    );
    const exchanges = conversationExchanges(asks);
    expect(exchanges).toHaveLength(conversationExchangesMax);
    expect(exchanges[0]?.before).toEqual([
      { marker: "Capped", sentence: "Exchanges cut · 2" },
    ]);
  });

  test("the blocks past the bound are counted on the exchange", () => {
    const blocks: ConversationBlock[] = [
      { block: "Text", text: "go" },
      { block: "Capped", count: 4 },
    ];
    const exchanges = conversationExchanges([entryOf("u1", "User", blocks)]);
    expect(exchanges[0]?.before).toEqual([
      { marker: "Capped", sentence: "Blocks cut · 4" },
    ]);
  });
});

describe("the work summary", () => {
  test("it counts what the trigger is worded from", () => {
    expect(
      conversationWorkSummary([
        { step: "Thinking", text: "weighed" },
        { step: "ToolCall", id: "call-1", name: "Read", input: {} },
        { step: "ToolCall", id: "call-2", name: "Grep", input: {} },
      ]),
    ).toEqual({ toolCalls: 2, thought: true });
  });

  test("no work is no counts", () => {
    expect(conversationWorkSummary([])).toEqual({
      toolCalls: 0,
      thought: false,
    });
  });
});

/** Every text a reader is shown of an exchange, in the order it is drawn. */
function textsDrawn(exchange: ConversationExchange): readonly string[] {
  return conversationExchangeParts(exchange).flatMap((part) =>
    part.part === "Text" ? [part.text] : [],
  );
}

/** The kinds of an exchange's parts, in the order they are drawn. */
function kindsDrawn(exchange: ConversationExchange): readonly string[] {
  return conversationExchangeParts(exchange).map((part) => part.part);
}

const open: ConversationExchange = {
  id: "u1",
  work: [],
  standing: { standing: "Running", state: "Claimed" },
  before: [],
};

describe("an answer in the order it was written", () => {
  test("a text stays where it was written and the work that followed it comes after", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "go"),
      entryOf("a1", "Assistant", [{ block: "Thinking", text: "weighed" }]),
      answerOf("a2", "Reading the file."),
      entryOf("a3", "Assistant", [
        { block: "ToolUse", id: "call-1", name: "Read", input: {} },
      ]),
      entryOf("a4", "Assistant", [
        { block: "ToolUse", id: "call-2", name: "Grep", input: {} },
      ]),
      answerOf("a5", "It is open."),
    ]);
    expect(
      conversationExchangeParts(exchanges[0] as ConversationExchange),
    ).toEqual([
      { part: "Work", steps: [{ step: "Thinking", text: "weighed" }] },
      { part: "Text", text: "Reading the file." },
      {
        part: "Work",
        steps: [
          { step: "ToolCall", id: "call-1", name: "Read", input: {} },
          { step: "ToolCall", id: "call-2", name: "Grep", input: {} },
        ],
      },
      { part: "Text", text: "It is open." },
    ]);
  });

  test("an exchange nothing was written in has no parts", () => {
    expect(conversationExchangeParts(open)).toEqual([]);
  });

  test("tools with no text between them are one part however many there are", () => {
    const calls: ConversationBlock[] = Array.from(
      { length: 40 },
      (_unused, at) => ({
        block: "ToolUse",
        id: `call-${String(at)}`,
        name: "Read",
        input: {},
      }),
    );
    const worked = conversationExchangeContinued(open, [
      { block: "Text", text: "Reading everything." },
      ...calls,
      { block: "Text", text: "Done." },
    ]);
    expect(kindsDrawn(worked)).toEqual(["Text", "Work", "Text"]);
  });
});

describe("an answer as more of it is heard, and as it is read back", () => {
  test("heard a few characters at a time, then a tool, then more: nothing drawn shrinks, moves or leaves", () => {
    const first = "I am going to read the file.";
    const second = "It says 41 waits on 40.";
    const moments: (readonly ConversationBlock[])[] = [];
    for (let chars = 3; chars < first.length; chars += 3)
      moments.push([{ block: "Text", text: first.slice(0, chars) }]);
    const tool: ConversationBlock = {
      block: "ToolUse",
      id: "",
      name: "Read",
      input: undefined,
    };
    moments.push([{ block: "Text", text: first }]);
    moments.push([{ block: "Text", text: first }, tool]);
    for (let chars = 3; chars <= second.length + 2; chars += 3)
      moments.push([
        { block: "Text", text: first },
        tool,
        { block: "Text", text: second.slice(0, chars) },
      ]);
    let before: readonly string[] = [];
    let kinds: readonly string[] = [];
    for (const heard of moments) {
      const drawn = conversationExchangeContinued(open, heard);
      const texts = textsDrawn(drawn);
      expect(texts.length).toBeGreaterThanOrEqual(before.length);
      before.forEach((text, at) => {
        expect(texts[at]?.startsWith(text)).toBe(true);
      });
      expect(kindsDrawn(drawn).slice(0, kinds.length)).toEqual(kinds);
      before = texts;
      kinds = kindsDrawn(drawn);
    }
    expect(before).toEqual([first, second]);
    expect(kinds).toEqual(["Text", "Work", "Text"]);
  });

  test("the stored answer read back whole draws what was heard, part for part", () => {
    const heard = conversationExchangeContinued(open, [
      { block: "Text", text: "I am going to read the file." },
      { block: "ToolUse", id: "", name: "Read", input: undefined },
      { block: "Text", text: "It says 41 waits on 40." },
    ]);
    const stored = conversationExchanges([
      askOf("u1", "go"),
      answerOf("a1", "I am going to read the file."),
      entryOf("a2", "Assistant", [
        { block: "ToolUse", id: "call-1", name: "Read", input: { path: "41" } },
      ]),
      entryOf("u2", "User", [
        {
          block: "ToolResult",
          toolUse: "call-1",
          text: "waits on 40",
          isError: false,
        },
      ]),
      answerOf("a3", "It says 41 waits on 40."),
    ])[0] as ConversationExchange;
    expect(textsDrawn(stored)).toEqual(textsDrawn(heard));
    expect(kindsDrawn(stored)).toEqual(kindsDrawn(heard));
  });
});

describe("a real store's bytes", () => {
  test("the store's lines become the exchanges the reader saw", () => {
    const exchanges = conversationExchanges(conversationStoreItems());
    expect(exchanges).toHaveLength(8);
    expect(exchanges[0]?.ask).toEqual({
      ask: "Message",
      text: "Remember the word NARWHAL and reply ok",
    });
    expect(exchanges[0]?.answer).toContain("NARWHAL");
    expect(exchanges[0]?.work.map((step) => step.step)).toEqual(["Thinking"]);
  });

  test("the compaction stands before the exchange it precedes", () => {
    const exchanges = conversationExchanges(conversationStoreItems());
    const marked = exchanges.filter((exchange) =>
      exchange.before.some((marker) => marker.marker === "Compaction"),
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.ask?.ask).toBe("Message");
  });

  test("a turn matches the exchange whose ask it is", () => {
    const items = conversationStoreItems();
    const exchanges = conversationExchanges(items, [
      turnOf({
        turn: "t1",
        input: "Remember the word NARWHAL and reply ok",
        costMicros: 3400,
      }),
    ]);
    expect(exchanges[0]?.measures).toEqual({ costMicros: 3400 });
    expect(exchanges).toHaveLength(8);
  });
});

describe("the argument summary", () => {
  test("the first string the arguments hold is the line", () => {
    expect(
      conversationArgumentSummary({ path: "ThreadPage.tsx", limit: 20 }),
    ).toEqual({ argument: "Text", text: "ThreadPage.tsx" });
  });

  test("a string argument is its own line", () => {
    expect(conversationArgumentSummary("just this")).toEqual({
      argument: "Text",
      text: "just this",
    });
  });

  test("a long line is clipped to the bound", () => {
    const summary = conversationArgumentSummary({
      command: "x".repeat(conversationArgumentSummaryCharsMax * 2),
    });
    expect(summary).toEqual({
      argument: "Text",
      text: "x".repeat(conversationArgumentSummaryCharsMax),
    });
  });

  test("arguments holding no string are said by their size", () => {
    const summary = conversationArgumentSummary({ lines: 4, wrap: true });
    expect(summary.argument).toBe("Size");
  });

  test("nothing at all is None", () => {
    expect(conversationArgumentSummary(undefined)).toEqual({
      argument: "None",
    });
  });

  test("what will not serialise reads as nothing rather than throwing", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    expect(conversationArgumentText(cycle)).toBe("");
    expect(conversationArgumentSummary(cycle)).toEqual({ argument: "None" });
  });
});

/** A first turn as the interpreter composes one: the seeding block's sections
 * in order, then the boundary, then what the member typed. */
const seeded = [
  `${threadNorthStarHeading}\n\nShip the console.`,
  `${threadDraftsHeading}\n\n- 7 — the rail`,
  threadStandingSection(threadStandingRulesDefault),
].join("\n\n");

/** One first turn's whole input, which is what the mailbox hands the console. */
const firstTurn = (said: string) =>
  `${seeded}\n\n${threadTurnBoundaryHeading}\n\n${said}`;

describe("the seeding block a first turn carries", () => {
  test("is split off the member's words on the contract's own boundary", () => {
    const ask = conversationAskMessage(firstTurn("what is left to do"));

    expect(ask).toEqual({
      ask: "Message",
      text: "what is left to do",
      context: seeded,
    });
  });

  test("is split at the last boundary, not the first", () => {
    const quoted = firstTurn(`${threadTurnBoundaryHeading}\n\nmy own words`);

    expect(conversationAskMessage(quoted).text).toBe("my own words");
  });

  test("leaves a message that opens on no heading of its whole", () => {
    const said = `check the rail\n\n${threadTurnBoundaryHeading}\n\nand the drawer`;

    expect(conversationAskMessage(said)).toEqual({
      ask: "Message",
      text: said,
    });
  });

  test("leaves a message that opens on a heading and carries no block", () => {
    const said = `${threadNorthStarHeading}\n\nis what I want to change`;

    expect(conversationAskMessage(said)).toEqual({
      ask: "Message",
      text: said,
    });
  });

  test("a JSON object is not a member's words", () => {
    const envelope = `{"version":1,"decision":"selector-decision"}`;

    expect(conversationAskMessage(envelope)).toEqual({
      ask: "Observation",
      text: envelope,
    });
  });

  test("a message that merely opens on a brace stays a message", () => {
    const said = "{not json, just how I start a sentence}";

    expect(conversationAskMessage(said)).toEqual({
      ask: "Message",
      text: said,
    });
  });

  test("the seeding split still wins first, over a JSON member's words", () => {
    const envelope = `{"version":1}`;
    const ask = conversationAskMessage(firstTurn(envelope));

    expect(ask).toEqual({ ask: "Observation", text: envelope });
  });

  test("reaches a drawn exchange as the two halves it is", () => {
    const drawn = conversationExchanges([
      askOf("e1", firstTurn("what is left to do")),
      answerOf("e2", "two things"),
    ]);

    expect(drawn[0]?.ask).toEqual({
      ask: "Message",
      text: "what is left to do",
      context: seeded,
    });
  });
});

describe("a block whose standing rules the project wrote", () => {
  /** Nothing inside the block is a text the console may split on; the boundary
   * is, and it is the same boundary whatever the rules say. */
  test("is split off the member's words on the boundary all the same", () => {
    const own = [
      `${threadNorthStarHeading}\n\nShip the console.`,
      threadStandingSection("- You draft, and nothing else."),
    ].join("\n\n");

    const ask = conversationAskMessage(
      `${own}\n\n${threadTurnBoundaryHeading}\n\nwhat is left to do`,
    );

    expect(ask).toEqual({
      ask: "Message",
      text: "what is left to do",
      context: own,
    });
  });
});

/**
 * One first turn as the interpreter recorded them before the boundary heading
 * existed. The rules are written out rather than imported because these turns
 * are frozen text, and a fixture composed from the constant a project may now
 * reword would agree with a reader that had drifted with it.
 */
const recorded = `${threadNorthStarHeading}

Ship the console.

${threadStandingHeading}

- You act through the same commands your owner has in the console, recorded as their act; the lead's decisions are the lead's, and you neither make nor amend one.
- A wake is a notice, not an instruction: say what happened, and originate, revise, release, dispatch or run nothing because of it.`;

describe("a block recorded before the boundary heading was written", () => {
  test("is split off the member's words on that block's own last line", () => {
    const ask = conversationAskMessage(`${recorded}\n\nwhat is left to do`);

    expect(ask).toEqual({
      ask: "Message",
      text: "what is left to do",
      context: recorded,
    });
  });
});

/** Only a queued turn waits on a runner: one a runner claimed is running on
 * it, and a settled one waits on nothing. */
describe("an exchange and the turn that speaks for it", () => {
  test("an exchange names the turn its ask was paired with, and an appended one its own", () => {
    const exchanges = conversationExchanges(
      [askOf("entry-1", "first"), answerOf("entry-2", "done")],
      [
        turnOf({ turn: "t1", ordinal: 1, input: "first" }),
        turnOf({ turn: "t2", ordinal: 2, input: "second", state: "Queued" }),
      ],
    );
    expect(exchanges.map((exchange) => exchange.turn)).toEqual(["t1", "t2"]);
    expect(
      conversationExchanges([askOf("entry-1", "first")])[0]?.turn,
    ).toBeUndefined();
  });

  test("an answered turn the transcript does not hold is appended only where a page heard it", () => {
    const turns = [turnOf({ turn: "t1", ordinal: 1, input: "first" })];
    expect(conversationExchanges([], turns)).toEqual([]);
    expect(conversationExchanges([], turns, new Set(["t9"]))).toEqual([]);
    expect(conversationExchanges([], turns, new Set(["t1"]))).toEqual([
      {
        id: "t1",
        turn: "t1",
        ask: { ask: "Message", text: "first" },
        work: [],
        standing: { standing: "Answered" },
        before: [],
      },
    ]);
  });

  test("more of an assistant's blocks continue an exchange as its stored entries would", () => {
    const stored = [askOf("entry-1", "first"), answerOf("entry-2", "Looking.")];
    const more: readonly ConversationBlock[] = [
      { block: "ToolUse", id: "toolu_1", name: "Read", input: { path: "a" } },
      { block: "Text", text: "Found it." },
    ];
    const whole = conversationExchanges([
      ...stored,
      entryOf("entry-3", "Assistant", more),
    ])[0];
    const first = conversationExchanges(stored)[0];
    if (first === undefined) throw new Error("no exchange was drawn");
    expect(conversationExchangeContinued(first, more)).toEqual(whole);
    expect(conversationExchangeContinued(first, [])).toBe(first);
    expect(
      conversationExchangeContinued(first, more.slice(0, 1)).answer,
    ).toBeUndefined();
    expect(first.answer).toBe("Looking.");
  });
});

test("a surface whose runner cannot take a turn reads its queued turns as waiting and nothing else", () => {
  const exchanges = conversationExchanges(
    [askOf("u1", "one"), answerOf("a1", "done")],
    [
      turnOf({ turn: "t1", ordinal: 1, state: "Answered" }),
      turnOf({ turn: "t2", ordinal: 2, state: "Claimed" }),
      turnOf({ turn: "t3", ordinal: 3, state: "Queued" }),
    ],
  );
  expect(
    conversationExchangesWaiting(exchanges).map(
      (exchange) => exchange.standing,
    ),
  ).toStrictEqual([
    { standing: "Answered" },
    { standing: "Running", state: "Claimed" },
    { standing: "Running", state: "Waiting" },
  ]);
});
