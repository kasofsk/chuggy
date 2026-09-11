/**
 * What the composer's `@` list offers and what a pick writes: the query a
 * member's typing leaves once the kind is named, the matching that answers a
 * number and a title with one query, the span the popover replaces, and the
 * round trip through the contract's own form.
 *
 * The matcher is the case the library could not answer. Its own reads back to
 * the first whitespace, which would end a query at the space in `@ticket 15`
 * and never reach a title of several words at all.
 */

import { describe, expect, test } from "vitest";

import { ticketReferenceSplit } from "../../../src/contract/ticketReference.ts";
import type { TicketResponse } from "../../../src/contract/responses.ts";
import {
  conversationMentionFiltered,
  conversationMentionFormatter,
  conversationMentionItem,
  conversationMentionMatch,
  conversationMentionQuery,
  conversationMentionQueryCharsMax,
} from "../app/core/conversationMention.ts";

function ticketOf(ticket: number, title: string | undefined): TicketResponse {
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
  ticketOf(150, "Fix the other thing"),
].map(conversationMentionItem);

describe("the query a member's typing leaves", () => {
  test("the kind names itself and leaves the rest", () => {
    expect(conversationMentionQuery("ticket 15")).toBe("15");
    expect(conversationMentionQuery("ticket fix the thing")).toBe(
      "fix the thing",
    );
    expect(conversationMentionQuery("TICKET 15")).toBe("15");
  });

  test("a kind still being spelled filters nothing yet", () => {
    for (const typed of ["", "t", "tic", "ticket"])
      expect(conversationMentionQuery(typed)).toBe("");
  });

  test("typing that is not the kind is itself the query", () => {
    expect(conversationMentionQuery("fix the")).toBe("fix the");
    expect(conversationMentionQuery("15")).toBe("15");
  });
});

describe("what a query answers with", () => {
  test("a number matches the tickets whose number starts with it", () => {
    expect(
      conversationMentionFiltered(offered, "15").map((item) => item.id),
    ).toEqual(["15", "150"]);
  });

  test("a title matches on the words inside it", () => {
    expect(
      conversationMentionFiltered(offered, "the thing").map((item) => item.id),
    ).toEqual(["15", "150"]);
    expect(
      conversationMentionFiltered(offered, "console").map((item) => item.id),
    ).toEqual(["16"]);
  });

  test("an empty query offers everything, in the order the listing gave", () => {
    expect(
      conversationMentionFiltered(offered, "").map((item) => item.id),
    ).toEqual(["15", "16", "150"]);
  });

  test("a ticket with no title is still offered, and says its phase", () => {
    const untitled = conversationMentionItem(ticketOf(7, undefined));
    expect(untitled.description).toBe("Working");
    expect(conversationMentionFiltered([untitled], "7")).toHaveLength(1);
  });
});

describe("the span the popover replaces", () => {
  test("a query runs over the spaces inside a title", () => {
    const text = "see @ticket fix the thing";
    expect(conversationMentionMatch(text, "@", text.length)).toEqual({
      query: "ticket fix the thing",
      offset: 4,
      endOffset: text.length,
    });
  });

  test("an address inside a word opens nothing", () => {
    const text = "mail geoff@example";
    expect(conversationMentionMatch(text, "@", text.length)).toBeNull();
  });

  test("a line break ends the mention", () => {
    const text = "@ticket 15\nand then";
    expect(conversationMentionMatch(text, "@", text.length)).toBeNull();
  });

  test("a stray address stops offering once the query runs too long", () => {
    const text = `@${"a".repeat(conversationMentionQueryCharsMax + 1)}`;
    expect(conversationMentionMatch(text, "@", text.length)).toBeNull();
  });

  test("the caret before the address is outside the mention", () => {
    expect(conversationMentionMatch("@ticket", "@", 0)).toBeNull();
  });
});

describe("what a pick writes", () => {
  test("a pick is written as the very form the agent is asked for", () => {
    const written = conversationMentionFormatter.serialize({ id: "15" });
    expect(written).toBe("[[ticket:15]]");
    expect(ticketReferenceSplit(written)).toEqual([
      { kind: "Ticket", ticket: 15 },
    ]);
  });

  test("a reference already in the box reads back as the ticket it names", () => {
    expect(
      conversationMentionFormatter.parse("see [[ticket:15]] please"),
    ).toEqual([
      { kind: "text", text: "see " },
      { kind: "mention", type: "ticket", label: "#15", id: "15" },
      { kind: "text", text: " please" },
    ]);
  });
});
