// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { runReasonCharsMax } from "../app/core/runReason.ts";
import {
  runAttempt,
  runPageDrawn,
  runSummary,
  runTotals,
} from "./runPageFixture.tsx";
import type { RunPageDrawn, RunPageServed } from "./runPageFixture.tsx";
import {
  runResultCheckOutput,
  runResultCheckReport,
  runResultChecks,
  runResultContent,
  runResultFailed,
  runResultGateLine,
  runResultReviewReport,
  runResultWorkSummary,
} from "./runResultFixture.ts";
import { settled } from "./screenHarness.tsx";
import { TicketRunPageAt } from "./ticketPageEveryTab.tsx";
import type { TicketRunView } from "../app/core/ticketRuns.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

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

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ticket = {
  ticket: 11,
  phase: "Pending",
  sequence: 7,
  runTotals: runTotals(9_990_000),
  ...ticketInstants,
};

/** One failed execution carried by `carrier`, its result as a case names. */
function failedRun(
  result: Record<string, unknown>,
  carrier: string | undefined,
  over: Partial<RunPageServed> = {},
): RunPageServed {
  const summary = runSummary({
    outcome: "Failed",
    ...(carrier === undefined ? {} : { carrier }),
  });
  return {
    ticket,
    executions: [summary],
    execution: { ...summary, attempts: [runAttempt("a1")], result },
    transcripts: [],
    ...over,
  };
}

function artifactReads(drawn: RunPageDrawn): readonly string[] {
  return drawn.reads.filter((url) => url.includes("/artifacts/"));
}

function rowLine(drawn: RunPageDrawn): Element | null {
  return drawn.container.querySelector(".ticket-runs-line");
}

/** The run's own page, at the sub-tab a case names, once it has read what it
 * reads. */
async function runPage(
  served: RunPageServed,
  view?: TicketRunView,
): Promise<RunPageDrawn> {
  const drawn = await runPageDrawn(
    atlas,
    served,
    <TicketRunPageAt task={1} {...(view === undefined ? {} : { view })} />,
  );
  await settled();
  return drawn;
}

