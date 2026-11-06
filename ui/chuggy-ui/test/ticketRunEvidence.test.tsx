// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import {
  runAttempt,
  runDigest,
  runPageDrawn,
  runSummary,
  runTotals,
  runTranscriptPage,
  transcriptReads,
  runSettledLost,
} from "./runPageFixture.tsx";
import type { RunPageDrawn, RunPageServed } from "./runPageFixture.tsx";
import { settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import { TicketRunPageAt } from "./ticketPageEveryTab.tsx";
import type { TicketRunView } from "../app/core/ticketRuns.ts";

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

/**
 * One run's own page and the Runs tab that lists it: its transcript, read as
 * the run writes it, what it said of itself under Summary, and its one line
 * on its row.
 */

/** The run's own page, on the sub-tab a case names. */
function runPage(
  served: RunPageServed,
  view?: TicketRunView,
): Promise<RunPageDrawn> {
  return runPageDrawn(
    atlas,
    served,
    <TicketRunPageAt task={1} {...(view === undefined ? {} : { view })} />,
  );
}

/** The run's own page under Summary, what it says of itself. */
function summaryOf(drawn: RunPageDrawn): string {
  return drawn.container.querySelector(".ticket-run-body")?.textContent ?? "";
}

/** The run's one line on its row of the Runs tab. */
function rowLine(drawn: RunPageDrawn): Element | null {
  return drawn.container.querySelector(".ticket-runs-line");
}

const ticket = {
  ticket: 11,
  phase: "Pending",
  sequence: 7,
  runTotals: runTotals(9_990_000),
  ...ticketInstants,
};

/** A settled result naming the attempt a case reported under. */
function resultOf(
  attempt: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    manifest: "m1",
    attempt,
    schemaVersion: 3,
    digest: runDigest,
    verdict: "Pass",
    recordedAt: "2026-08-27T00:01:00Z",
    artifacts: [],
    ...over,
  };
}

/** The high-water mark rides the read a frame has the run's execution read
 * again by; a pane that re-read from the first batch would cost the transcript
 * twice over. */
test("a rising high-water mark reads exactly the batches above what is held", async () => {
  let attempt = runAttempt("a1");
  const rendered = await runPage(
    {
      ticket,
      executions: [runSummary()],
      execution: () => ({ ...runSummary(), attempts: [attempt] }),
      transcripts: [
        runTranscriptPage([1, 2], false),
        runTranscriptPage([3, 4], false),
      ],
    },
    "Transcript",
  );
  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);

  attempt = runAttempt("a1", {
    run: {
      startedAt: "2026-08-27T00:00:00Z",
      turnsRecorded: 3,
      totals: runTotals(100_000),
      transcript: {
        batches: 4,
        bytes: 80,
        highWaterBatch: 4,
        observedAt: "2026-08-27T00:00:20Z",
      },
    },
  });
  await turned(() => {
    rendered.push(
      frame("Execution", "1", {
        version: 1,
        resource: "e1",
        representation: runSummary(),
      }),
    );
  });
  await settled();

  expect(transcriptReads(rendered.reads)).toEqual(["?after=0", "?after=2"]);
  expect(
    screen.getByRole("group", { name: "Transcript" }).textContent,
  ).toContain("batch 4");
});

/** Complete is the attempt no longer being live, not the pane having caught up,
 * and a pane that kept reading a sealed run would read forever. */
test("a run whose attempt has ended reads no further", async () => {
  let attempt = runAttempt("a1");
  const rendered = await runPage(
    {
      ticket,
      executions: [runSummary()],
      execution: () => ({ ...runSummary(), attempts: [attempt] }),
      transcripts: [runTranscriptPage([1, 2], true)],
    },
    "Transcript",
  );
  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);

  attempt = runAttempt("a1", { endedAt: "2026-08-27T00:01:00Z" });
  await turned(() => {
    rendered.push(
      frame("Execution", "1", {
        version: 1,
        resource: "e1",
        representation: runSummary(),
      }),
    );
  });
  await settled();

  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);
});

test("a run's transcript says how many turns it took, and offers what it wrote as it was read", async () => {
  const rendered = await runPage(
    {
      ticket,
      executions: [runSummary()],
      execution: { ...runSummary(), attempts: [runAttempt("a1")] },
      transcripts: [runTranscriptPage([1, 2], true)],
    },
    "Transcript",
  );
  const body = rendered.container.querySelector(".ticket-run-body");
  expect(body?.textContent).toContain("3 turns");
  await turned(() => {
    screen.getByRole("button", { name: "Raw JSON" }).click();
  });
  expect(body?.querySelector("pre")?.textContent).toBe(
    [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"batch 1"}]}}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"batch 2"}]}}',
    ].join("\n"),
  );
});

/** The result belongs to the attempt it names, so the run's summary is that
 * result's report whatever attempt was lost before it. */
