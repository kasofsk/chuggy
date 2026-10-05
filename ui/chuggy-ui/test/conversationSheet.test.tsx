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
import { CopyProvider } from "../app/browser/ui/copyHeld.tsx";
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

test("a box with nothing to say over it has no line over it", () => {
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

/** What the narrow sheet lays over an element for a press: what its rules
 * declare for the element's `::after`. */
function narrowOver(element: Element, property: string): string {
  const after = "::after";
  let declared = "";
  for (const rule of rulesNarrow) {
    const value = rule.style.getPropertyValue(property);
    const over = rule.selectorText
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector.endsWith(after))
      .map((selector) => selector.slice(0, -after.length));
    if (value !== "" && over.some((selector) => element.matches(selector)))
      declared = value;
  }
  return declared.replace(/\s+/gu, " ");
}

const called: ConversationExchange = {
  ...answered,
  ask: { ask: "Message", text: "what did it say", context: "The ticket." },
  work: [
    {
      step: "ToolCall",
      id: "toolu_1",
      name: "Bash",
      input: { command: "just check" },
    },
  ],
};

test("on a narrow screen the copy of an answer and a row that opens take a press over the least a finger is given, and no room for it", () => {
  const view = render(
    <CopyProvider write={() => Promise.resolve(true)}>
      <Conversation exchanges={[called]} workOpen pane />
    </CopyProvider>,
  );
  const copy = screen.getByRole("button", { name: "Copy answer" });
  const steps = view.container.querySelector(".conversation-steps");
  if (steps === null) throw new Error("no steps were drawn");
  const rows = [...view.container.querySelectorAll(".conversation-trigger")];
  expect(
    rows.map((row) => steps.contains(row)),
    "the context, the work's line and the call under it",
  ).toStrictEqual([false, false, true]);
  const least = "min(0px, calc((100% - var(--height-touch)) / 2))";
  for (const control of [copy, ...rows]) {
    expect(narrow(control, "position")).toBe("relative");
    expect(narrowOver(control, "position")).toBe("absolute");
    expect(narrowOver(control, "inset-block")).toBe(least);
    expect(wide(control, "position")).toBe("");
  }
  for (const row of rows) expect(narrowOver(row, "inset-inline")).toBe(least);
  expect(narrowOver(copy, "inset-inline")).toBe(
    "calc(var(--space-1) - var(--space-4)) calc(100% - var(--height-touch) + var(--space-4) - var(--space-1))",
  );
});

test("on a narrow screen a step that opens is itself a row as tall as a finger is given, within the room the list keeps for it", () => {
  const view = render(<Conversation exchanges={[called]} workOpen pane />);
  const steps = view.container.querySelector(".conversation-steps");
  const [, line, step] = view.container.querySelectorAll(
    ".conversation-trigger",
  );
  if (steps === null || line === undefined || step === undefined)
    throw new Error("no opened work was drawn");
  expect(wide(steps, "gap")).toBe("var(--space-3)");
  expect(narrow(steps, "gap")).toBe("var(--space-3)");
  expect(narrow(steps, "padding-block")).toBe("calc(var(--space-3) / 2)");
  expect(narrow(step, "min-height")).toBe("var(--height-touch)");
  expect(narrow(step, "margin-block")).toBe("calc(var(--space-3) / -2)");
  expect(wide(step, "min-height")).toBe("");
  expect(narrow(line, "min-height")).toBe("var(--conversation-line)");
  expect(narrow(line, "margin-block")).toBe("");
});

test("the line a waiting turn keeps is as tall as the engine that comes to run on it", () => {
  const lines = ["conversation-waiting-kept", "conversation-waiting"].map(
    (named) => {
      const line = document.createElement("div");
      line.className = named;
      return wide(line, "height");
    },
  );
  expect(lines).toStrictEqual([
    "var(--conversation-line)",
    "var(--conversation-line)",
  ]);
});

test("a word for waiting is brought in over a time reduced motion leaves it", () => {
  const line = document.createElement("div");
  line.className = "conversation-meta conversation-meta-waited";
  const word = line.appendChild(document.createElement("p"));
  expect(wide(word, "animation")).toBe(
    "conversation-word-in var(--duration-word) var(--ease-in) both",
  );
  const still = sheetRules(tokenSheet, ["(prefers-reduced-motion: reduce)"]);
  const duration = (rules: readonly CSSStyleRule[]): string =>
    sheetDeclared(rules, document.documentElement, "--duration-word");
  expect(duration(still)).toBe(token("--duration-word"));
  expect(duration(still)).not.toBe("0ms");
  expect(
    sheetDeclared(still, document.documentElement, "--duration-pulse"),
  ).toBe("0ms");
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