/** The sub-tabs the run's page offers. */
function views(): readonly (string | null)[] {
  return within(screen.getByRole("navigation", { name: "Run" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

function body(drawn: RunPageDrawn): Element {
  const shown = drawn.container.querySelector(".ticket-run-body");
  if (shown === null) throw new Error("no run drawn");
  return shown;
}

const checkContent = runResultContent(
  JSON.stringify({ checks: runResultChecks }),
);

test("a failed review's row carries its report's opening, and its Summary draws the whole", async () => {
  const served = failedRun(runResultFailed(runResultReviewReport), "Agent");
  const listed = await runPageDrawn(atlas, served);
  expect(Array.from(rowLine(listed)?.textContent ?? "")).toHaveLength(
    runReasonCharsMax,
  );
  cleanup();
  const drawn = await runPage(served);
  expect(views()).toEqual(["Summary", "Transcript", "Details", "Context"]);
  expect(body(drawn).textContent).toContain(runResultReviewReport);
  expect(artifactReads(drawn)).toEqual([]);
});

test("a result listing a work summary draws it as markdown under Summary", async () => {
  const drawn = await runPage(
    failedRun(
      runResultFailed(runResultReviewReport, [runResultWorkSummary]),
      undefined,
      {
        artifactContent: runResultContent(
          "- kept the line\n- cut the rest\n\nRun `just check`.",
          "Markdown",
        ),
      },
    ),
  );
  const detail = body(drawn);
  expect(artifactReads(drawn)).toHaveLength(1);
  expect(detail.querySelectorAll("ul > li")).toHaveLength(2);
  expect(detail.querySelector("code")?.textContent).toBe("just check");
  expect(detail.textContent).not.toContain(runResultReviewReport);
});

test("a failed check's row carries its report's opening, and Output lists every command with the failing one open", async () => {
  const served = failedRun(
    runResultFailed(runResultCheckReport, [runResultCheckOutput]),
    "Commands",
    { artifactContent: checkContent },
  );
  const listed = await runPageDrawn(atlas, served);
  expect(rowLine(listed)?.textContent).toBe(
    Array.from(runResultCheckReport)
      .slice(0, runReasonCharsMax - 1)
      .join("") + "…",
  );
  expect(artifactReads(listed)).toEqual([]);
  cleanup();
  const summary = await runPage(served);
  expect(views()).toEqual(["Summary", "Transcript", "Details", "Output"]);
  expect(body(summary).textContent).toContain(runResultCheckReport);
  expect(artifactReads(summary)).toEqual([]);
  cleanup();
  const detail = body(await runPage(served, "Output"));
  const rows = Array.from(detail.querySelectorAll("li[data-end]"));
  expect(rows.map((row) => row.getAttribute("data-end"))).toEqual([
    "Passed",
    "Failed",
  ]);
  expect(rows.map((row) => row.querySelector("pre") !== null)).toEqual([
    false,
    true,
  ]);
  expect(rows[1]?.querySelector("pre.preview")?.textContent).toBe(
    `check-paths: clean\n${runResultGateLine}\n`,
  );
  expect(detail.textContent).not.toContain("End cut");
});

test("a check whose last command was cut says so and draws the report beneath it", async () => {
  const [first, last] = runResultChecks;
  const drawn = await runPage(
    failedRun(
      runResultFailed(runResultCheckReport, [runResultCheckOutput]),
      "Commands",
      {
        artifactContent: runResultContent(
          JSON.stringify({ checks: [first, { ...last, truncated: true }] }),
        ),
      },
    ),
    "Output",
  );
  const failing = body(drawn).querySelector('li[data-end="Failed"]');
  const texts = Array.from(failing?.querySelectorAll("p") ?? []).map(
    (paragraph) => paragraph.textContent,
  );
  expect(texts).toEqual(["End cut", runResultCheckReport]);
});

test("a check whose commands are not listed, are refused or do not parse offers no Output, and its Summary is its report", async () => {
  const listed = runResultFailed(runResultCheckReport, [runResultCheckOutput]);
  const unlisted = await runPage(
    failedRun(runResultFailed(runResultCheckReport), "Commands"),
    "Output",
  );
  expect(views()).not.toContain("Output");
  expect(body(unlisted).textContent).toContain(runResultCheckReport);
  cleanup();
  for (const artifactContent of [
    undefined,
    runResultContent("check-comments ERROR"),
  ]) {
    const drawn = await runPage(
      failedRun(
        listed,
        "Commands",
        artifactContent === undefined ? {} : { artifactContent },
      ),
      "Output",
    );
    expect(views()).not.toContain("Output");
    expect(body(drawn).querySelector("li[data-end]")).toBeNull();
    expect(body(drawn).textContent).toContain(runResultCheckReport);
    cleanup();
  }
});

test("a run with no carrier is read as an agent's, whatever its result lists", async () => {
  await runPage(
    failedRun(
      runResultFailed(runResultCheckReport, [runResultCheckOutput]),
      undefined,
    ),
  );
  expect(views()).not.toContain("Output");
});

test("a row whose worker left a reason draws that reason and no report line", async () => {
  const reason = "Worker exited before reporting: its container exited";
  const drawn = await runPageDrawn(atlas, {
    ...failedRun(runResultFailed(runResultCheckReport), "Agent"),
    execution: {
      ...runSummary({ outcome: "ProcessFailed" }),
      attempts: [
        runAttempt("a1", {
          state: "Lost",
          run: undefined,
          error: { bytes: 9 },
        }),
      ],
      result: runResultFailed(runResultCheckReport),
    },
    error: { read: "Content", content: reason },
  });
  expect(rowLine(drawn)?.textContent).toBe(reason);
  expect(drawn.container.textContent).not.toContain(runResultCheckReport);
});

test("a result with no report draws no line, and its Summary says it has none", async () => {
  const served = failedRun(runResultFailed(undefined), "Agent");
  const listed = await runPageDrawn(atlas, served);
  expect(rowLine(listed)?.textContent).toBe("");
  cleanup();
  const drawn = await runPage(served);
  expect(body(drawn).textContent).toBe("No summary");
});
