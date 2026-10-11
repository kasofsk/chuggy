// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
  runAttempt,
  runEvidenceOf,
  runPageDrawn,
  runSummary,
} from "./runPageFixture.tsx";
import type { RunPageServed } from "./runPageFixture.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/**
 * One agent run on the ticket page from its registration to its worker's run.
 * An attempt opens, and a cluster places it, while the worker's image may still
 * be pulling, so each place the page names the set's status says so until the
 * run itself has started.
 */

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface LaunchStep {
  readonly route: string;
  readonly step: string;
  readonly status: string;
  readonly attempt?: string;
  readonly started: boolean;
  readonly word: string;
}

/** A pool claim leaves its execution Launching; a cluster's placement moves it to Running. */
const launchSteps: readonly LaunchStep[] = [
  {
    route: "pool",
    step: "queued",
    status: "Queued",
    started: false,
    word: "Starting",
  },
  {
    route: "pool",
    step: "claimed",
    status: "Launching",
    attempt: "Placing",
    started: false,
    word: "Starting",
  },
  {
    route: "pool",
    step: "started",
    status: "Launching",
    attempt: "Placing",
    started: true,
    word: "Running",
  },
  {
    route: "cluster",
    step: "admitted",
    status: "Admitted",
    started: false,
    word: "Starting",
  },
  {
    route: "cluster",
    step: "placed",
    status: "Running",
    attempt: "Running",
    started: false,
    word: "Starting",
  },
  {
    route: "cluster",
    step: "started",
    status: "Running",
    attempt: "Running",
    started: true,
    word: "Running",
  },
];

const openedAt = "2026-08-27T00:00:05Z";
const runStartedAt = "2026-08-27T00:03:00Z";

function launchServed(step: LaunchStep): RunPageServed {
  const summary = runSummary({
    status: step.status,
    outcome: undefined,
    runTotals: undefined,
    carrier: "Agent",
    ...(step.attempt === undefined ? {} : { startedAt: openedAt }),
    ...(step.started ? { runStartedAt } : {}),
  });
  const run = runEvidenceOf(0, {
    startedAt: runStartedAt,
    turnsRecorded: 0,
    totals: undefined,
    transcript: undefined,
  });
  return {
    ticket: {
      ticket: 11,
      phase: "Work",
      sequence: 7,
      program: [],
      ...ticketInstants,
    },
    executions: [summary],
    execution: {
      ...summary,
      attempts:
        step.attempt === undefined
          ? []
          : [
              runAttempt("a1", {
                state: step.attempt,
                openedAt,
                run: step.started ? run : undefined,
              }),
            ],
    },
    transcripts: [],
  };
}

test.each(launchSteps)(
  "a $route run $step reads $word in its row, its cycle, its count and the Now card",
  async (step) => {
    const drawn = await runPageDrawn(atlas, launchServed(step));
    const bar = drawn.container.querySelector(".ticket-status");
    expect(bar?.textContent).toContain(`1 · 1 ${step.word.toLowerCase()} ·`);
    const row = drawn.container.querySelector(".ledger-row");
    expect(row?.querySelector(".ledger-pill")?.textContent).toBe(step.word);
    expect(
      drawn.container.querySelector(".ledger-group-summary")?.textContent,
    ).toBe(`Work ${step.word.toLowerCase()}`);
    const now = screen.getByRole("region", { name: "Now" });
    expect(now.querySelector(".ticket-now-line")?.textContent).toBe(step.word);
  },
);
