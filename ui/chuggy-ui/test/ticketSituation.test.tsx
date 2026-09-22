/**
 * The situation notice, on the one case that is not a phase or a wall: a
 * Pending ticket blocked by a dependency its own author revoked. The read
 * answers `revokedDependencies` for a Pending ticket alone, and the notice
 * draws what the read says.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import { SituationNotice } from "../app/browser/ticket/TicketSituation.tsx";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import { ticketInstants } from "./ticketInstants.ts";
import {
  evalIdentity,
  ledgerPage,
  ticket21Authoring,
  ticket21Parked,
  workIdentity,
} from "./ticketLedgerFixture.ts";

afterEach(cleanup);

const authoring = { dependencies: [], program: [] };
const facts = ticketLedger(ledgerPage([]), authoring);

function ticket(over: Partial<TicketResponse> = {}): TicketResponse {
  return {
    ticket: 11,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    ...over,
  };
}

test("a Pending ticket blocked by one revoked dependency names it, singular", () => {
  render(
    <SituationNotice
      ticket={ticket({ revokedDependencies: [3] })}
      facts={facts}
      stageCount={1}
      nowMs={0}
    />,
  );
  expect(screen.getByText("Blocked by revoked dependency 3")).toBeDefined();
});

test("a Pending ticket blocked by more than one names them, plural and ascending", () => {
  render(
    <SituationNotice
      ticket={ticket({ revokedDependencies: [1, 2] })}
      facts={facts}
      stageCount={1}
      nowMs={0}
    />,
  );
  expect(
    screen.getByText("Blocked by revoked dependencies 1, 2"),
  ).toBeDefined();
});

test("a Pending ticket waiting on nothing revoked draws its phase, not a banner", () => {
  render(
    <SituationNotice
      ticket={ticket({ revokedDependencies: [] })}
      facts={facts}
      stageCount={1}
      nowMs={0}
    />,
  );
  expect(screen.queryByText(/Blocked by revoked/u)).toBeNull();
  expect(screen.getByText("Pending")).toBeDefined();
});

/**
 * A cycle can hold two stages past their first generation at once: stage 1
 * resumed and settled, stage 2 resumed and still running. The notice names
 * the one resumed now, not the first one a resume ever touched.
 */
/**
 * A two-stage page where each stage blocked at generation 1 and was re-asked;
 * the second stage's second generation ends however the case says.
 */
function twoResumedStages(
  lastRow: { readonly outcome: "Failed" } | { readonly status: "Running" },
): ReturnType<typeof ticketLedger> {
  return ticketLedger(
    ledgerPage([
      {
        execution: "execution-aa-1",
        task: 1,
        identity: workIdentity(1),
        outcome: "Passed",
      },
      {
        execution: "execution-bb-2",
        task: 2,
        identity: evalIdentity(1, 1, 1),
        outcome: "Blocked",
      },
      {
        execution: "execution-cc-3",
        task: 3,
        identity: evalIdentity(1, 1, 2),
        outcome: "Passed",
      },
      {
        execution: "execution-dd-4",
        task: 4,
        identity: evalIdentity(1, 2, 1),
        outcome: "Blocked",
      },
      {
        execution: "execution-ee-5",
        task: 5,
        identity: evalIdentity(1, 2, 2),
        ...lastRow,
      },
    ]),
    {
      dependencies: [],
      program: [
        { key: 1, evaluators: [{ key: 1 }] },
        { key: 2, evaluators: [{ key: 1 }] },
      ],
    },
  );
}

test("resumedFrom names the highest-numbered stage whose resume is still running", () => {
  render(
    <SituationNotice
      ticket={ticket({ phase: "Evaluation", revokedDependencies: [] })}
      facts={twoResumedStages({ status: "Running" })}
      stageCount={2}
      nowMs={0}
    />,
  );
  expect(screen.getByText("Resumed at stage 2 · cycle 1")).toBeDefined();
});

test("with nothing running, resumedFrom names the highest-numbered stage a resume re-asked", () => {
  render(
    <SituationNotice
      ticket={ticket({ phase: "Evaluation", revokedDependencies: [] })}
      facts={twoResumedStages({ outcome: "Failed" })}
      stageCount={2}
      nowMs={0}
    />,
  );
  expect(screen.getByText("Resumed at stage 2 · cycle 1")).toBeDefined();
});

test("a ticket never resumed draws no resume line", () => {
  const neverResumed = ticketLedger(
    ledgerPage(ticket21Parked),
    ticket21Authoring,
  );
  render(
    <SituationNotice
      ticket={ticket({ phase: "Evaluation", revokedDependencies: [] })}
      facts={neverResumed}
      stageCount={2}
      nowMs={0}
    />,
  );
  expect(screen.queryByText(/Resumed at/u)).toBeNull();
});
