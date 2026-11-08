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
import { copyTextEn } from "../app/copy/catalog.ts";

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

/** The card of a ticket parked at `escalation`, with one action under it, for
 * a reader the card offers its setup lines where `setupOverridable` says so. */
function drawParked(
  escalation: TicketEscalation,
  setupOverridable = false,
): HTMLElement {
  const slot = ticketSlot(
    {
      ticket: {
        ticket: 11,
        phase: "Escalated",
        sequence: 7,
        escalation,
        ...ticketInstants,
      },
      landings: [],
      ledger: undefined,
      names: undefined,
      open: [],
      executions: [],
      setupOverridable,
      nowMs: 0,
    },
    copyTextEn,
  );
  render(
    <TicketSlot partition={leadPartition} ticket={11} slot={slot} nowMs={0} />,
  );
  return screen.getByRole("status", { name: "Needs you" });
}

test("a ticket parked with nowhere to run says so, with the way to Runners after the line", () => {
  const card = drawParked({
    kind: "WorkExecutionUnavailableEscalated",
    evidence: "RequiredCapabilityUnavailable",
    resumeAt: "ResumeWork",
  });
  const head = card.querySelector<HTMLElement>(".ticket-card-head");
  if (head === null) throw new Error("no card head drawn");
  expect(head.textContent).toBe("Nowhere to run this workRunners");
  expect(
    within(head).getByRole("link", { name: "Runners" }).getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/runners`);
  expect(within(card).queryByRole("button")).toBeNull();
});

test("a ticket parked at any other wall draws its line and no link", () => {
  const card = drawParked({
    kind: "WorkExecutionUnavailableEscalated",
    evidence: "ExecutionProfileUnavailable",
    resumeAt: "ResumeWork",
  });
  expect(within(card).getByText("No matching run profile")).toBeTruthy();
  expect(within(card).queryByRole("link")).toBeNull();
});

test("a ticket whose setup failed names the step and where a wrong line is fixed, and no link", () => {
  const card = drawParked(
    {
      kind: "WorkFailureEscalated",
      resumeAt: "ResumeWork",
      failed: {
        evidence: "RunSetupFailed",
        execution: "execution-1",
        attempt: "attempt-1",
      },
    },
    true,
  );
  expect(within(card).getByText("Setup failed")).toBeTruthy();
  expect(
    within(card).getByText("Fix it under Overrides · Setup, then Resume"),
  ).toBeTruthy();
  expect(within(card).queryByRole("link")).toBeNull();
});
