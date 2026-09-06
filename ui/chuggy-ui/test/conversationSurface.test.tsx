/**
 * The conversation surface, mounted with no provider: what an exchange draws,
 * what the work disclosure hides until asked, and what one press of Send does.
 *
 * Every case asserts no style element was appended. The served policy is
 * `style-src 'self'`, so a stylesheet the library or a primitive created at run
 * time would be refused in the browser and drawn unstyled with nothing on the
 * console this suite can see.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../app/browser/conversation/Conversation.tsx";
import type { ConversationExchange } from "../app/core/conversation.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";

function exchangeOf(
  exchange: Partial<ConversationExchange>,
): ConversationExchange {
  return {
    id: "x1",
    ask: { ask: "Message", text: "what did it say" },
    work: [],
    standing: { standing: "Answered" },
    before: [],
    ...exchange,
  };
}

const answered = exchangeOf({
  answer: "Exit 1: one prettier finding.",
  measures: { tokens: 900, costMicros: 3400, durationMs: 4200 },
  work: [
    { step: "Thinking", text: "weighed it" },
    {
      step: "ToolCall",
      id: "call-1",
      name: "Read",
      input: { path: "ThreadPage.tsx" },
      result: { text: "bytes", isError: false },
    },
  ],
});

function styleless(): void {
  expect(document.querySelectorAll("style")).toHaveLength(0);
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

test("an exchange draws its ask, its standing and its answer", () => {
  render(<Conversation exchanges={[answered]} empty="No conversation" />);
  expect(screen.getByText("what did it say")).toBeDefined();
  expect(screen.getByText("Answered")).toBeDefined();
  expect(screen.getByText("Exit 1: one prettier finding.")).toBeDefined();
  styleless();
});

test("no exchanges draws the empty label and no composer", () => {
  render(<Conversation exchanges={[]} empty="No conversation" />);
  expect(screen.getByText("No conversation")).toBeDefined();
  expect(screen.queryByRole("textbox")).toBeNull();
  styleless();
});

test("the work is collapsed, and opens on the steps in order", () => {
  render(<Conversation exchanges={[answered]} empty="No conversation" />);
  const trigger = screen.getByRole("button", { name: /Thought/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("weighed it")).toBeNull();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const steps = screen.getAllByRole("listitem");
  expect(steps).toHaveLength(2);
  expect(steps[0]?.textContent).toContain("weighed it");
  expect(steps[1]?.textContent).toContain("Read");
  styleless();
});

test("a tool call opens on its arguments and its result", () => {
  render(<Conversation exchanges={[answered]} empty="No conversation" />);
  fireEvent.click(screen.getByRole("button", { name: /Thought/ }));
  const call = screen.getByRole("button", { name: /Read/ });
  expect(screen.queryByText("bytes")).toBeNull();
  fireEvent.click(call);
  expect(screen.getByText("bytes")).toBeDefined();
  expect(screen.getAllByText(/ThreadPage\.tsx/)).toHaveLength(2);
  styleless();
});

test("no work draws no disclosure", () => {
  render(
    <Conversation
      exchanges={[exchangeOf({ answer: "done" })]}
      empty="No conversation"
    />,
  );
  expect(screen.queryByRole("button")).toBeNull();
  styleless();
});

test("the meta line omits a measure no turn recorded", () => {
  render(
    <Conversation
      exchanges={[
        exchangeOf({ answer: "done", measures: { durationMs: 4200 } }),
      ]}
      empty="No conversation"
    />,
  );
  expect(screen.getByText("Answered")).toBeDefined();
  expect(screen.queryByText(/tok/)).toBeNull();
  expect(screen.queryByText("—")).toBeNull();
  styleless();
});

test("a failed exchange draws its reason where the answer would be", () => {
  render(
    <Conversation
      exchanges={[
        exchangeOf({
          standing: { standing: "Failed", failure: "AgentFailed" },
        }),
      ]}
      empty="No conversation"
    />,
  );
  expect(screen.getByText("Failed")).toBeDefined();
  expect(screen.getByText("AgentFailed")).toBeDefined();
  styleless();
});

test("a tool result that failed marks the row and draws no pill", () => {
  const failed = exchangeOf({
    answer: "done",
    work: [
      {
        step: "ToolCall",
        id: "call-2",
        name: "Bash",
        input: { command: "just check" },
        result: { text: "exit 1", isError: true },
      },
    ],
  });
  render(<Conversation exchanges={[failed]} empty="No conversation" />);
  fireEvent.click(screen.getByRole("button", { name: /tool/ }));
  expect(screen.getByText("Bash").className).toContain("text-tone-fail");
  expect(document.querySelectorAll(".pill")).toHaveLength(0);
  styleless();
});

test("a running exchange's card says Working", () => {
  const running = exchangeOf({
    id: "x4",
    standing: { standing: "Running", state: "Claimed" },
    work: [{ step: "Thinking", text: "weighing it" }],
  });
  render(<Conversation exchanges={[running]} empty="No conversation" />);
  const trigger = screen.getByRole("button", { name: "Working" });
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("weighing it")).toBeDefined();
  styleless();
});

test("a running exchange draws its state word and no answer", () => {
  const running = exchangeOf({
    id: "x2",
    standing: { standing: "Running", state: "Queued" },
  });
  const view = render(
    <Conversation exchanges={[running]} empty="No conversation" />,
  );
  expect(screen.getByText("Queued")).toBeDefined();
  expect(view.container.querySelector(".run-report")).toBeNull();
  styleless();
});

test("a marker stands above the exchange it precedes", () => {
  const marked = exchangeOf({
    before: [{ marker: "Compaction" }, { marker: "Truncated" }],
    answer: "done",
  });
  render(<Conversation exchanges={[marked]} empty="No conversation" />);
  expect(screen.getByText("Compaction")).toBeDefined();
  expect(screen.getByText("Truncated")).toBeDefined();
  styleless();
});

test("an elision marker says the unit its count is in", () => {
  const marked = exchangeOf({
    before: [{ marker: "Elision", bytes: 2 }],
    answer: "done",
  });
  render(<Conversation exchanges={[marked]} empty="No conversation" />);
  expect(screen.getByText("Elided · 2 bytes")).toBeDefined();
  styleless();
});

test("a markers-only exchange draws its markers and no pill", () => {
  const markersOnly: ConversationExchange = {
    id: "x9",
    work: [],
    standing: { standing: "Markers" },
    before: [{ marker: "Truncated" }],
  };
  render(<Conversation exchanges={[markersOnly]} empty="No conversation" />);
  expect(screen.getByText("Truncated")).toBeDefined();
  expect(screen.queryByRole("button")).toBeNull();
  expect(document.querySelectorAll(".pill").length).toBe(0);
  styleless();
});

test("a wake draws one system line and never its document", () => {
  const woken = exchangeOf({
    ask: { ask: "Wake", wake: "TicketDone", resource: "ticket-44" },
    answer: "done",
  });
  render(<Conversation exchanges={[woken]} empty="No conversation" />);
  expect(screen.getByText("TicketDone · ticket-44")).toBeDefined();
  styleless();
});

test("no exchanges draws the empty title above its one sentence", () => {
  render(
    <Conversation
      exchanges={[]}
      empty="Ask for a draft"
      emptyTitle="Your thread"
    />,
  );
  expect(screen.getByRole("heading", { name: "Your thread" })).toBeDefined();
  expect(screen.getByText("Ask for a draft")).toBeDefined();
  styleless();
});

function composerOf(props: {
  readonly takes?: boolean;
  readonly onSend: (text: string) => Promise<ConversationSent>;
}): ConversationComposerProps {
  return { takes: props.takes ?? true, charsMax: 40, onSend: props.onSend };
}

async function typed(text: string): Promise<HTMLTextAreaElement> {
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(box, { target: { value: text } });
  await waitFor(() => {
    expect(box.value).toBe(text);
  });
  return box;
}

test("Enter sends what was typed, and the box clears on Sent", async () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf({ onSend })}
      empty="No conversation"
    />,
  );
  const box = await typed("run it again");
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledWith("run it again");
  });
  await waitFor(() => {
    expect(box.value).toBe("");
  });
  styleless();
});

test("Shift and Enter is a newline, not a send", async () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf({ onSend })}
      empty="No conversation"
    />,
  );
  const box = await typed("half a thought");
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(onSend).not.toHaveBeenCalled();
  expect(box.value).toBe("half a thought");
  styleless();
});

test("a page that kept the message puts the characters back", async () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Kept"));
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf({ onSend })}
      empty="No conversation"
    />,
  );
  const box = await typed("try once more");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledWith("try once more");
  });
  await waitFor(() => {
    expect(box.value).toBe("try once more");
  });
  styleless();
});

test("a running exchange still takes a message, because the mailbox queues", async () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  const running = exchangeOf({
    id: "x3",
    standing: { standing: "Running", state: "Claimed" },
  });
  render(
    <Conversation
      exchanges={[running]}
      composer={composerOf({ onSend })}
      empty="No conversation"
    />,
  );
  const box = await typed("one more thing");
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(onSend).toHaveBeenCalledWith("one more thing");
  });
  styleless();
});

test("a closed door draws no box to type into", () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf({ takes: false, onSend })}
      empty="No conversation"
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("Closed")).toBeDefined();
  styleless();
});

test("the counter appears only once the text nears the bound", async () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf({ onSend })}
      empty="No conversation"
    />,
  );
  await typed("short");
  expect(screen.queryByText(/\/ 40/)).toBeNull();
  await typed("a".repeat(33));
  expect(screen.getByText("33 / 40")).toBeDefined();
  styleless();
});

test("the note the page worded stands under the field", () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  render(
    <Conversation
      exchanges={[answered]}
      composer={{ ...composerOf({ onSend }), note: "Queued" }}
      empty="No conversation"
    />,
  );
  expect(screen.getByText("Queued")).toBeDefined();
  styleless();
});
