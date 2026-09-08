/**
 * The locomotive that runs above the composer while the conversation waits,
 * mounted with no provider, as `conversationSurface.test.tsx` does: drawn
 * while an exchange stands `Running` or a send is out, absent once every
 * exchange has settled, and never drawn where no composer is mounted.
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
import type { ConversationSent } from "../app/browser/conversation/Conversation.tsx";
import type { ConversationExchange } from "../app/core/conversation.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { styleless } from "./styleless.ts";

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

const answered = exchangeOf({ answer: "done" });
const running = exchangeOf({
  id: "x2",
  standing: { standing: "Running", state: "Claimed" },
});

function engineDrawn(): boolean {
  return screen.queryByRole("img", { name: /chuggy is working/i }) !== null;
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

test("the strip draws the engine while an exchange stands Running", () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  render(
    <Conversation
      exchanges={[running]}
      composer={{ takes: true, charsMax: 40, onSend }}
      empty="No conversation"
    />,
  );
  expect(engineDrawn()).toBe(true);
  styleless();
});

test("the strip holds its height with no engine once every exchange has settled", () => {
  const onSend = vi.fn(() => Promise.resolve<ConversationSent>("Sent"));
  const view = render(
    <Conversation
      exchanges={[answered]}
      composer={{ takes: true, charsMax: 40, onSend }}
      empty="No conversation"
    />,
  );
  expect(engineDrawn()).toBe(false);
  expect(view.container.querySelector(".conversation-waiting")).not.toBeNull();
  styleless();
});

test("the strip draws while a send is out, even once the exchange it answers has settled", async () => {
  let resolveSend: (sent: ConversationSent) => void = () => undefined;
  const onSend = vi.fn(
    () =>
      new Promise<ConversationSent>((resolve) => {
        resolveSend = resolve;
      }),
  );
  render(
    <Conversation
      exchanges={[answered]}
      composer={{ takes: true, charsMax: 40, onSend }}
      empty="No conversation"
    />,
  );
  expect(engineDrawn()).toBe(false);
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(box, { target: { value: "one more thing" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => {
    expect(engineDrawn()).toBe(true);
  });
  resolveSend("Sent");
  await waitFor(() => {
    expect(engineDrawn()).toBe(false);
  });
  styleless();
});

test("no composer draws no strip, however an exchange stands", () => {
  const view = render(
    <Conversation exchanges={[running]} empty="No conversation" />,
  );
  expect(view.container.querySelector(".conversation-waiting")).toBeNull();
  expect(engineDrawn()).toBe(false);
  styleless();
});
