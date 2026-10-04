/**
 * The engine, mounted with no provider as `conversationSurface.test.tsx`
 * mounts the rest of the surface: it runs in the answer of a turn that is out
 * with nothing drawn of it yet, on the line the first of the answer will take,
 * and at the foot of the column for a send no exchange stands for; it is gone
 * once anything of the turn is drawn or the turn settles, it holds no place
 * while it is not drawn, it is never drawn where there is no composer, and the
 * sprite states neither a colour nor a style of its own so the theme and the
 * served policy both hold.
 */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../app/browser/conversation/Conversation.tsx";
import { ConversationWaiting } from "../app/browser/conversation/ConversationWaiting.tsx";
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

function composerOf(): ConversationComposerProps {
  return {
    takes: true,
    charsMax: 40,
    onSend: vi.fn(() => Promise.resolve<ConversationSent>("Sent")),
  };
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

function engine(container: HTMLElement): Element | null {
  return container.querySelector(".conversation-waiting-engine");
}

test("a turn out with nothing drawn of it runs the engine in its own answer, above the line under it", () => {
  const running = exchangeOf({
    standing: { standing: "Running", state: "Claimed" },
  });
  const view = render(
    <Conversation
      exchanges={[running]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  const line = view.container.querySelector(".conversation-waiting");
  expect(engine(view.container)).not.toBeNull();
  expect(line?.parentElement?.classList.contains("conversation-answer")).toBe(
    true,
  );
  expect(
    line?.nextElementSibling?.classList.contains("conversation-meta"),
  ).toBe(true);
});

test("a running exchange already carrying its answer draws no engine", () => {
  const answered = exchangeOf({
    standing: { standing: "Running", state: "Claimed" },
    answer: "the answer is already on the transcript",
  });
  const view = render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  expect(view.container.querySelector(".conversation-waiting")).toBeNull();
});

test("a send no exchange stands for yet runs the engine at the foot of the column, and nothing between the column and the composer", async () => {
  const answered = exchangeOf({ answer: "done" });
  const view = render(
    <Conversation
      exchanges={[answered]}
      composer={{
        ...composerOf(),
        onSend: () => new Promise<ConversationSent>(() => undefined),
      }}
      empty="No conversation"
    />,
  );
  const box = view.container.querySelector("textarea");
  if (box === null) throw new Error("no composer is drawn");
  fireEvent.change(box, { target: { value: "and 41" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(engine(view.container)).not.toBeNull();
  });
  const line = view.container.querySelector(".conversation-waiting");
  const column = view.container.querySelector(".conversation-column");
  expect(line?.parentElement).toBe(column);
  expect(column?.lastElementChild).toBe(line);
  const composer = view.container.querySelector(".conversation-field");
  expect(composer?.closest("form")?.parentElement?.childElementCount).toBe(1);
});

test("the engine runs a rail, and turns a wheel under every axle", () => {
  const running = render(<ConversationWaiting />);
  expect(
    running.container.querySelector(".conversation-waiting-track"),
  ).not.toBeNull();
  expect(
    running.container.querySelector(".conversation-waiting-steam"),
  ).not.toBeNull();
  const wheels = running.container.querySelectorAll(
    ".conversation-waiting-wheel",
  );
  expect(wheels.length).toBeGreaterThan(0);
  for (const wheel of wheels)
    expect(wheel.querySelector("path")).not.toBeNull();
});

test("the sprite states no colour and no style of its own", () => {
  const running = render(<ConversationWaiting />);
  expect(running.container.querySelector("[style]")).toBeNull();
  expect(running.container.querySelector("[fill]")).toBeNull();
});

test("every exchange settled draws no engine and holds no place for one", () => {
  const answered = exchangeOf({ answer: "done" });
  const view = render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  expect(view.container.querySelector(".conversation-waiting")).toBeNull();
});

test("no composer draws no engine, running or settled alike", () => {
  const running = exchangeOf({
    standing: { standing: "Running", state: "Claimed" },
  });
  const view = render(
    <Conversation exchanges={[running]} empty="No conversation" />,
  );
  expect(view.container.querySelector(".conversation-waiting")).toBeNull();
});
