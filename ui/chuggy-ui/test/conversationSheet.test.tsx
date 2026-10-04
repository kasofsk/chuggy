/**
 * What the sheets say of a conversation's sizes, matched against what it
 * draws: the text a phone reads and types at, what a finger is given to press,
 * the composer as one row, and the column a pane given the whole frame reads
 * in. The sizes themselves are a browser's to measure.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";

import { Conversation } from "../app/browser/conversation/Conversation.tsx";
import type { ConversationSent } from "../app/browser/conversation/Conversation.tsx";
import conversationSheet from "../app/browser/conversation/conversation.css?raw";
import { ChatPaneIconButton } from "../app/browser/shell/chatPaneIcons.tsx";
import shellSheet from "../app/browser/shell/shell.css?raw";
import buttonSheet from "../app/browser/ui/Button.css?raw";
import type { ConversationExchange } from "../app/core/conversation.ts";
import tokenSheet from "../app/styles/tokens.css?raw";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
});
afterEach(cleanup);

const sheets = [tokenSheet, buttonSheet, conversationSheet, shellSheet];

const rulesWide = sheets.flatMap((sheet) => sheetRules(sheet, []));
const rulesNarrow = sheets.flatMap((sheet) =>
  sheetRules(sheet, [sheetNarrowCondition]),
);

function wide(element: Element, property: string): string {
  return sheetDeclared(rulesWide, element, property);
}

function narrow(element: Element, property: string): string {
  return sheetDeclared(rulesNarrow, element, property);
}

function token(name: string): string {
  return wide(document.documentElement, name);
}

const answered: ConversationExchange = {
  id: "x1",
  ask: { ask: "Message", text: "what did it say" },
  work: [],
  answer: "Exit 1: one prettier finding.",
  standing: { standing: "Answered" },
  before: [],
};

function drawn(pane: string): {
  readonly root: Element;
  readonly columns: readonly Element[];
  readonly input: HTMLElement;
  readonly send: HTMLElement;
} {
  const view = render(
    <section className={pane}>
      <Conversation
        exchanges={[answered]}
        composer={{
          takes: true,
          charsMax: 2000,
          onSend: () => Promise.resolve<ConversationSent>("Sent"),
        }}
        pane
      />
    </section>,
  );
  const root = view.container.querySelector(".conversation");
  if (root === null) throw new Error("no conversation was drawn");
  return {
    root,
    columns: [...view.container.querySelectorAll(".conversation-column")],
    input: screen.getByRole("textbox", { name: "Message" }),
    send: screen.getByRole("button", { name: "Send" }),
  };
}

test("on a narrow screen a conversation is read and typed at the size a phone does not zoom into", () => {
  const { root } = drawn("");
  expect(wide(root, "--conversation-text")).toBe("");
  expect(narrow(root, "--conversation-text")).toBe("var(--text-unzoomed)");
  expect(wide(root, "font-size")).toBe("var(--conversation-text, inherit)");
  expect(token("--text-unzoomed")).toBe("16px");
});

test("the box and its control are one row, a line of the box as tall as the control", () => {
  const { input, send } = drawn("");
  const field = input.parentElement;
  if (field === null) throw new Error("the box stands in nothing");
  expect(send.parentElement).toBe(field);
  expect(wide(field, "display")).toBe("flex");
  expect(wide(input, "padding")).toBe(
    "calc((var(--conversation-control) - 1lh) / 2) 0",
  );
  for (const side of ["width", "height"])
    expect(wide(send, side)).toBe("var(--conversation-control)");
  expect(wide(field, "--conversation-control")).toBe("var(--height-icon)");
});

test("on a narrow screen the control is the least a finger is given", () => {
  const { input } = drawn("");
  const field = input.parentElement;
  if (field === null) throw new Error("the box stands in nothing");
  expect(narrow(field, "--conversation-control")).toBe("var(--height-touch)");
  expect(token("--height-touch")).toBe("44px");
});

test("a box with nothing to say under it has no line under it", () => {
  const { input } = drawn("");
  const note = input.closest("form")?.querySelector(".conversation-note");
  if (note === null || note === undefined) throw new Error("no note line");
  expect(note.childNodes).toHaveLength(0);
  expect(wide(note, "display")).toBe("none");
});

test("a control that is only its glyph is a square, and on a narrow screen the least a finger is given", () => {
  render(
    <ChatPaneIconButton glyph="new" label="New" onClick={() => undefined} />,
  );
  const control = screen.getByRole("button", { name: "New" });
  for (const side of ["width", "height"]) {
    expect(wide(control, side)).toBe("var(--height-icon)");
    expect(narrow(control, side)).toBe("var(--height-touch)");
  }
});

test("the way back to the foot is the least a finger is given on a narrow screen, and positioned over nothing", () => {
  const control = document.createElement("button");
  control.className = "conversation-bottom";
  for (const side of ["width", "height"])
    expect(narrow(control, side)).toBe("var(--height-touch)");
  expect(wide(control, "position")).toBe("");
});

test("a pane given the whole frame sets the conversation as a column to read, and the composer with it", () => {
  const { root, columns } = drawn("chat-reading");
  const pane = root.closest(".chat-reading");
  if (pane === null) throw new Error("the conversation stands in no pane");
  expect(wide(pane, "--conversation-width")).toBe("var(--width-reading)");
  expect(wide(pane, "--conversation-text")).toBe("var(--text-lg)");
  expect(wide(pane, "--conversation-leading")).toBe("var(--leading-reading)");
  expect(token("--width-reading")).toBe("48rem");
  expect(token("--text-lg")).toBe("1rem");
  expect(Number(token("--leading-reading"))).toBeGreaterThan(
    Number(token("--leading-prose")),
  );
  expect(columns).toHaveLength(2);
  for (const column of columns)
    expect(wide(column, "max-width")).toBe(
      "var(--conversation-width, var(--width-column))",
    );
});
