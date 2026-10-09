// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
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
import { settled, turned } from "./screenHarness.tsx";
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
  return drawn.container.querySelector(".ledger-row .ledger-reason");
}

/** Presses the row's expander named `name`, and answers what it opened. */
async function opened(drawn: RunPageDrawn, name: string): Promise<Element> {
  expect(artifactReads(drawn)).toEqual([]);
  await turned(() => {
    screen.getByRole("button", { name }).click();
  });
  await settled();
  const detail = drawn.container.querySelector(".ledger-detail");
  if (detail === null) throw new Error(`${name} opened nothing`);
  return detail;
}

const checkContent = runResultContent(
  JSON.stringify({ checks: runResultChecks }),
);

test("a failed review's row carries its report's opening, and its Report draws the whole", async () => {
  const drawn = await runPageDrawn(
    atlas,
    failedRun(runResultFailed(runResultReviewReport), "Agent"),
  );
  const line = rowLine(drawn);
  expect(Array.from(line?.textContent ?? "")).toHaveLength(runReasonCharsMax);
  expect(line?.getAttribute("title")).toBe(runResultReviewReport);
  expect(screen.queryByRole("button", { name: "Commands" })).toBeNull();
  const detail = await opened(drawn, "Report");
  expect(detail.textContent).toContain(runResultReviewReport);
  expect(artifactReads(drawn)).toEqual([]);
});

test("a result listing a work summary draws it as markdown in Report, read only once opened", async () => {
  const drawn = await runPageDrawn(
    atlas,
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
  const detail = await opened(drawn, "Report");
  expect(artifactReads(drawn)).toHaveLength(1);
  expect(detail.querySelectorAll("ul > li")).toHaveLength(2);
  expect(detail.querySelector("code")?.textContent).toBe("just check");
  expect(detail.textContent).not.toContain(runResultReviewReport);
});

test("a failed check's row carries its report's opening, and Commands lists every command with the failing one open", async () => {
  const drawn = await runPageDrawn(
    atlas,
    failedRun(
      runResultFailed(runResultCheckReport, [runResultCheckOutput]),
      "Commands",
      { artifactContent: checkContent },
    ),
  );
  expect(rowLine(drawn)?.textContent).toBe(
    Array.from(runResultCheckReport)
      .slice(0, runReasonCharsMax - 1)
      .join("") + "…",
  );
  expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  const detail = await opened(drawn, "Commands");
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
  const drawn = await runPageDrawn(
    atlas,
    failedRun(
      runResultFailed(runResultCheckReport, [runResultCheckOutput]),
      "Commands",
      {
        artifactContent: runResultContent(
          JSON.stringify({ checks: [first, { ...last, truncated: true }] }),
        ),
      },
    ),
  );
  const detail = await opened(drawn, "Commands");
  const failing = detail.querySelector('li[data-end="Failed"]');
  const texts = Array.from(failing?.querySelectorAll("p") ?? []).map(
    (paragraph) => paragraph.textContent,
  );
  expect(texts).toEqual(["End cut", runResultCheckReport]);
});

test("a check whose commands are not listed, are refused or do not parse gets Report and no command", async () => {
  const listed = runResultFailed(runResultCheckReport, [runResultCheckOutput]);
  const unlisted = await runPageDrawn(
    atlas,
    failedRun(runResultFailed(runResultCheckReport), "Commands"),
  );
  const drawnUnlisted = await opened(unlisted, "Report");
  expect(drawnUnlisted.textContent).toContain(runResultCheckReport);
  cleanup();
  for (const artifactContent of [
    undefined,
    runResultContent("check-comments ERROR"),
  ]) {
    const drawn = await runPageDrawn(
      atlas,
      failedRun(
        listed,
        "Commands",
        artifactContent === undefined ? {} : { artifactContent },
      ),
    );
    const detail = await opened(drawn, "Commands");
    expect(screen.queryByRole("button", { name: "Hide commands" })).toBeNull();
    expect(detail.querySelector("li[data-end]")).toBeNull();
    expect(detail.textContent).toContain(runResultCheckReport);
    await turned(() => {
      screen.getByRole("button", { name: "Hide report" }).click();
    });
    expect(screen.queryByRole("button", { name: "Commands" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report" })).not.toBeNull();
    cleanup();
  }
});

test("a row with no carrier is read as an agent's, whatever its result lists", async () => {
  await runPageDrawn(
    atlas,
    failedRun(
      runResultFailed(runResultCheckReport, [runResultCheckOutput]),
      undefined,
    ),
  );
  expect(screen.getByRole("button", { name: "Report" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Commands" })).toBeNull();
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
  const lines = drawn.container.querySelectorAll(".ledger-reason");
  expect(Array.from(lines, (line) => line.textContent)).toEqual([reason]);
});

test("a result with no report draws no line and no Report", async () => {
  const drawn = await runPageDrawn(
    atlas,
    failedRun(runResultFailed(undefined), "Agent"),
  );
  expect(rowLine(drawn)).toBeNull();
  expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  expect(screen.getByRole("button", { name: "Details" })).not.toBeNull();
});
