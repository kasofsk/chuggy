/**
 * The page header in each shape it draws: a level-one title, the controls it
 * is handed by their names, one primary action at most, and the bar that
 * stands in for it once it has scrolled away.
 *
 * The router is stubbed, as `ButtonLink`'s own suite stubs it, so the links
 * are drawn with no provider around them.
 */

import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";

import { PageHeader } from "../app/browser/ui/PageHeader.tsx";
import pageHeaderSheet from "../app/browser/ui/PageHeader.css?raw";
import type { PageHeaderAction } from "../app/browser/ui/PageHeader.tsx";
import { intersectionObserverStubbed } from "./intersectionObserver.ts";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";
import { renderCopied } from "./copied.tsx";
import { styleless } from "./styleless.ts";

vi.mock("@tanstack/react-router", () => import("./routerLinkStubbed.tsx"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const merge: PageHeaderAction = { label: "Merge", onPress: () => undefined };
const edit: PageHeaderAction = { label: "Edit", onPress: () => undefined };
const duplicate: PageHeaderAction = {
  label: "Duplicate",
  link: { to: "/" },
};

function pageHeaderPrimaries(): number {
  return document.querySelectorAll(".page-header .btn-primary").length;
}

function pageHeaderHeading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

test("a bare header is a level-one title and draws no control", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const view = renderCopied(<PageHeader title="Tickets" />);
  expect(pageHeaderHeading().textContent).toBe("Tickets");
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(view.container.querySelector(".page-header-standing")).toBeNull();
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("the number stands in the title after it", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(<PageHeader title="Lock the contract" number={335} />);
  expect(pageHeaderHeading().textContent).toBe("Lock the contract #335");
});

test("the back link is a crumb drawn above the title", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(
    <PageHeader title="Epic" back={{ label: "Epics", link: { to: "/" } }} />,
  );
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(nav).getByText("Epics").tagName).toBe("A");
  expect(
    nav.compareDocumentPosition(pageHeaderHeading()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
});

test("the status sits under the title and the description between them", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(
    <PageHeader
      title="Console"
      status={<span>Open</span>}
      description="The console's own work."
    />,
  );
  const description = screen.getByText("The console's own work.");
  expect(description.tagName).toBe("P");
  const header = document.querySelector<HTMLElement>("header.page-header");
  expect(
    within(header as HTMLElement)
      .getByText("Open")
      .closest(".page-header-status"),
  ).not.toBeNull();
  expect(
    pageHeaderHeading().compareDocumentPosition(description) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

test("the primary action is the one primary drawn, after the secondaries and before the overflow", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(
    <PageHeader
      title="Lock the contract"
      primary={merge}
      secondary={[edit, duplicate]}
      overflow={<button type="button">More</button>}
    />,
  );
  const actions = document.querySelector<HTMLElement>(".page-header-actions");
  expect(actions).not.toBeNull();
  const named = Array.from(
    (actions as HTMLElement).querySelectorAll("button, a"),
    (control) => control.textContent,
  );
  expect(named).toEqual(["Edit", "Duplicate", "Merge", "More"]);
  expect(pageHeaderPrimaries()).toBe(1);
  expect(
    screen
      .getByRole("button", { name: "Merge" })
      .classList.contains("btn-primary"),
  ).toBe(true);
  expect(
    screen
      .getByRole("link", { name: "Duplicate" })
      .classList.contains("btn-default"),
  ).toBe(true);
});

test("on a narrow container every action the header and its bar draw is a finger's height", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(
    <PageHeader title="Lock the contract" primary={merge} secondary={[edit]} />,
  );
  const wide = sheetRules(pageHeaderSheet, []);
  const narrow = sheetRules(pageHeaderSheet, [sheetNarrowCondition]);
  const drawn = Array.from(document.querySelectorAll(".btn"));
  expect(drawn).toHaveLength(3);
  for (const action of drawn) {
    expect(sheetDeclared(wide, action, "height")).toBe("var(--height-icon)");
    expect(sheetDeclared(narrow, action, "height")).toBe("var(--height-touch)");
  }
  for (const container of document.querySelectorAll(
    ".page-header, .page-header-sticky",
  ))
    expect(sheetDeclared(wide, container, "container-type")).toBe(
      "inline-size",
    );
});

test("secondaries alone draw no primary", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(<PageHeader title="Epics" secondary={[edit, duplicate]} />);
  expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
  expect(screen.getByRole("link", { name: "Duplicate" })).toBeDefined();
  expect(pageHeaderPrimaries()).toBe(0);
});

test("the actions the header draws are not a shape that admits a second primary", () => {
  const twoPrimaries: ComponentProps<typeof PageHeader> = {
    title: "Tickets",
    // @ts-expect-error -- the primary is one action, never a list of them.
    primary: [merge, edit],
  };
  const drawnSecondary: ComponentProps<typeof PageHeader> = {
    title: "Tickets",
    // @ts-expect-error -- a secondary is an action the header draws, never an element drawn primary by its caller.
    secondary: [<button key="merge">Merge</button>],
  };
  expect([twoPrimaries.title, drawnSecondary.title]).toEqual([
    "Tickets",
    "Tickets",
  ]);
});

test("the bar holding the status, the title and the primary shows once the header has scrolled away, and goes when it is back", () => {
  const report = intersectionObserverStubbed();
  renderCopied(
    <PageHeader
      title="Lock the contract"
      number={335}
      status={<span>Escalated</span>}
      statusCondensed={<span>Small</span>}
      primary={merge}
      secondary={[edit]}
    />,
  );
  const bar = document.querySelector<HTMLElement>(".page-header-sticky-bar");
  expect(bar?.hidden).toBe(true);
  expect(screen.getAllByRole("button", { name: "Merge" })).toHaveLength(1);
  act(() => {
    report(false);
  });
  expect(bar?.hidden).toBe(false);
  const drawn = within(bar as HTMLElement);
  expect(drawn.getByText("Lock the contract")).toBeDefined();
  expect(drawn.getByText("Small")).toBeDefined();
  expect(drawn.queryByText("Escalated")).toBeNull();
  expect(drawn.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Merge",
  ]);
  act(() => {
    report(true);
  });
  expect(bar?.hidden).toBe(true);
});

test("a browser without the observer never shows the bar", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(<PageHeader title="Tickets" primary={merge} />);
  expect(
    document.querySelector<HTMLElement>(".page-header-sticky-bar")?.hidden,
  ).toBe(true);
});
