/**
 * The train strip above the composer, mounted with no provider as
 * `conversationSurface.test.tsx` mounts the rest of the surface: the strip
 * holds its height with or without the engine, the engine is drawn while a
 * turn is out and nothing has been said for it yet, absent once its answer is
 * on the transcript or every exchange has settled, the strip is never drawn
 * where there is no composer to run above, and the sprite states neither a
 * colour nor a style of its own so the theme and the served policy both hold.
 */

import { cleanup, render } from "@testing-library/react";
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

test("the strip holds its height with no engine, and draws one when waiting", () => {
  const idle = render(<ConversationWaiting waiting={false} />);
  expect(idle.container.querySelector(".conversation-waiting")).not.toBeNull();
  expect(
    idle.container.querySelector(".conversation-waiting-engine"),
  ).toBeNull();
  idle.unmount();

  const running = render(<ConversationWaiting waiting />);
  expect(
    running.container.querySelector(".conversation-waiting-engine"),
  ).not.toBeNull();
});

test("a running exchange draws the engine on the strip above the composer", () => {
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
  expect(
    view.container.querySelector(".conversation-waiting-engine"),
  ).not.toBeNull();
});

test("a running exchange carrying an answer draws no engine on the strip", () => {
  const running = exchangeOf({
    standing: { standing: "Running", state: "Claimed" },
    answer: "done",
  });
  const view = render(
    <Conversation
      exchanges={[running]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  expect(
    view.container.querySelector(".conversation-waiting-engine"),
  ).toBeNull();
});

test("the strip shares the composer's own width rather than the pane's", () => {
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
  const strip = view.container.querySelector(".conversation-waiting");
  const composer = view.container.querySelector(".conversation-field");
  expect(strip?.parentElement?.className).toContain("max-w-column");
  expect(strip?.parentElement).toBe(composer?.closest("form")?.parentElement);
});

test("the engine runs a rail, and turns a wheel under every axle", () => {
  const running = render(<ConversationWaiting waiting />);
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
  const running = render(<ConversationWaiting waiting />);
  expect(running.container.querySelector("[style]")).toBeNull();
  expect(running.container.querySelector("[fill]")).toBeNull();
});

test("every exchange settled draws the strip with no engine", () => {
  const answered = exchangeOf({ answer: "done" });
  const view = render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  expect(view.container.querySelector(".conversation-waiting")).not.toBeNull();
  expect(
    view.container.querySelector(".conversation-waiting-engine"),
  ).toBeNull();
});

test("no composer draws no strip, running or settled alike", () => {
  const running = exchangeOf({
    standing: { standing: "Running", state: "Claimed" },
  });
  const view = render(
    <Conversation exchanges={[running]} empty="No conversation" />,
  );
  expect(view.container.querySelector(".conversation-waiting")).toBeNull();
});
