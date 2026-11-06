/**
 * The ticket header as drawn: a label for every state that is never only a
 * colour, the bar that stands in for the header once it scrolls away, and the
 * Runs tab's count.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  TicketHeader,
  TicketTabs,
} from "../app/browser/ticket/TicketHeader.tsx";
import { TicketStateLabel } from "../app/browser/ticket/TicketStateLabel.tsx";
import type { TicketListStanding } from "../app/core/ticketListView.ts";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const standings: readonly TicketListStanding[] = [
  "Ready",
  "Blocked",
  "Work",
  "Evaluation",
  "Finalization",
  "Escalated",
  "Done",
  "Revoked",
];

test("every state's label is its word after a mark, and only a moving state's mark spins", () => {
  for (const standing of standings) {
    const { container } = render(
      <TicketStateLabel standing={standing} size="page" />,
    );
    const label = container.querySelector<HTMLElement>(".ticket-state");
    const mark = label?.querySelector("svg");
    expect(label?.tagName, standing).toBe("SPAN");
    expect(mark?.getAttribute("aria-hidden"), standing).toBe("true");
    expect(mark?.hasAttribute("data-spins"), standing).toBe(
      standing === "Work" ||
        standing === "Evaluation" ||
        standing === "Finalization",
    );
    cleanup();
  }
  render(<TicketStateLabel standing="Evaluation" size="small" />);
  const small = screen.getByText("Evaluating");
  expect(small.dataset["size"]).toBe("small");
  expect(small.dataset["form"]).toBe("filled");
  expect(small.dataset["tone"]).toBe("evaluation");
});

/** An observer the case reports through, as a browser reports a header
 * leaving the view. */
function observerStubbed(): (intersecting: boolean) => void {
  let report: (intersecting: boolean) => void = () => undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(told: (entries: { isIntersecting: boolean }[]) => void) {
        report = (intersecting) => {
          told([{ isIntersecting: intersecting }]);
        };
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  return (intersecting) => {
    report(intersecting);
  };
}

function headerDrawn(): void {
  render(
    <TicketHeader
      ticket={335}
      title="Lock the contract"
      standing="Escalated"
      fragment={{ fragment: "Words", words: "Rework budget exhausted" }}
      nowMs={0}
      actions={null}
      notes={null}
    />,
  );
}

test("the bar holding the small label and the title shows once the header has scrolled out of view, and goes when it is back", () => {
  const report = observerStubbed();
  headerDrawn();
  const bar = document.querySelector<HTMLElement>(".ticket-sticky-bar");
  expect(bar?.hidden).toBe(true);
  act(() => {
    report(false);
  });
  expect(bar?.hidden).toBe(false);
  expect(
    within(bar as HTMLElement).getByText("Escalated").dataset["size"],
  ).toBe("small");
  expect(
    within(bar as HTMLElement).getByText("Lock the contract"),
  ).toBeDefined();
  act(() => {
    report(true);
  });
  expect(bar?.hidden).toBe(true);
});

test("a browser without the observer never shows the bar", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  headerDrawn();
  expect(
    document.querySelector<HTMLElement>(".ticket-sticky-bar")?.hidden,
  ).toBe(true);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Lock the contract #335",
  );
});

test("Runs carries its count once the page holds a run, and the tabs are the same either way", () => {
  const partition = { tenant: "acme", project: "atlas" };
  const drawn = (runCount: number | undefined): readonly string[] => {
    render(
      <TicketTabs partition={partition} ticket={335} runCount={runCount} />,
    );
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");
    cleanup();
    return names;
  };
  expect(drawn(undefined)).toStrictEqual([
    "Overview",
    "Runs",
    "Configuration",
    "Usage",
  ]);
  expect(drawn(0)).toStrictEqual([
    "Overview",
    "Runs",
    "Configuration",
    "Usage",
  ]);
  expect(drawn(6)).toStrictEqual([
    "Overview",
    "Runs6",
    "Configuration",
    "Usage",
  ]);
});
