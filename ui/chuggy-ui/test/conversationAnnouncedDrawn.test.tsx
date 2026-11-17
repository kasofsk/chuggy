/**
 * The conversation's log as drawn: a named, polite log nobody sees, which a
 * streamed reply adds to once as it begins and once whole, and history read in
 * above adds nothing to; and the engine's line, a status whose words do not
 * change while it runs.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type {
  ConversationComposerProps,
  ConversationSent,
} from "../app/browser/conversation/Conversation.tsx";
import type { ConversationExchange } from "../app/core/conversation.ts";
import { renderCopied } from "./copied.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

function exchangeOf(
  id: string,
  exchange: Partial<ConversationExchange>,
): ConversationExchange {
  return {
    id,
    ask: { ask: "Message", text: `ask ${id}` },
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

function logLines(): readonly string[] {
  const log = screen.getByRole("log", { name: "Conversation" });
  return [...log.children].map((line) => line.textContent);
}

const earlier = exchangeOf("a", { answer: "It is open." });

test("the log is named and polite, drawn for nobody, and says nothing on the first draw", () => {
  renderCopied(
    <Conversation
      exchanges={[earlier, exchangeOf("b", { answer: "Two." })]}
      composer={composerOf()}
    />,
  );
  const log = screen.getByRole("log", { name: "Conversation" });
  expect(log.getAttribute("aria-live")).toBe("polite");
  expect(log.classList.contains("visually-hidden")).toBe(true);
  expect(logLines()).toStrictEqual([]);
});

test("a streamed reply adds to the log once as it begins and once whole", () => {
  const composer = composerOf();
  const draw = (exchanges: readonly ConversationExchange[]) => (
    <Conversation exchanges={exchanges} composer={composer} />
  );
  const view = renderCopied(
    draw([
      earlier,
      exchangeOf("b", { standing: { standing: "Running", state: "Queued" } }),
    ]),
  );
  for (const text of ["The", "The answer", "The answer is two."])
    view.rerender(
      draw([
        earlier,
        exchangeOf("b", {
          work: [{ step: "Text", text }],
          standing: { standing: "Running", state: "Claimed" },
          activity: { activity: "Writing" },
        }),
      ]),
    );
  expect(logLines()).toStrictEqual(["Agent is replying"]);
  view.rerender(
    draw([earlier, exchangeOf("b", { answer: "The answer is two." })]),
  );
  view.rerender(
    draw([earlier, exchangeOf("b", { answer: "The answer is two." })]),
  );
  expect(logLines()).toStrictEqual(["Agent is replying", "The answer is two."]);
});

test("history read in above adds nothing to the log", () => {
  const draw = (exchanges: readonly ConversationExchange[]) => (
    <Conversation exchanges={exchanges} composer={composerOf()} />
  );
  const view = renderCopied(draw([earlier]));
  view.rerender(
    draw([
      exchangeOf("x", { answer: "Old one." }),
      exchangeOf("y", { answer: "Old two." }),
      earlier,
    ]),
  );
  expect(logLines()).toStrictEqual([]);
});

test("a conversation still being read says nothing of what the read brings", () => {
  const history = [earlier, exchangeOf("b", { answer: "Two." })];
  const view = renderCopied(
    <Conversation exchanges={[]} composer={composerOf()} reading />,
  );
  view.rerender(<Conversation exchanges={history} composer={composerOf()} />);
  expect(logLines()).toStrictEqual([]);
});

test("the engine's line is a status that is not rewritten while the column redraws", () => {
  const running = exchangeOf("b", {
    standing: { standing: "Running", state: "Claimed" },
  });
  const draw = (exchanges: readonly ConversationExchange[]) => (
    <Conversation exchanges={exchanges} composer={composerOf()} />
  );
  const view = renderCopied(draw([earlier, running]));
  const status = view.container.querySelector(".conversation-waiting");
  expect(status?.getAttribute("role")).toBe("status");
  const changes: MutationRecord[] = [];
  const watch = new MutationObserver((records) => {
    changes.push(...records);
  });
  watch.observe(status as Element, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  for (const again of [{ ...running }, { ...running }, { ...running }])
    view.rerender(draw([earlier, again]));
  changes.push(...watch.takeRecords());
  watch.disconnect();
  expect(view.container.querySelector(".conversation-waiting")).toBe(status);
  expect(changes).toStrictEqual([]);
});
