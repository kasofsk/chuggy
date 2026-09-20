/**
 * The ticket page, wired to the two reads it is drawn from.
 *
 * WHAT THIS PROVES IS THE WIRING, not the arithmetic — that is asserted over
 * the pure core, where a case can name a figure without mounting anything. What
 * only a mount can show is that the executions read is asked for THIS ticket
 * and its rows reach the ledger under the same number, which is the mistake
 * that draws a whole page of somebody else's runs without failing anything.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { AdoptedTicketPage } from "../app/browser/AdoptedTickets.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { evaluationRun, runModel, runTotals, workRun } from "./ticketRuns.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition, ticket: "7" }),
  useNavigate: () => () => Promise.resolve(),
  useBlocker: () => undefined,
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ticket = 7;

const definition = {
  ticket,
  revision: 3,
  workCyclesStarted: 2,
  reworkLimit: 5,
  state: "Evaluation",
  dependencies: [4],
  source: "version: 2\ntitle: a ticket\n",
};

const executions = [
  workRun(ticket, 1, runTotals(1_000_000, [runModel("opus", 1_000_000, 900)])),
  evaluationRun(
    ticket,
    1,
    0,
    0,
    0,
    runTotals(200_000, [runModel("haiku", 200_000, 200)]),
  ),
  workRun(ticket, 2, runTotals(500_000, [runModel("opus", 500_000, 400)])),
];

interface Asked {
  readonly url: string;
}

async function drawn(served?: {
  readonly ticket?: unknown;
  readonly executions?: readonly unknown[];
}): Promise<readonly Asked[]> {
  const asked: Asked[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    asked.push({ url });
    if (url.includes("/executions"))
      return Promise.resolve(
        answer({ executions: served?.executions ?? executions }),
      );
    return Promise.resolve(answer(served?.ticket ?? definition));
  });
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <AdoptedTicketPage />
    </ScreenHarness>,
  );
  await settled();
  return asked;
}

test("the executions read is filtered to this ticket in the query", async () => {
  const asked = await drawn();
  const executionsAsk = asked.find((one) => one.url.includes("/executions"));

  expect(executionsAsk?.url).toContain("ticket=7");
});

test("the situation says what the ticket is doing in the reader's own tense", async () => {
  await drawn();

  expect(screen.getByText("Evaluating")).toBeDefined();
  expect(
    screen.getByText(
      "the work is being evaluated against the plan the ticket names",
    ),
  ).toBeDefined();
});

test("the meter draws the cycles started against the limit the release fixed", async () => {
  await drawn();

  expect(screen.getByText("2/5 cycles · 3 before escalation")).toBeDefined();
});

test("an unbounded ticket draws a count with no denominator", async () => {
  await drawn({ ticket: { ...definition, reworkLimit: null } });

  expect(screen.getByText("2 cycles · no limit")).toBeDefined();
});

test("the ledger draws one group per cycle the keys name", async () => {
  await drawn();

  expect(screen.getByText("Cycle 1")).toBeDefined();
  expect(screen.getByText("Cycle 2")).toBeDefined();
});

test("a run whose key will not parse is drawn as unplaced, never inside a cycle", async () => {
  await drawn({
    executions: [
      workRun(ticket, 1, runTotals(10, [])),
      { ...workRun(ticket, 1), taskKey: "work:seven:1" },
    ],
  });

  expect(screen.getByText("Unparsed key")).toBeDefined();
  expect(screen.queryByText("Cycle 2")).toBeNull();
});

test("usage is drawn per stage with no budget beside it", async () => {
  await drawn();
  const stages = screen
    .getByRole("table", { name: "Usage by stage" })
    .querySelectorAll("tbody th");

  expect([...stages].map((cell) => cell.textContent)).toEqual([
    "Work",
    "Stage 1",
  ]);
});

/** A spend with no ceiling is drawn as a quantity; a track under it would be a
 * ceiling this wire does not carry. */
test("usage draws no meter, because there is no budget to draw one against", async () => {
  await drawn();
  const usage = screen.getByRole("region", { name: "Usage" });

  expect(usage.querySelector("meter")).toBeNull();
  expect(usage.querySelector(".meter-cells")).toBeNull();
  expect(usage.querySelector(".meter-bar-unbounded")).toBeNull();
});

test("usage is broken down by model, each model's cost stated once", async () => {
  await drawn();
  const models = screen
    .getByRole("table", { name: "Usage by model" })
    .querySelectorAll("tbody th");

  expect([...models].map((cell) => cell.textContent)).toEqual([
    "opus",
    "haiku",
  ]);
});

test("provenance offers the document the ticket was authored as", async () => {
  await drawn();

  expect(screen.getByText("Show document")).toBeDefined();
});

test("a release that retained no document says so rather than drawing an empty panel", async () => {
  await drawn({ ticket: { ...definition, source: null } });

  expect(
    screen.getByText(/released before its document was kept/u),
  ).toBeDefined();
  expect(screen.queryByText("Show document")).toBeNull();
});

test("the ticket's existing controls are still offered", async () => {
  await drawn();

  expect(screen.getByRole("button", { name: "Dispatch" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Revoke" })).toBeDefined();
});
