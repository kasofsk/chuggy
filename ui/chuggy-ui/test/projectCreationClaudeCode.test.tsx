/**
 * The line to paste into Claude Code, on the page a project is made at and on
 * the welcome page a reader with no project lands on: one box drawn for this
 * console's own site under the page's heading, folded on the first and over
 * its form, before either read has answered, and not drawn where an empty
 * state stands in for the form; open on the second. Its control says its name
 * on it on both.
 *
 * Folded, the box draws none of the line until its bar is pressed, and its
 * control puts the whole line on the clipboard either way and asks the
 * network for nothing.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { copyTextEn } from "../app/copy/catalog.ts";
import { ProjectCreationPage } from "../app/browser/ProjectCreation.tsx";
import { Landing } from "../app/browser/routes.tsx";
import {
  claudeCodeLine,
  claudeCodeLineAbout,
  claudeCodeLineCopy,
} from "../app/core/claudeCodeLine.ts";
import {
  accessHolding,
  administered,
  drawn,
  joined,
  served,
  submit,
  workspaceChoice,
} from "./projectCreationDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, heldAnswer, press, settled } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

/** The site this console is drawn as, and every text it put on the clipboard, in order. */
const site = vi.hoisted(() => ({
  origin: "https://chuggy.test",
  copied: [] as string[],
}));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => site.origin,
  clipboardWritten: (text: string) => {
    site.copied.push(text);
    return Promise.resolve(true);
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

beforeEach(() => {
  resizeObserverStubbed();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  site.copied.length = 0;
  vi.unstubAllGlobals();
});

function created(): Promise<Response> {
  return Promise.resolve(answer({ tenant: "acme", project: "atlas" }, 201));
}

/** The line as the page draws it, none where no line is drawn or it is folded. */
function line(): HTMLElement | null {
  return document.querySelector("code");
}

/** The bar the folded line opens from, none where no line is drawn. */
function bar(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: copyTextEn(claudeCodeLineAbout),
  });
}

function opened(): HTMLElement {
  const pressed = bar();
  if (pressed === null) throw new Error("no line is drawn");
  fireEvent.click(pressed);
  const drawnLine = line();
  if (drawnLine === null) throw new Error("the bar opened no line");
  return drawnLine;
}

function copyControl(): HTMLElement | null {
  return screen.queryByRole("button", { name: copyTextEn(claudeCodeLineCopy) });
}

/** Whether `earlier` is drawn before `later` in the document. */
function precedes(earlier: Node, later: Node): boolean {
  return (
    (earlier.compareDocumentPosition(later) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

test("the page a project is made at draws the line folded under its heading, and its bar opens the line for its own site, broken between its words", async () => {
  served([], created, accessHolding([administered("mimage")]));
  await drawn(<ProjectCreationPage />);
  expect(line()).toBeNull();
  const folded = bar();
  if (folded === null) throw new Error("no line is drawn");
  expect(
    precedes(screen.getByRole("heading", { name: "New project" }), folded),
  ).toBe(true);
  const drawnLine = opened();
  expect(drawnLine.textContent).toBe(claudeCodeLine(site.origin));
  expect(drawnLine.classList.contains("wrap-anywhere")).toBe(true);
  expect(document.querySelectorAll("code")).toHaveLength(1);
});

test("the welcome page draws the line open under its heading, for its own site, broken between its words, with no bar to open it", async () => {
  served([], created, accessHolding([administered("mimage")]));
  await drawn(<Landing />);
  expect(bar()).toBeNull();
  expect(screen.getByText(copyTextEn(claudeCodeLineAbout))).toBeDefined();
  const drawnLine = line();
  if (drawnLine === null) throw new Error("no line is drawn");
  expect(
    precedes(
      screen.getByRole("heading", { name: "Welcome to chuggy" }),
      drawnLine,
    ),
  ).toBe(true);
  expect(drawnLine.textContent).toBe(claudeCodeLine(site.origin));
  expect(drawnLine.classList.contains("wrap-anywhere")).toBe(true);
  expect(document.querySelectorAll("code")).toHaveLength(1);
});

test.each([
  ["the page a project is made at", <ProjectCreationPage key="page" />],
  ["the welcome page", <Landing key="landing" />],
] as const)(
  "%s says the control's name on it as a word",
  async (_page, page) => {
    served([], created, accessHolding([administered("mimage")]));
    await drawn(page);
    const control = copyControl();
    if (control === null) throw new Error("no control is drawn");
    expect(control.textContent).toContain(copyTextEn(claudeCodeLineCopy));
  },
);

test("the page a project is made at draws the line over the form", async () => {
  served([], created, accessHolding([administered("mimage")]));
  await drawn(<ProjectCreationPage />);
  const drawnLine = opened();
  expect(precedes(drawnLine, workspaceChoice())).toBe(true);
  expect(precedes(drawnLine, submit())).toBe(true);
});

test("the control puts the whole line on the clipboard while it is folded, says so, and asks the network for nothing", async () => {
  served([], created, accessHolding([administered("mimage")]));
  const asked = vi.fn(fetch);
  vi.stubGlobal("fetch", asked);
  await drawn(<ProjectCreationPage />);
  const before = asked.mock.calls.length;
  expect(before).toBeGreaterThan(0);
  await press(copyTextEn(claudeCodeLineCopy));
  expect(line()).toBeNull();
  expect(site.copied).toStrictEqual([claudeCodeLine(site.origin)]);
  expect(
    screen
      .getAllByRole("status")
      .map((status) => status.textContent)
      .filter((said) => said !== ""),
  ).toStrictEqual(["Copied"]);
  expect(asked.mock.calls.length).toBe(before);
});

test("the line is drawn while the workspaces read is unsettled, and is the same line once the choice arrives", async () => {
  const unsettled = heldAnswer();
  served([], created, {
    ...accessHolding([]),
    workspaces: () => unsettled.answered,
  });
  await drawn(<ProjectCreationPage />);
  expect(screen.getByText("Loading…")).toBeDefined();
  const early = opened();
  expect(early.textContent).toBe(claudeCodeLine(site.origin));
  expect(copyControl()).not.toBeNull();
  unsettled.release(
    answer({ tenants: [administered("mimage")], truncated: false }),
  );
  await settled();
  expect(workspaceChoice().textContent).toContain("mimage");
  expect(line()).toBe(early);
});

test.each([
  ["no workspace", []],
  ["none to add to", [joined("zephyr")]],
] as const)(
  "the page a project is made at draws no line and no control for a reader with %s, who is drawn the empty state",
  async (_reader, tenants) => {
    served([], created, accessHolding(tenants));
    await drawn(<ProjectCreationPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /^No workspace|^Not a workspace admin/u,
    );
    expect(bar()).toBeNull();
    expect(line()).toBeNull();
    expect(copyControl()).toBeNull();
    expect(screen.queryByText(copyTextEn(claudeCodeLineAbout))).toBeNull();
  },
);
