/**
 * The conversation model, with no renderer: what a content block is read as,
 * and how the blocks and the mailbox become exchanges.
 */

import { describe, expect, test } from "vitest";

import {
  conversationArgumentSummary,
  conversationArgumentSummaryCharsMax,
  conversationArgumentText,
  conversationBlocksMax,
  conversationBlocksOf,
  conversationBlockUnreadable,
  conversationExchanges,
  conversationExchangesMax,
  conversationStepsMax,
  conversationWorkSummary,
} from "../app/core/conversation.ts";
import type {
  ConversationBlock,
  ConversationItem,
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

  test("a marker with nothing after it lands on a trailing exchange", () => {
    const exchanges = conversationExchanges([
      askOf("u1", "before"),
      answerOf("a1", "done"),
      { item: "Marker", marker: { marker: "Truncated" } },
    ]);
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1]?.ask).toBeUndefined();
    expect(exchanges[1]?.work).toEqual([]);
    expect(exchanges[1]?.before).toEqual([{ marker: "Truncated" }]);
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

describe("the mailbox overlay, on turns the transcript does not hold", () => {
  test("two identical inputs match newest to newest", () => {
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

  test("a turn carrying no input can only append", () => {
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
    expect(exchanges[1]?.ask).toBeUndefined();
    expect(exchanges[1]?.standing).toEqual({
      standing: "Running",
      state: "Claimed",
    });
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
        { step: "Text", text: "aside" },
        { step: "ToolCall", id: "call-1", name: "Read", input: {} },
        { step: "ToolCall", id: "call-2", name: "Grep", input: {} },
      ]),
    ).toEqual({ toolCalls: 2, texts: 1, thought: true });
  });

  test("no work is no counts", () => {
    expect(conversationWorkSummary([])).toEqual({
      toolCalls: 0,
      texts: 0,
      thought: false,
    });
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
