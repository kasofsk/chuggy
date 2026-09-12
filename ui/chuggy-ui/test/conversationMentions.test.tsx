/**
 * The `@` list over the composer, driven through the box a member types in.
 *
 * WHAT IS BEING PROVED IS THE WIRING, NOT THE POPOVER. The filtering and the
 * matching have their own cases in `conversationMention.test.ts`, and the
 * keyboard and the caret tracking are the library's. What no other case can
 * settle is that the trigger is registered at all, that the matcher this
 * console supplies is the one in force — the library's own would have closed
 * the list at the space in `@ticket 15` — and that a pick writes the contract's
 * own form into the message rather than a label.
 *
 * The list is asserted through the composer rather than through its own
 * component, because a trigger with no `TriggerPopoverRoot` and no composer
 * input around it registers nothing and would draw nothing here either.
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
import { conversationMentionItem } from "../app/core/conversationMention.ts";
import type { ConversationExchange } from "../app/core/conversation.ts";
import type { TicketResponse } from "../../../src/contract/responses.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";

function ticketOf(ticket: number, title: string): TicketResponse {
  return {
    ticket,
    title,
    phase: "Working",
    sequence: 1,
    changedAt: "2026-09-11T00:00:00.000Z",
  };
}

const offered = [
  ticketOf(15, "Fix the thing"),
  ticketOf(16, "Ship the console"),
].map(conversationMentionItem);

const answered: ConversationExchange = {
  id: "x1",
  ask: { ask: "Message", text: "what did it say" },
  work: [],
  standing: { standing: "Answered" },
  before: [],
  answer: "done",
};

/** A composer offering nothing, which is a page that read no tickets — the
 * property is absent rather than undefined, as a page that has none writes it. */
function composerBare(): ConversationComposerProps {
  return {
    takes: true,
    charsMax: 200,
    onSend: vi.fn(() => Promise.resolve<ConversationSent>("Sent")),
  };
}

function composerOf(): ConversationComposerProps {
  return { ...composerBare(), mentions: offered };
}

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

/** Typing, with the caret left where a member's would be: the trigger reads
 * back from the caret, so a box whose selection stayed at zero opens nothing. */
async function typed(text: string): Promise<HTMLTextAreaElement> {
  const box = screen.getByRole<HTMLTextAreaElement>("textbox");
  fireEvent.change(box, { target: { value: text } });
  box.setSelectionRange(text.length, text.length);
  fireEvent.select(box);
  await waitFor(() => {
    expect(box.value).toBe(text);
  });
  return box;
}

/** The tickets the list is offering, which the popover draws as the options of
 * a combobox over the box the member is typing in. */
function mentioned(): readonly string[] {
  return screen.queryAllByRole("option").map((item) => item.textContent ?? "");
}

test("an address with no list offered opens nothing at all", async () => {
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerBare()}
      empty="No conversation"
    />,
  );
  await typed("@");
  expect(mentioned()).toHaveLength(0);
});

test("an address offers every ticket, and typing the kind still offers them", async () => {
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  await typed("@");
  await waitFor(() => {
    expect(mentioned().length).toBe(2);
  });
  await typed("@ticket");
  await waitFor(() => {
    expect(mentioned().length).toBe(2);
  });
});

/** The case the library's own matcher could not answer: its query ends at the
 * first whitespace, so the space here would have closed the list. */
test("a query runs over the space after the kind, by number and by title", async () => {
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  await typed("@ticket 15");
  await waitFor(() => {
    expect(mentioned().join(" ")).toContain("#15");
  });
  expect(mentioned().join(" ")).not.toContain("#16");

  await typed("@ticket ship the console");
  await waitFor(() => {
    expect(mentioned().join(" ")).toContain("#16");
  });
  expect(mentioned().join(" ")).not.toContain("#15");
});

test("picking a ticket writes the form the agent is asked for", async () => {
  render(
    <Conversation
      exchanges={[answered]}
      composer={composerOf()}
      empty="No conversation"
    />,
  );
  const box = await typed("see @ticket 15");
  await waitFor(() => {
    expect(mentioned().join(" ")).toContain("#15");
  });
  const pick = screen
    .queryAllByRole("option")
    .find((item) => (item.textContent ?? "").startsWith("#15"));
  if (pick === undefined) throw new Error("expected ticket 15 to be offered");
  fireEvent.click(pick);

  await waitFor(() => {
    expect(box.value).toContain("[[ticket:15]]");
  });
  expect(box.value.startsWith("see ")).toBe(true);
});
