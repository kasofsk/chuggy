/**
 * The ticket page's tabs as drawn through `TabNav`: the same four whatever
 * the ticket's state, Runs carrying the primitive's count once the page holds
 * a run. Which tab is current at each address, and the headings each tab
 * opens on, are `ticketPageRoutes.test.tsx`'s, where the router runs.
 *
 * The router is stubbed, as the primitive's suite stubs it, so the tabs are
 * drawn with no provider around them.
 */

import { cleanup, screen } from "@testing-library/react";
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

/** Each tab's name and the count the primitive draws beside it, if any. */
function ticketPageTabsDrawn(
  runCount: number | undefined,
  runCountCut = false,
): readonly (readonly [string, string | undefined])[] {
  renderCopied(
    <TicketTabs
      partition={{ tenant: "acme", project: "atlas" }}
      ticket={335}
      runCount={runCount}
      runCountCut={runCountCut}
      runsWithin={false}
    />,
  );
  const tabs = screen
    .getAllByRole("link")
    .map(
      (link) =>
        [
          link.textContent ?? "",
          link.querySelector(".tab-nav-count")?.textContent,
        ] as const,
    );
  cleanup();
  return tabs;
}

test("the tabs are TabNav's, in a navigation landmark named for the ticket", () => {
  renderCopied(
    <TicketTabs
      partition={{ tenant: "acme", project: "atlas" }}
      ticket={335}
      runCount={undefined}
      runCountCut={false}
      runsWithin={false}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Ticket" });
  expect(nav.classList.contains("tab-nav")).toBe(true);
  expect(nav.querySelectorAll(".tab-nav-tab")).toHaveLength(4);
});

test("Runs carries the primitive's count once the page holds a run, and the tabs are the same either way", () => {
  const uncounted = [
    ["Overview", undefined],
    ["Runs", undefined],
    ["Configuration", undefined],
    ["Usage", undefined],
  ];
  expect(ticketPageTabsDrawn(undefined)).toStrictEqual(uncounted);
  expect(ticketPageTabsDrawn(0)).toStrictEqual(uncounted);
  expect(ticketPageTabsDrawn(6)).toStrictEqual([
    ["Overview", undefined],
    ["Runs 6", "6"],
    ["Configuration", undefined],
    ["Usage", undefined],
  ]);
  expect(ticketPageTabsDrawn(50, true)).toStrictEqual([
    ["Overview", undefined],
    ["Runs 50+", "50+"],
    ["Configuration", undefined],
    ["Usage", undefined],
  ]);
});
