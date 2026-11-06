/**
 * A ticket's runs as the Runs tab, a run's page and the landing's read them:
 * each step named as the plan names it, what a cycle came to, how long a run
 * ran, and the address of each run and each of its sub-tabs.
 */

import { expect, test } from "vitest";

import type { ExecutionResponse } from "../../../src/contract/responses.ts";
import { spanRanFigure } from "../app/core/figures.ts";
import { runResultLinePlain } from "../app/core/runResult.ts";
import { runSpanRanOf } from "../app/core/runTotals.ts";
import { runTranscriptStepsCut } from "../app/core/runTranscript.ts";
import type { ConversationExchange } from "../app/core/conversation.ts";
import {
  ticketLandingLinkLabel,
  ticketLandingOf,
  ticketLandingsJoined,
} from "../app/core/ticketLandings.ts";
import type { TicketLanding } from "../app/core/ticketLandings.ts";
import { ticketLedger } from "../app/core/ticketLedger.ts";
import type { TicketProgram } from "../app/core/ticketLedger.ts";
import {
  ticketRunDetailsOf,
  ticketRunImageLabel,
  ticketRunQueryOf,
  ticketRunsFind,
  ticketRunsLandingCycle,
  ticketRunsNamesOf,
  ticketRunsOf,
  ticketRunTaskOf,
  ticketRunViewShown,
  ticketRunViews,
} from "../app/core/ticketRuns.ts";
import type { TicketRunsCycle } from "../app/core/ticketRuns.ts";
import { landingConflicted, landingLanded } from "./ticketLandingsFixture.ts";
import {
  evalIdentity,
  ledgerExecution,
  ledgerPage,
  ticket21Program,
  workIdentity,
} from "./ticketLedgerFixture.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";

/** A catalog whose default plan names two stages, and a second plan of one. */
const catalog = JSON.stringify({
  version: 2,
  workloads: {
    build: { runner: "Agent" },
    gates: { runner: "Commands", commands: ["npm test"] },
    review: { runner: "Agent", purpose: "Review" },
  },
  plans: {
    gated: [
      { name: "checks", evaluators: ["gates"] },
      { name: "review", evaluators: ["review"] },
    ],
    quick: [{ name: "review", evaluators: ["review"] }],
  },
  finalizers: { land: { approvalRequired: false } },
  defaults: { work: "build", evaluation: "gated", finalization: "land" },
});

test("a stage is named as the plan the ticket's selection names it", () => {
  expect(ticketRunsNamesOf(catalog, undefined)).toEqual(["checks", "review"]);
  expect(ticketRunsNamesOf(catalog, { evaluation: "quick" })).toEqual([
    "review",
  ]);
  expect(ticketRunsNamesOf("{}", undefined)).toBeUndefined();
  expect(ticketRunsNamesOf(undefined, undefined)).toBeUndefined();
});

const named = { names: ["checks", "review"], stageCount: 2 };

/** Two cycles: the first sent back by its review, the second failing at it. */
const twoCycles: readonly ExecutionShape[] = [
  { execution: "e-1", task: 1, identity: workIdentity(1), outcome: "Passed" },
  {
    execution: "e-2",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Passed",
  },
  {
    execution: "e-3",
    task: 3,
    identity: evalIdentity(1, 2, 1),
    outcome: "Failed",
  },
  { execution: "e-4", task: 4, identity: workIdentity(2), outcome: "Passed" },
  {
    execution: "e-5",
    task: 5,
    identity: evalIdentity(2, 1, 1),
    outcome: "Passed",
  },
  {
    execution: "e-6",
    task: 6,
    identity: evalIdentity(2, 2, 1),
    outcome: "Failed",
  },
];

function runsOf(
  shapes: readonly ExecutionShape[],
  landings: readonly TicketLanding[] = [],
  program: TicketProgram = ticket21Program,
): readonly TicketRunsCycle[] {
  const ledger = ticketLedger(ledgerPage(shapes), program);
  return ticketRunsOf(
    ledger,
    ticketLandingsJoined(
      landings,
      ledger.cycles.map((cycle) => cycle.ordinal),
    ),
    { names: named.names, stageCount: program.length },
  );
}

/** Each row of each cycle as the Runs tab lists it: its name and, for a run,
 * its task's number, which is its address. */
function rowsSaid(cycles: readonly TicketRunsCycle[]) {
  return cycles.map((cycle) => [
    cycle.ordinal,
    cycle.outcome,
    cycle.rows.map((row) =>
      row.kind === "Run"
        ? `${row.name} ${String(row.task)}`
        : row.kind === "Gap"
          ? `${row.name} ${row.words}`
          : `Landing ${row.landing?.word ?? "Not reached"}`,
    ),
  ]);
}

