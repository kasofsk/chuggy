/**
 * What the conversation surface draws again when one exchange of several
 * changes: that one, and no other.
 *
 * The report is counted as it is drawn, which is the only place a redraw of an
 * exchange that did not change can be seen: the document it leaves is the same
 * either way.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type * as Report from "../app/browser/ui/MarkdownReport.tsx";
import type { ConversationExchange } from "../app/core/conversation.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";

const draws = vi.hoisted(() => new Map<string, number>());

vi.mock("../app/browser/ui/MarkdownReport.tsx", async (original) => {
  const real = await original<typeof Report>();
  return {
    ...real,
    MarkdownReport: (
      props: Parameters<typeof real.MarkdownReport>[0],
    ): ReactNode => {
      draws.set(props.text, (draws.get(props.text) ?? 0) + 1);
      return real.MarkdownReport(props);
    },
  };
});

function answered(id: string, answer: string): ConversationExchange {
  return {
    id,
    turn: id,
    ask: { ask: "Message", text: `ask of ${id}` },
    work: [],
    answer,
    standing: { standing: "Answered" },
    before: [],
  };
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  draws.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("an exchange that did not change is not drawn again when another does", () => {
  const first = answered("turn-1", "40 is open.");
  const view = render(
    <Conversation exchanges={[first, answered("turn-2", "It is")]} pane />,
  );
  expect(draws.get("40 is open.")).toBe(1);
  view.rerender(
    <Conversation
      exchanges={[first, answered("turn-2", "It is blocked.")]}
      pane
    />,
  );
  expect(draws.get("It is blocked.")).toBe(1);
  expect(draws.get("40 is open.")).toBe(1);
});
