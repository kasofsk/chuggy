/**
 * The situation notice, on the one case that is not a phase or a wall: a
 * Pending ticket blocked by a dependency its own author revoked.
 *
 * The gate is read twice on purpose — the contract answers
 * `revokedDependencies` only for a Pending ticket, but this suite pins that
 * the console does not simply trust that: a read naming both a settled phase
 * and a revoked dependency (the shape a stale or inconsistent read could take)
 * must still draw the phase, not the banner.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type { TicketResponse } from "../../../src/contract/responses.ts";
import { SituationNotice } from "../app/browser/ticket/TicketSituation.tsx";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { ledgerPage } from "./ticketLedgerFixture.ts";

afterEach(cleanup);

const authoring = { dependencies: [], program: [], workFanout: 1 };
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

test("a read naming a settled phase alongside a revoked dependency draws the phase, not the banner", () => {
  render(
    <SituationNotice
      ticket={ticket({ phase: "Done", revokedDependencies: [3] })}
      facts={facts}
      stageCount={1}
      nowMs={0}
    />,
  );
  expect(screen.queryByText(/Blocked by revoked/u)).toBeNull();
  expect(screen.getByText("Done")).toBeDefined();
});