test("a run relaunched after a loss draws the report its result recorded", async () => {
  const rendered = await runPage({
    ticket,
    executions: [runSummary()],
    execution: {
      ...runSummary(),
      attempts: [
        runAttempt("a1", {
          state: "Lost",
          number: 1,
          evidence: "LeaseExpired",
          endedAt: "2026-08-27T00:00:30Z",
        }),
        runAttempt("a2", { number: 2 }),
      ],
      result: resultOf("a2", { report: "the work passed" }),
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  expect(summaryOf(rendered)).toBe("the work passed");
});

/** #363: a worker below the schema that carries a summary reports none, and a
 * blank pane says nothing about why. */
test("a result with no report says the run has no summary", async () => {
  const rendered = await runPage({
    ticket,
    executions: [runSummary()],
    execution: {
      ...runSummary(),
      attempts: [runAttempt("a1")],
      result: resultOf("a1", { schemaVersion: 2 }),
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  expect(summaryOf(rendered)).toBe("No summary");
});

/** The server's sum is over every attempt of every execution, including the
 * ones past the page this screen holds; a client sum would be quietly short. */
test("the ticket's total is the figure the ticket read answered with", async () => {
  const rendered = await runPageDrawn(atlas, {
    ticket,
    executions: [runSummary(), runSummary({ execution: "e2", task: 2 })],
    execution: { ...runSummary(), attempts: [runAttempt("a1")] },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  expect(
    rendered.container.querySelector(".ticket-status")?.textContent,
  ).toContain("$9.99");
  expect(
    screen.getByRole("table", { name: "Usage by stage" }).textContent,
  ).toContain("$0.30");
});

/** A report the worker wrote as markdown must draw as markdown, and the
 * newline between two lines of the same paragraph must survive as a line
 * break rather than being folded into a run-on sentence. */
test("a reported run draws its markdown under Summary and keeps its line breaks", async () => {
  const rendered = await runPage({
    ticket,
    executions: [runSummary()],
    execution: {
      ...runSummary(),
      attempts: [runAttempt("a1")],
      result: resultOf("a1", { report: "**All good.**\nEvery check passed." }),
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  const report = rendered.container.querySelector(
    ".ticket-run-body .run-report",
  );
  expect(report?.querySelector("strong")?.textContent).toBe("All good.");
  expect(report?.querySelector("br")).toBeTruthy();
  expect(report?.textContent).toBe("All good.Every check passed.");
});

/** An old worker wrote no evidence, and the page it leaves is a stated absence
 * rather than a blank one. */
test("a run from a worker that wrote no evidence says so", async () => {
  const rendered = await runPage(
    {
      ticket: { ticket: 11, phase: "Pending", sequence: 7, ...ticketInstants },
      executions: [runSummary({ runTotals: undefined })],
      execution: {
        ...runSummary({ runTotals: undefined }),
        attempts: [runAttempt("a1", { run: undefined })],
      },
      transcripts: [],
    },
    "Transcript",
  );
  expect(summaryOf(rendered)).toBe("No transcript");
  expect(transcriptReads(rendered.reads)).toEqual([]);
});

/** What a runner uploads for the container it saw killed, as the worker core
 * writes it. */
const killed =
  "Worker exited before reporting: its container exited with status 137";

/** A run lost before it reported and settled as a failure naming it, as the
 * fabric settles a pool's lost attempt, its worker's text served where it
 * left any. */
function lostRun(content: string | undefined): RunPageServed {
  const summary = runSummary({ outcome: "ProcessFailed" });
  const left = content === undefined ? {} : { error: { bytes: 70 } };
  return {
    ticket,
    executions: [summary],
    execution: {
      ...summary,
      result: runSettledLost("a1"),
      attempts: [
        runAttempt("a1", {
          state: "Lost",
          evidence: "RunFailed",
          run: undefined,
          ...left,
        }),
      ],
    },
    transcripts: [],
    ...(content === undefined
      ? {}
      : { error: { read: "Content", content: `${content}\n` } }),
  };
}

function errorReads(reads: readonly string[]): readonly string[] {
  return reads.filter((url) => url.endsWith("/error"));
}

test("a run whose worker said why it ended shows the reason on its row", async () => {
  const rendered = await runPageDrawn(atlas, lostRun(killed));
  expect(rowLine(rendered)?.textContent).toBe(killed);
  expect(errorReads(rendered.reads)).toHaveLength(1);
});

/** The fabric's own words are the result's report, so a run that left none
 * draws those, and the worker's text is never asked for. */
test("a run whose worker left no reason shows the settled result's line, and asks for none", async () => {
  const rendered = await runPageDrawn(atlas, lostRun(undefined));
  expect(rowLine(rendered)?.textContent).toBe(
    "The attempt a pool claimed ended before it reported a result.",
  );
  expect(errorReads(rendered.reads)).toEqual([]);
});

/** The text is the worker's, so a reason is drawn as what it says. */
test("a reason that reads as markup is drawn as text", async () => {
  const written = '<img src="x" onerror="alert(1)"><b>killed</b>';
  const rendered = await runPageDrawn(atlas, lostRun(written));
  const line = rowLine(rendered);
  expect(line?.textContent).toBe(written);
  expect(line?.querySelector("img, b")).toBeNull();
});

/** A runner's placement failure, whose engine's own words start past the cut. */
const pullFailed =
  "Worker could not start: the runner could not pull ghcr.io/kasofsk/chuggy-worker:0.31.0 for this run. " +
  "The container engine answered: Error response from daemon: manifest for ghcr.io/kasofsk/chuggy-worker:0.31.0 not found: manifest unknown";

/** A phone cannot hover, so the run's own page is where a long reason is read. */
test("a reason longer than a row's line is drawn whole on the run's page", async () => {
  const listed = await runPageDrawn(atlas, lostRun(pullFailed));
  expect(rowLine(listed)?.textContent).not.toContain("manifest unknown");
  cleanup();
  const rendered = await runPage({
    ...lostRun(pullFailed),
    execution: {
      ...runSummary({ outcome: "ProcessFailed" }),
      attempts: [
        runAttempt("a1", {
          state: "Lost",
          evidence: "RunFailed",
          run: undefined,
          error: { bytes: 70 },
        }),
      ],
    },
  });
  expect(summaryOf(rendered)).toBe(pullFailed);
});

/** What a runner says of an assignment larger than its machine, as the worker core refuses one. */
const tooLarge =
  "the assignment asks for 8000 CPU millis and this machine has 4000";

/** A run released with a size and refused by the one pool that claimed it, which blocks it unrun. */
const refusedRun: RunPageServed = (() => {
  const summary = runSummary({
    outcome: "Blocked",
    resources: { cpuMillis: 8_000, memoryMib: 16_384 },
    runTotals: undefined,
  });
  return {
    ticket,
    executions: [summary],
    execution: {
      ...summary,
      attempts: [
        runAttempt("a1", {
          state: "Withdrawn",
          evidence: "PlacementRefused",
          run: undefined,
          refusal: tooLarge,
        }),
      ],
    },
    transcripts: [],
  };
})();

test("a run no runner could size says the runner's refusal on its row and its page, asking for no worker's text", async () => {
  const listed = await runPageDrawn(atlas, refusedRun);
  expect(rowLine(listed)?.textContent).toBe(tooLarge);
  cleanup();
  const rendered = await runPage(refusedRun);
  expect(summaryOf(rendered)).toBe(tooLarge);
  expect(errorReads([...listed.reads, ...rendered.reads])).toEqual([]);
});

/** What a runner says of an image it cannot run in, which it leaves as the
 * worker's text and refuses with as well. */
const imageFault = "Worker could not start: the image has no git on its PATH";

/** A run refused for its image, its worker's text and its refusal the same words. */
const imageRefusedRun: RunPageServed = (() => {
  const summary = runSummary({ outcome: "Blocked", runTotals: undefined });
  return {
    ticket,
    executions: [summary],
    execution: {
      ...summary,
      attempts: [
        runAttempt("a1", {
          state: "Withdrawn",
          evidence: "PlacementRefused",
          run: undefined,
          error: { bytes: 57 },
          refusal: imageFault,
        }),
      ],
    },
    transcripts: [],
    error: { read: "Content", content: `${imageFault}\n` },
  };
})();

test("a run refused in its worker's own words draws them once on its page", async () => {
  const rendered = await runPage(imageRefusedRun);
  expect(summaryOf(rendered).split(imageFault)).toHaveLength(2);
});

function styleRules(list: CSSRuleList): readonly CSSStyleRule[] {
  return Array.from(list).flatMap((rule) =>
    rule instanceof CSSStyleRule
      ? [rule]
      : rule instanceof CSSGroupingRule
        ? styleRules(rule.cssRules)
        : [],
  );
}

/** Every value the ticket page's sheet, at any width, gives one element for one property. */
function ticketDeclared(element: Element, property: string): readonly string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(ticketSheet);
  return styleRules(sheet.cssRules).flatMap((rule) => {
    const value = rule.style.getPropertyValue(property);
    return value !== "" && element.matches(rule.selectorText) ? [value] : [];
  });
}

/** The row is a glance and the run's page is where the whole is read, so a
 * line is clipped rather than wrapped at every width. */
test("a row's line is held to one line and clipped", async () => {
  const rendered = await runPageDrawn(atlas, lostRun(killed));
  const line = rowLine(rendered);
  if (line === null) throw new Error("no row line drawn");
  expect(ticketDeclared(line, "white-space")).toEqual(["nowrap"]);
  expect(ticketDeclared(line, "text-overflow")).toEqual(["ellipsis"]);
  expect(ticketDeclared(line, "overflow")).toEqual(["hidden"]);
});