test("cycles are newest first, each a run per step the plan names, the current one with its landing", () => {
  expect(rowsSaid(runsOf(twoCycles))).toEqual([
    [
      2,
      "Failed at review",
      ["Work 4", "checks 5", "review 6", "Landing Not reached"],
    ],
    [1, "Sent back by review", ["Work 1", "checks 2", "review 3"]],
  ]);
});

test("a stage the program never reached is a step not reached, and a landing is its cycle's last step", () => {
  const stopped = twoCycles
    .slice(0, 2)
    .map((shape) =>
      shape.task === 2 ? { ...shape, outcome: "Failed" as const } : shape,
    );
  expect(rowsSaid(runsOf(stopped))).toEqual([
    [
      1,
      "Failed at checks",
      ["Work 1", "checks 2", "review Not reached", "Landing Not reached"],
    ],
  ]);
  const landed = runsOf(twoCycles.slice(0, 2), [
    ticketLandingOf(landingLanded(1)),
  ]);
  expect(rowsSaid(landed)).toEqual([
    [
      1,
      "Landed",
      ["Work 1", "checks 2", "review Not reached", "Landing Landed"],
    ],
  ]);
});

test("a cycle still running says which step it is at, and one its landing failed says so", () => {
  const running = runsOf([
    ...twoCycles.slice(0, 1),
    { ...twoCycles[1], status: "Running" } as ExecutionShape,
  ]);
  expect(running[0]?.outcome).toBe("Running checks");
  const conflicted = runsOf(
    twoCycles
      .slice(0, 3)
      .map((shape) =>
        shape.task === 3 ? { ...shape, outcome: "Passed" as const } : shape,
      ),
    [ticketLandingOf(landingConflicted(1))],
  );
  expect(conflicted[0]?.outcome).toBe("Landing failed");
});

test("a run is found by its task's number, and a number the page holds no run for finds none", () => {
  const cycles = runsOf(twoCycles);
  expect(ticketRunsFind(cycles, 5)?.name).toBe("checks");
  expect(ticketRunsFind(cycles, 5)?.cycle).toBe(2);
  expect(ticketRunsFind(cycles, 7)).toBeUndefined();
  expect(ticketRunTaskOf("6")).toBe(6);
  expect(ticketRunTaskOf("six")).toBeUndefined();
  expect(ticketRunTaskOf("6.5")).toBeUndefined();
  expect(ticketRunTaskOf("")).toBeUndefined();
});

test("the landing page draws the newest cycle holding a landing, or the current one where none does", () => {
  expect(
    ticketRunsLandingCycle(
      runsOf(twoCycles, [ticketLandingOf(landingConflicted(1))]),
    ),
  ).toBe(1);
  expect(ticketRunsLandingCycle(runsOf(twoCycles))).toBe(2);
  expect(ticketRunsLandingCycle([])).toBeUndefined();
});

test("a run's time is its span from its first attempt's opening to its end", () => {
  const run = ledgerExecution({
    execution: "e-1",
    task: 1,
    identity: workIdentity(1),
    outcome: "Passed",
    registeredAt: "2026-08-26T00:00:00Z",
    terminalAt: "2026-08-26T00:08:00Z",
  });
  const started = { ...run, startedAt: "2026-08-26T00:02:24Z" };
  const nowMs = Date.parse("2026-08-26T01:00:00Z");
  expect(spanRanFigure(runSpanRanOf([started]), nowMs)).toEqual({
    kind: "Duration",
    text: "5m 36s",
  });
  expect(spanRanFigure(runSpanRanOf([run]), nowMs)).toEqual({
    kind: "Duration",
    text: "8m",
  });
});

test("a command run that measured no duration still reads the seconds it took", () => {
  const command = {
    ...ledgerExecution({
      execution: "e-2",
      task: 2,
      identity: evalIdentity(1, 1, 1),
      outcome: "Passed",
      carrier: "Commands",
      totals: { turns: 0, durationMs: 0, costUsdMicros: 0 },
      terminalAt: "2026-08-26T00:20:07Z",
    }),
    startedAt: "2026-08-26T00:20:00Z",
  };
  expect(command.runTotals?.durationMs).toBe(0);
  expect(spanRanFigure(runSpanRanOf([command]), 0)).toEqual({
    kind: "Duration",
    text: "7s",
  });
});

test("a run still open has run until now, and one not started has no time", () => {
  const nowMs = Date.parse("2026-08-26T00:01:30Z");
  expect(
    spanRanFigure({ from: "2026-08-26T00:00:00Z", to: undefined }, nowMs),
  ).toEqual({ kind: "Duration", text: "1m 30s" });
  expect(spanRanFigure({ from: undefined, to: undefined }, nowMs).kind).toBe(
    "Absent",
  );
});

