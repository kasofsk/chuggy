/**
 * A ticket named in prose, drawn: the number always, the title and the phase
 * where the project knows them, and a link the shell answers rather than the
 * browser.
 *
 * The case that matters most is the one with nothing held. A report drawn
 * outside a shell has no project to resolve against, and a reference there
 * draws the number alone rather than a link to nowhere — which is the
 * degradation the agent's own objectives promise, so it is asserted rather than
 * left to hold by accident. It is also what lets every other conversation suite
 * mount a report with `render()` and no provider at all.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import { TicketReferenceProvider } from "../app/browser/ui/ticketReferenceHeld.tsx";
import type {
  TicketReferenceFacts,
  TicketReferenceHeld,
} from "../app/browser/ui/ticketReferenceHeld.tsx";

afterEach(cleanup);

function heldOf(
  known: Readonly<Record<number, TicketReferenceFacts>>,
  open: (ticket: number) => void = () => undefined,
): TicketReferenceHeld {
  return {
    factsOf: (ticket) => known[ticket],
    hrefOf: (ticket) => `/acme/atlas/tickets/${String(ticket)}`,
    open,
  };
}

function underShell(held: TicketReferenceHeld, body: ReactNode): ReactNode {
  return <TicketReferenceProvider held={held}>{body}</TicketReferenceProvider>;
}

const report = <MarkdownReport text="closed [[ticket:15]]" bare />;

test("a reference with nothing held draws the number and no link", () => {
  const view = render(report);
  expect(view.container.textContent).toContain("#15");
  expect(view.container.querySelector("a")).toBeNull();
});

test("a reference draws the ticket's title and phase, and links to its screen", () => {
  render(
    underShell(
      heldOf({ 15: { title: "Fix the thing", phase: "Working" } }),
      report,
    ),
  );

  const link = screen.getByRole("link");
  expect(link.getAttribute("href")).toBe("/acme/atlas/tickets/15");
  expect(link.textContent).toContain("#15");
  expect(link.textContent).toContain("Fix the thing");
  expect(link.textContent).toContain("Working");
  expect(link.className).toContain("pill-live");
});

test("a ticket the project has not read is still the number, and still follows", () => {
  render(underShell(heldOf({}), report));

  const link = screen.getByRole("link");
  expect(link.getAttribute("href")).toBe("/acme/atlas/tickets/15");
  expect(link.textContent).toContain("#15");
  expect(link.className).toContain("pill-neutral");
});

test("a plain press is the shell's navigation, not the browser's", () => {
  const open = vi.fn();
  render(underShell(heldOf({}, open), report));

  const notPrevented = fireEvent.click(screen.getByRole("link"), { button: 0 });
  expect(open).toHaveBeenCalledWith(15);
  expect(notPrevented).toBe(false);
});

/** A reader asking for a new tab is asking their browser, not the shell. */
test("a press the reader meant for their browser is left to it", () => {
  const open = vi.fn();
  render(underShell(heldOf({}, open), report));

  fireEvent.click(screen.getByRole("link"), { button: 0, metaKey: true });
  expect(open).not.toHaveBeenCalled();
});
