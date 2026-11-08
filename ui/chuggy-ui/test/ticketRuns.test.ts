/**
 * A ticket's runs as the Runs tab, a run's page and the landing's read them:
 * each step named as the plan names it, what a cycle came to, how long a run
 * ran, and the address of each run and each of its sub-tabs.
 */

import { expect, test } from "vitest";

import type { ExecutionResponse } from "../../../src/contract/responses.ts";
import { runTimeLineOf } from "../app/core/figures.ts";
import { runResultLinePlain } from "../app/core/runResult.ts";
import { runTimeOf } from "../app/core/runTotals.ts";
import type { RunTimed } from "../app/core/runTotals.ts";
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
  ticketRunLandingMarked,
  ticketRunImageLabel,
  ticketRunQueryOf,
  ticketRunsFind,
  ticketRunsLandingCycle,
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
import { copyTextEn } from "../app/copy/catalog.ts";

const named = { names: ["checks", "review"], lands: true };

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
  lands = true,
): readonly TicketRunsCycle[] {
  const ledger = ticketLedger(ledgerPage(shapes), program);
  return ticketRunsOf(
    ledger,
    ticketLandingsJoined(
      landings,
      ledger.cycles.map((cycle) => cycle.ordinal),
    ),
    { names: named.names, lands },
    copyTextEn,
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
          : `Landing ${row.lands ? (row.landing?.word ?? "Not reached") : "None"}`,
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
    ticketLandingOf(landingLanded(1), copyTextEn),
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
    [ticketLandingOf(landingConflicted(1), copyTextEn)],
  );
  expect(conflicted[0]?.outcome).toBe("Landing failed");
});

test("a ticket that lands nothing has a Landing row that waits on none", () => {
  const rows = runsOf(twoCycles, [], ticket21Program, false)[0]?.rows ?? [];
  expect(rows.at(-1)).toEqual({
    kind: "Landing",
    name: "Landing",
    landing: undefined,
    lands: false,
  });
});

test("a landing draws the merge mark only while it merged or is under way, and its failure otherwise", () => {
  expect(
    ticketRunLandingMarked(ticketLandingOf(landingLanded(1), copyTextEn)),
  ).toEqual({
    mark: "Merge",
    tone: "finalization",
  });
  expect(
    ticketRunLandingMarked(ticketLandingOf(landingConflicted(1), copyTextEn)),
  ).toEqual({ mark: "Cross", tone: "fail" });
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
      runsOf(twoCycles, [ticketLandingOf(landingConflicted(1), copyTextEn)]),
    ),
  ).toBe(1);
  expect(ticketRunsLandingCycle(runsOf(twoCycles))).toBe(2);
  expect(ticketRunsLandingCycle([])).toBeUndefined();
});

/** The line a set of runs is drawn with, read against a clock. */
function lineOf(runs: readonly RunTimed[], nowMs: number) {
  return runTimeLineOf(runTimeOf(runs, nowMs));
}

test("a run's line is its time from when it was taken to its end, with its wait beside it", () => {
  const run = ledgerExecution({
    execution: "e-1",
    task: 1,
    identity: workIdentity(1),
    outcome: "Passed",
    registeredAt: "2026-11-07T10:00:00Z",
    takenAt: "2026-11-07T10:23:00Z",
    terminalAt: "2026-11-07T10:25:00Z",
  });
  expect(lineOf([run], Date.parse("2026-11-07T12:00:00Z"))).toEqual({
    line: "Ran",
    ran: { kind: "Duration", text: "2m" },
    waited: { kind: "Duration", text: "23m" },
  });
});

test("a wait shorter than a minute is not drawn beside a run's time", () => {
  const run = ledgerExecution({
    execution: "e-1",
    task: 1,
    identity: workIdentity(1),
    outcome: "Passed",
    registeredAt: "2026-11-07T10:00:00Z",
    takenAt: "2026-11-07T10:00:59Z",
    terminalAt: "2026-11-07T10:08:59Z",
  });
  expect(lineOf([run], Date.parse("2026-11-07T12:00:00Z"))).toEqual({
    line: "Ran",
    ran: { kind: "Duration", text: "8m" },
    waited: undefined,
  });
});