test("a sub-tab's address is its word, read in any case, and an unknown word is no sub-tab", () => {
  for (const view of ticketRunViews)
    expect(ticketRunQueryOf({ view })).toEqual({ view });
  expect(ticketRunQueryOf({ view: "transcript" })).toEqual({
    view: "Transcript",
  });
  expect(ticketRunQueryOf({ view: "Raw" })).toEqual({});
  expect(ticketRunQueryOf({})).toEqual({});
});

test("a run page opens on Summary, a live run on Transcript, and an asked sub-tab only where it is offered", () => {
  const offered = ["Summary", "Transcript", "Details"] as const;
  expect(ticketRunViewShown(undefined, offered, false)).toBe("Summary");
  expect(ticketRunViewShown(undefined, offered, true)).toBe("Transcript");
  expect(ticketRunViewShown("Details", offered, true)).toBe("Details");
  expect(ticketRunViewShown("Output", offered, false)).toBe("Summary");
  expect(ticketRunViewShown("Output", [...offered, "Output"], false)).toBe(
    "Output",
  );
});

test("an image's digest is cut in the middle and its name kept whole", () => {
  const image = `ghcr.io/kasofsk/chuggy/worker@sha256:a727a589${"0".repeat(50)}c4f9e1`;
  expect(ticketRunImageLabel(image)).toEqual({
    text: "ghcr.io/kasofsk/chuggy/worker@sha256:a727a589…c4f9e1",
    title: image,
  });
  expect(ticketRunImageLabel("chuggy/worker:0.63").text).toBe(
    "chuggy/worker:0.63",
  );
});

test("a run's details say where it ran, how long it waited and what it spent, by kind", () => {
  const summary = ledgerExecution({
    execution: "execution-1c4680fa-9d2e-4c1b-8a7f-6",
    task: 6,
    identity: evalIdentity(2, 2, 1),
    outcome: "Passed",
    registeredAt: "2026-08-26T00:00:00Z",
    totals: { turns: 26, durationMs: 156_000, costUsdMicros: 920_000 },
  });
  const read: ExecutionResponse = {
    ...summary,
    startedAt: "2026-08-26T00:00:00.400Z",
    worker: { name: "chuggy-worker", version: "0.63" },
    resources: { cpuMillis: 2_000 },
    attempts: [],
  };
  expect(ticketRunDetailsOf(read)).toEqual({
    runner: "Linux · Amd64 · container",
    image: { text: "chuggy/worker", title: "chuggy/worker" },
    worker: "chuggy-worker 0.63",
    cpus: "2",
    waited: { kind: "Duration", text: "<1s" },
    attempts: 0,
    model: "claude-fable-5",
    turns: 26,
    apiTime: { kind: "Duration", text: "1m 18s" },
    tokens: "26k in · 26 out · 0 cache write · 0 cache read",
    execution: {
      text: "execution-1c…8a7f-6",
      title: "execution-1c4680fa-9d2e-4c1b-8a7f-6",
    },
  });
});

test("a report's opening is read as words, without the marks it was set in", () => {
  expect(runResultLinePlain("**APPROVE.** I read the `diff`.")).toBe(
    "APPROVE. I read the diff.",
  );
  expect(runResultLinePlain("## What I checked")).toBe("What I checked");
  expect(runResultLinePlain("- one item")).toBe("one item");
});

test("a pull request is named as its forge names it, and by its host otherwise", () => {
  expect(
    ticketLandingLinkLabel({
      href: "https://github.com/kasofsk/chuggy-common/pull/138",
      host: "github.com",
    }),
  ).toBe("kasofsk/chuggy-common#138");
  expect(
    ticketLandingLinkLabel({
      href: "https://forge.example.test/merge/7",
      host: "forge.example.test",
    }),
  ).toBe("forge.example.test");
});

function exchange(id: string, steps: number): ConversationExchange {
  return {
    id,
    work: Array.from({ length: steps }, (_, at) => ({
      step: "ToolCall" as const,
      id: `${id}-${String(at)}`,
      input: {},
    })),
    answer: "done",
    standing: { standing: "Answered" },
    before: [],
  };
}

test("a transcript cut to its first steps keeps every exchange's answer, and counts what it left out", () => {
  const cut = runTranscriptStepsCut([exchange("a", 2), exchange("b", 4)], 3);
  expect(cut.hidden).toBe(3);
  expect(cut.exchanges.map((each) => each.work.length)).toEqual([2, 1]);
  expect(cut.exchanges.map((each) => each.answer)).toEqual(["done", "done"]);
  const whole = runTranscriptStepsCut([exchange("a", 2)], 3);
  expect(whole.hidden).toBe(0);
});
