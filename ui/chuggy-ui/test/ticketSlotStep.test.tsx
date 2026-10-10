/**
 * The card a ticket that needs someone draws, where the line that says why
 * can name the page the way past it is on: the link after the line, into the
 * ticket's own project, and no link where the line names no page.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { TicketSlot } from "../app/browser/ticket/TicketSlot.tsx";
import { ticketSlot } from "../app/core/ticketSituation.ts";
import type { TicketEscalation } from "../../../src/contract/responses.ts";
import { leadPartition } from "./leadFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";
import type * as RouterModule from "@tanstack/react-router";

/** A link's path is filled from its params, so a link into the wrong project
 * is a wrong href rather than the same one. */
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  ),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(cleanup);

/** The card of a ticket parked at `escalation`, with one action under it. */
function drawParked(escalation: TicketEscalation): HTMLElement {
  const slot = ticketSlot({
    ticket: {
      ticket: 11,
      phase: "Escalated",
      sequence: 7,
      escalation,
      ...ticketInstants,
    },
    ledger: undefined,
    stageCount: 1,
    open: [],
    executions: [],
  });
  render(
    <TicketSlot
      partition={leadPartition}
      slot={slot}
      actions={<button type="button">Resume</button>}
      nowMs={0}
    />,
  );
  return screen.getByRole("status", { name: "Needs you" });
}

test("a ticket parked with nowhere to run says so, with the way to Runners after the line", () => {
  const card = drawParked({
    kind: "WorkExecutionUnavailableEscalated",
    evidence: "RequiredCapabilityUnavailable",
    resumeAt: "ResumeWork",
  });
  const line = within(card).getByText(/^Nowhere to run this work/u);
  expect(line.textContent).toBe("Nowhere to run this work · Runners");
  expect(
    within(line).getByRole("link", { name: "Runners" }).getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/runners`);
  expect(within(card).getByRole("button", { name: "Resume" })).toBeTruthy();
});

test("a ticket parked at any other wall draws its line and no link", () => {
  const card = drawParked({
    kind: "WorkExecutionUnavailableEscalated",
    evidence: "ExecutionProfileUnavailable",
    resumeAt: "ResumeWork",
  });
  expect(within(card).getByText("No matching execution profile")).toBeTruthy();
  expect(within(card).queryByRole("link")).toBeNull();
});
