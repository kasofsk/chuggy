/**
 * The execution cell a ticket list and the Inbox draw, held to the ticket
 * page's ledger: for the same execution, the same word in the same hue.
 *
 * The cases are derived from the rosters — every status, every outcome and
 * none, both kinds of task, every carrier and none, a run begun and not — so a
 * member the wire grows is a case this asks about. The ledger's side is read
 * off `ticketLedger` as the ticket page reads it, and drawn as the page draws a
 * set: its verdict, in `verdictTone`'s hue.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import type {
  ExecutionSummary,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  briefingCarriers,
  executionOutcomes,
  executionStatuses,
} from "../../../src/contract/rosters.ts";
import type {
  BriefingCarrier,
  ExecutionStatus,
} from "../../../src/contract/rosters.ts";
import { TicketRowExecutionCell } from "../app/browser/TicketCells.tsx";
import { pillLookClassName } from "../app/browser/ui/Pill.tsx";
import { projectTableRow } from "../app/core/projectTableRows.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import { verdictTone } from "../app/core/tones.ts";
import {
  evalIdentity,
  ledgerExecution,
  ticket21Program,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

afterEach(cleanup);

const working: TicketResponse = {
  ticket: 21,
  phase: "Work",
  sequence: 5,
  ...ticketInstants,
};

const runStartedAt = "2026-08-26T00:05:00.000Z";

interface Drawn {
  readonly word: string | undefined;
  readonly className: string | undefined;
}

/** What the ticket page draws for the one set this execution is: a work
 * task's own row, or the row of the one evaluator it is. */
function ledgerDrawnOf(execution: ExecutionSummary): Drawn {
  const cycle = ticketLedger({ executions: [execution] }, ticket21Program)
    .cycles[0];
  const stage = cycle?.stages[0];
  const set =
    execution.identity.type === "WorkTask"
      ? cycle?.work
      : stage?.kind === "Ran"
        ? stage.evaluators[0]?.set
        : undefined;
  if (set === undefined) return { word: undefined, className: undefined };
  return {
    word: set.verdict,
    className: pillLookClassName({ tone: verdictTone(set.verdict) }),
  };
}

/** What the list's cell draws for the row this execution is joined to. */
function cellDrawnOf(execution: ExecutionSummary): Drawn {
  const { container } = render(
    <TicketRowExecutionCell
      row={projectTableRow(working, { execution, complete: true }, false)}
    />,
  );
  const pill = container.querySelector(".pill");
  const drawn = {
    word: pill?.textContent ?? undefined,
    className: pill?.className,
  };
  cleanup();
  return drawn;
}

function executionOf(shape: Omit<ExecutionShape, "execution" | "task">) {
  return ledgerExecution({ execution: "execution-21-1", task: 1, ...shape });
}

function rosterExecutions(): readonly ExecutionSummary[] {
  const carriers: readonly (BriefingCarrier | undefined)[] = [
    undefined,
    ...briefingCarriers,
  ];
  return [workIdentity(1), evalIdentity(1, 1, 1)].flatMap((identity) =>
    executionStatuses.flatMap((status) =>
      [undefined, ...executionOutcomes].flatMap((outcome) =>
        carriers.flatMap((carrier) =>
          [undefined, runStartedAt].map((started) =>
            executionOf({
              identity,
              status,
              ...(outcome === undefined ? {} : { outcome }),
              ...(carrier === undefined ? {} : { carrier }),
              ...(started === undefined ? {} : { runStartedAt: started }),
            }),
          ),
        ),
      ),
    ),
  );
}

/** A case named by what it is, so a mismatch says which execution it was. */
function caseName(execution: ExecutionSummary): string {
  return [
    execution.identity.type,
    execution.status,
    execution.outcome ?? "no outcome",
    execution.carrier ?? "no carrier",
    execution.runStartedAt === undefined ? "not begun" : "begun",
  ].join(" · ");
}

test("every execution is drawn in the list in the word and hue its ticket's ledger draws it in", () => {
  const executions = rosterExecutions();
  const ledger = executions.map((execution) => ({
    execution: caseName(execution),
    ...ledgerDrawnOf(execution),
  }));
  expect(ledger.every((drawn) => drawn.word !== undefined)).toBe(true);
  expect(
    executions.map((execution) => ({
      execution: caseName(execution),
      ...cellDrawnOf(execution),
    })),
  ).toEqual(ledger);
});

test("an execution still waiting for its worker reads Starting in the queued hue", () => {
  const waiting: readonly [ExecutionStatus, BriefingCarrier][] = [
    ["Queued", "Commands"],
    ["Admitted", "Commands"],
    ["Launching", "Agent"],
    ["Running", "Agent"],
  ];
  for (const [status, carrier] of waiting)
    expect(
      cellDrawnOf(executionOf({ identity: workIdentity(1), status, carrier })),
    ).toEqual({ word: "Starting", className: "pill pill-queued" });
  expect(
    cellDrawnOf(
      executionOf({
        identity: workIdentity(1),
        status: "Running",
        carrier: "Agent",
        runStartedAt,
      }),
    ),
  ).toEqual({ word: "Running", className: "pill pill-live" });
});

test("an evaluator whose process failed is drawn as a stop, and a work task's as a failure", () => {
  const failed = { status: "Terminal", outcome: "ProcessFailed" } as const;
  expect(
    cellDrawnOf(executionOf({ identity: evalIdentity(1, 1, 1), ...failed })),
  ).toEqual({ word: "Blocked", className: "pill pill-retired" });
  expect(
    cellDrawnOf(executionOf({ identity: workIdentity(1), ...failed })),
  ).toEqual({ word: "Failed", className: "pill pill-fail" });
});