test("a command run that measured no duration still reads the seconds it took", () => {
  const command = ledgerExecution({
    execution: "e-2",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Passed",
    carrier: "Commands",
    totals: { turns: 0, durationMs: 0, costUsdMicros: 0 },
    takenAt: "2026-08-26T00:20:00Z",
    terminalAt: "2026-08-26T00:20:07Z",
  });
  expect(command.runTotals?.durationMs).toBe(0);
  expect(lineOf([command], 0)).toMatchObject({
    line: "Ran",
    ran: { kind: "Duration", text: "7s" },
  });
});

test("a run nothing has taken reads as waiting, its wait growing with now", () => {
  for (const status of ["Queued", "Admitted", "Launching"] as const) {
    const run = ledgerExecution({
      execution: "e-1",
      task: 1,
      identity: workIdentity(1),
      status,
      untaken: true,
      registeredAt: "2026-11-07T10:00:00Z",
    });
    expect(run.takenAt, status).toBeUndefined();
    expect(lineOf([run], Date.parse("2026-11-07T10:05:00Z")), status).toEqual({
      line: "Waiting",
      waited: { kind: "Duration", text: "5m" },
    });
    expect(lineOf([run], Date.parse("2026-11-07T10:07:00Z")), status).toEqual({
      line: "Waiting",
      waited: { kind: "Duration", text: "7m" },
    });
  }
});

test("a cycle's line sums its runs' times and does not draw the gap between them", () => {
  const cycles = runsOf([
    {
      execution: "e-1",
      task: 1,
      identity: workIdentity(1),
      outcome: "Passed",
      registeredAt: "2026-11-07T10:00:00Z",
      terminalAt: "2026-11-07T10:04:00Z",
    },
    {
      execution: "e-2",
      task: 2,
      identity: evalIdentity(1, 1, 1),
      outcome: "Passed",
      registeredAt: "2026-11-07T10:14:00Z",
      terminalAt: "2026-11-07T10:17:00Z",
    },
  ]);
  const cycle = cycles[0];
  expect(cycle?.executions.map((each) => each.execution)).toEqual([
    "e-1",
    "e-2",
  ]);
  expect(
    lineOf(cycle?.executions ?? [], Date.parse("2026-11-07T12:00:00Z")),
  ).toEqual({
    line: "Ran",
    ran: { kind: "Duration", text: "7m" },
    waited: undefined,
  });
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

test("an address names the call its transcript opens at, and an empty or unwritten one names none", () => {
  expect(ticketRunQueryOf({ view: "Transcript", step: "toolu_1" })).toEqual({
    view: "Transcript",
    step: "toolu_1",
  });
  expect(ticketRunQueryOf({ step: "toolu_1" })).toEqual({ step: "toolu_1" });
  expect(ticketRunQueryOf({ step: "" })).toEqual({});
  expect(ticketRunQueryOf({ step: 7 })).toEqual({});
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
    takenAt: "2026-08-26T00:23:30Z",
    totals: { turns: 26, durationMs: 156_000, costUsdMicros: 920_000 },
  });
  const read: ExecutionResponse = {
    ...summary,
    startedAt: "2026-08-26T00:00:00.400Z",
    worker: { name: "chuggy-worker", version: "0.63" },
    resources: { cpuMillis: 2_000 },
    attempts: [],
  };
  expect(
    ticketRunDetailsOf(read, Date.parse("2026-08-26T01:00:00Z"), copyTextEn),
  ).toEqual({
    runner: "Linux · Amd64 · container",
    image: { text: "chuggy/worker", title: "chuggy/worker" },
    worker: "chuggy-worker 0.63",
    cpus: "2",
    waited: { kind: "Duration", text: "23m 30s" },
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
