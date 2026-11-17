/**
 * The ticket page's tabs as drawn through `TabNav`: the same four whatever
 * the ticket's state, Runs carrying the primitive's count once the page holds
 * a run, and Runs current on a page under it as well as on its own address.
 *
 * The router is stubbed, as the primitive's suite stubs it, so the links are
 * drawn with no provider around them.
 */

import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TicketTabs } from "../app/browser/ticket/TicketPageTabs.tsx";
import { renderCopied } from "./copied.tsx";

vi.mock(
  "@tanstack/react-router",
  async () => await import("./routerLinkStubbed.tsx"),
);

afterEach(() => {
  cleanup();
});

function ticketTabsDrawn(drawn: {
  readonly runCount?: number;
  readonly runCountCut?: boolean;
  readonly runsWithin?: boolean;
}): HTMLElement {
  renderCopied(
    <TicketTabs
      partition={{ tenant: "acme", project: "atlas" }}
      ticket={335}
      runCount={drawn.runCount}
      runCountCut={drawn.runCountCut ?? false}
      runsWithin={drawn.runsWithin ?? false}
    />,
  );
  return screen.getByRole("navigation", { name: "Ticket" });
}

/** Each tab's label and the count beside it, as the primitive draws one. */
function ticketTabsRead(
  nav: HTMLElement,
): readonly (readonly [string, string | undefined])[] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => [
      link.firstChild?.textContent ?? "",
      link.querySelector(".tab-nav-count")?.textContent,
    ]);
}

test("the tabs are the primitive's, and Runs carries its count once the page holds a run", () => {
  const counted = (
    runCount: number | undefined,
    runCountCut = false,
  ): readonly (readonly [string, string | undefined])[] => {
    const nav = ticketTabsDrawn({
      ...(runCount === undefined ? {} : { runCount }),
      runCountCut,
    });
    expect(nav.classList.contains("tab-nav")).toBe(true);
    const read = ticketTabsRead(nav);
    cleanup();
    return read;
  };
  const tabs = (runs: string | undefined) => [
    ["Overview", undefined],
    ["Runs", runs],
    ["Configuration", undefined],
    ["Usage", undefined],
  ];
  expect(counted(undefined)).toStrictEqual(tabs(undefined));
  expect(counted(0)).toStrictEqual(tabs(undefined));
  expect(counted(6)).toStrictEqual(tabs("6"));
  expect(counted(50, true)).toStrictEqual(tabs("50+"));
});

test("Runs is the current tab on a page under it", () => {
  const nav = ticketTabsDrawn({ runsWithin: true });
  expect(
    within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.firstChild?.textContent),
  ).toStrictEqual(["Runs"]);
});
