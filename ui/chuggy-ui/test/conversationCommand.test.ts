/**
 * What the composer's `/` list offers and when it opens, and which sent boxes
 * are a command rather than words for the agent.
 *
 * The matcher is the case the library could not answer: its own opens on a `/`
 * anywhere after whitespace, which would offer commands in the middle of a
 * sentence and hold the list open, swallowing Enter, over a path no command is
 * named by.
 */

import { describe, expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";
import {
  conversationCommandChar,
  conversationCommandFiltered,
  conversationCommandItem,
  conversationCommandMatch,
  conversationCommandNames,
  conversationCommandPicked,
  conversationCommandTyped,
} from "../app/core/conversationCommand.ts";

const every = conversationCommandNames;
const reading = every.filter((name) => name !== "clear");

function matched(text: string, caret: number = text.length) {
  return conversationCommandMatch(every, text, conversationCommandChar, caret);
}

describe("what the list offers", () => {
  test("a bare `/` offers every command, the one that starts a thread last", () => {
    expect(
      conversationCommandFiltered(every, "", copyTextEn).map(
        (item) => item.label,
      ),
    ).toStrictEqual(["/status", "/usage", "/clear"]);
  });

  test("what follows the `/` is the start of a name, in any case", () => {
    expect(
      conversationCommandFiltered(every, "St", copyTextEn).map(
        (item) => item.id,
      ),
    ).toStrictEqual(["status"]);
    expect(conversationCommandFiltered(every, "tus", copyTextEn)).toStrictEqual(
      [],
    );
  });

  test("a command the page does not offer is not in the list", () => {
    expect(conversationCommandFiltered(reading, "c", copyTextEn)).toStrictEqual(
      [],
    );
  });

  test("an item carries its name as its label and says what it does", () => {
    const item = conversationCommandItem("usage", copyTextEn);
    expect(item.label).toBe("/usage");
    expect(item.type).toBe("command");
    expect(item.description).toBe(
      "Tokens, cost and time over this chat's turns",
    );
  });
});

describe("when the list opens", () => {
  test("a box that is a `/` and the start of a name opens it over the whole box", () => {
    expect(matched("/")).toStrictEqual({ query: "", offset: 0, endOffset: 1 });
    expect(matched("/sta")).toStrictEqual({
      query: "sta",
      offset: 0,
      endOffset: 4,
    });
    expect(matched("/status", 3)).toStrictEqual({
      query: "status",
      offset: 0,
      endOffset: 7,
    });
  });

  test("a `/` anywhere but the start of the box opens nothing", () => {
    expect(matched("see /status")).toBeNull();
    expect(matched(" /status")).toBeNull();
  });

  test("a box that runs past a name opens nothing", () => {
    expect(matched("/status ")).toBeNull();
    expect(matched("/status please")).toBeNull();
    expect(matched("/statusx")).toBeNull();
    expect(matched("/etc/hosts")).toBeNull();
  });

  test("a caret on the `/` is outside the command, which is how escape closes", () => {
    expect(matched("/sta", 0)).toBeNull();
  });

  test("a name the page does not offer opens nothing", () => {
    expect(
      conversationCommandMatch(reading, "/cl", conversationCommandChar, 3),
    ).toBeNull();
  });
});

describe("which sent boxes are a command", () => {
  test("a box that is a name and nothing else is that command", () => {
    expect(conversationCommandTyped(every, "/status")).toBe("status");
    expect(conversationCommandTyped(every, "  /usage \n")).toBe("usage");
    expect(conversationCommandTyped(every, "/Status")).toBe("status");
  });

  test("anything else that begins with a `/` is words for the agent", () => {
    for (const text of ["/status please", "/stat", "/etc/hosts", "status"])
      expect(conversationCommandTyped(every, text), text).toBeUndefined();
  });

  test("a name the page does not offer is words for the agent", () => {
    expect(conversationCommandTyped(reading, "/clear")).toBeUndefined();
  });

  test("a pick is the offered command it names, and nothing else is", () => {
    expect(conversationCommandPicked(every, { id: "clear" })).toBe("clear");
    expect(conversationCommandPicked(reading, { id: "clear" })).toBeUndefined();
    expect(conversationCommandPicked(every, { id: "15" })).toBeUndefined();
  });
});
