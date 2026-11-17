/**
 * The ticket header as drawn: a label for every state that is never only a
 * colour, the bar that stands in for the header once it scrolls away, the
 * epics under the title, and the status a change of state is said in.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { act, cleanup, screen, within } from "@testing-library/react";
import { renderCopied } from "./copied.tsx";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { TicketHeader } from "../app/browser/ticket/TicketHeader.tsx";
import { TicketStateLabel } from "../app/browser/ticket/TicketStateLabel.tsx";
import { ticketStateLabelOf } from "../app/core/ticketHeader.ts";
import type { TicketListStanding } from "../app/core/ticketListView.ts";
import { intersectionObserverStubbed } from "./intersectionObserver.ts";

vi.mock("@tanstack/react-router", () => {
  const stub = (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  );
  return { createLink: () => stub, Link: stub };
});
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

test("every state's label is its status badge, the page's regular and the bar's small, in its label's tone", () => {
  for (const standing of standings) {
    const { container } = renderCopied(
      <TicketStateLabel standing={standing} size="regular" />,
    );
    const label = container.querySelector<HTMLElement>(".status-badge");
    const mark = label?.querySelector("svg");
    expect(label?.tagName, standing).toBe("SPAN");
    expect(label?.dataset["tone"], standing).toBe(
      ticketStateLabelOf(standing).tone,
    );
    expect(mark?.getAttribute("aria-hidden"), standing).toBe("true");
    cleanup();
  }
  renderCopied(<TicketStateLabel standing="Evaluation" size="small" />);
  const small = screen
    .getByText("Evaluating")
    .closest<HTMLElement>(".status-badge");
  expect(small?.dataset["size"]).toBe("small");
  expect(small?.dataset["tone"]).toBe("evaluation");
});

function headerDrawn(): void {
  renderCopied(
    <TicketHeader
      ticket={335}
      title="Lock the contract"
      standing="Escalated"
      fragment={{ fragment: "Words", words: "Rework budget exhausted" }}
      nowMs={0}
      actions={null}
      epics={null}
      notes={null}
    />,
  );
}

test("the bar holding the small label and the title shows once the header has scrolled out of view, and goes when it is back", () => {
  const report = intersectionObserverStubbed();
  headerDrawn();
  const bar = document.querySelector<HTMLElement>(".page-header-sticky-bar");
  expect(bar?.hidden).toBe(true);
  act(() => {
    report(false);
  });
  expect(bar?.hidden).toBe(false);
  expect(
    within(bar as HTMLElement)
      .getByText("Escalated")
      .closest<HTMLElement>(".status-badge")?.dataset["size"],
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
    document.querySelector<HTMLElement>(".page-header-sticky-bar")?.hidden,
  ).toBe(true);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Lock the contract #335",
  );
});

test("the epics the header is given are drawn in it, after the title", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  renderCopied(
    <TicketHeader
      ticket={335}
      title="Lock the contract"
      standing="Ready"
      fragment={{ fragment: "None" }}
      nowMs={0}
      actions={null}
      epics={<span>Billing</span>}
      notes={null}
    />,
  );
  const header = document.querySelector<HTMLElement>("header.page-header");
  const epics = within(header as HTMLElement).getByText("Billing");
  expect(
    screen.getByRole("heading", { level: 1 }).compareDocumentPosition(epics) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

function headerOf(standing: TicketListStanding): ReactNode {
  return (
    <TicketHeader
      ticket={335}
      title="Lock the contract"
      standing={standing}
      fragment={{ fragment: "None" }}
      nowMs={0}
      actions={null}
      epics={null}
      notes={null}
    />
  );
}

test("a change of state is said once through a status, and the state the page opens on is not", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const view = renderCopied(headerOf("Ready"));
  const status = screen.getByRole("status");
  expect(status.classList.contains("visually-hidden")).toBe(true);
  expect(status.textContent).toBe("");
  view.rerender(headerOf("Ready"));
  expect(status.textContent).toBe("");
  view.rerender(headerOf("Work"));
  expect(status.textContent).toBe("Ticket is now Working");
  const changes = new MutationObserver(() => undefined);
  changes.observe(status, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  view.rerender(headerOf("Work"));
  expect(changes.takeRecords()).toStrictEqual([]);
  changes.disconnect();
  view.rerender(headerOf("Done"));
  expect(screen.getByRole("status")).toBe(status);
  expect(status.textContent).toBe("Ticket is now Done");
});
