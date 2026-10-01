// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import ledgerSheet from "../app/browser/ui/Ledger.css?raw";
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
// jscpd:ignore-end

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The page with the first row's details open, which is where the run's
 * evidence is drawn. */
async function ticketPage(served: RunPageServed): Promise<RunPageDrawn> {
  const drawn = await runPageDrawn(atlas, served);
  await turned(() => {
    screen.getAllByRole("button", { name: "Details" })[0]?.click();
  });
  await settled();
  return drawn;
}

const ticket = {
  ticket: 11,
  phase: "Pending",
  sequence: 7,
  runTotals: runTotals(9_990_000),
  ...ticketInstants,
};

/** The high-water mark rides the frame the browser already receives; a pane
 * that re-read from the first batch would cost the transcript twice over. */
test("a rising high-water mark reads exactly the batches above what is held", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [runSummary()],
    execution: { ...runSummary(), attempts: [runAttempt("a1")] },
    transcripts: [
      runTranscriptPage([1, 2], false),
      runTranscriptPage([3, 4], false),
    ],
  });
  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);

  await turned(() => {
    rendered.push(
      frame("Execution", "1", {
        version: 1,
        resource: "e1",
        representation: {
          ...runSummary(),
          attempts: [
            runAttempt("a1", {
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
            }),
          ],
        },
      }),
    );
  });
  await settled();

  expect(transcriptReads(rendered.reads)).toEqual(["?after=0", "?after=2"]);
  const transcriptPane = screen.getByRole("region", { name: "transcript" });
  expect(transcriptPane.textContent).toContain("batch 4");
  expect(transcriptPane.classList.contains("rounded-3")).toBe(true);
  expect(transcriptPane.querySelector(".freshness")?.textContent).toMatch(
    /^as of /,
  );
});

/** Complete is the attempt no longer being live, not the pane having caught up,
 * and a pane that kept reading a sealed run would read forever. */
test("a run whose attempt has ended draws complete and reads no further", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [runSummary()],
    execution: { ...runSummary(), attempts: [runAttempt("a1")] },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);
  expect(
    screen
      .getByRole("region", { name: "transcript" })
      .querySelector(".freshness")?.textContent,
  ).toBe("complete");

  await turned(() => {
    rendered.push(
      frame("Execution", "1", {
        version: 1,
        resource: "e1",
        representation: {
          ...runSummary(),
          attempts: [runAttempt("a1", { endedAt: "2026-08-27T00:01:00Z" })],
        },
      }),
    );
  });
  await settled();

  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);
});

/** The result belongs to the attempt it names, so a lost run must never be
 * drawn under another run's verdict. */
test("a lost run says it ended without a result and draws no verdict", async () => {
  const rendered = await ticketPage({
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
      result: {
        manifest: "m1",
        attempt: "a2",
        schemaVersion: 3,
        digest: runDigest,
        verdict: "Pass",
        recordedAt: "2026-08-27T00:01:00Z",
        artifacts: [],
        report: "the work passed",
      },
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  const lost = rendered.container.querySelector('[data-attempt="a1"]');
  expect(lost?.textContent).toContain("ended without a result: LeaseExpired");
  expect(lost?.textContent).not.toContain("Pass");
  const reported = rendered.container.querySelector('[data-attempt="a2"]');
  expect(reported?.textContent).toContain("the work passed");
});

/** #363: a worker below the schema that carries a summary reports none, and a
 * blank pane says nothing about why. */
test("a result older than the summary field draws the reason there is none", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [runSummary()],
    execution: {
      ...runSummary(),
      attempts: [runAttempt("a1")],
      result: {
        manifest: "m1",
        attempt: "a1",
        schemaVersion: 2,
        digest: runDigest,
        verdict: "Pass",
        recordedAt: "2026-08-27T00:01:00Z",
        artifacts: [],
      },
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  expect(
    rendered.container.querySelector('[data-attempt="a1"]')?.textContent,
  ).toContain("report schema too old");
});

/** The server's sum is over every attempt of every execution, including the
 * ones past the page this screen holds; a client sum would be quietly short. */
test("the ticket's total is the figure the ticket read answered with", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [runSummary(), runSummary({ execution: "e2" })],
    execution: { ...runSummary(), attempts: [runAttempt("a1")] },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  expect(
    rendered.container.querySelector(".ticket-status")?.textContent,
  ).toContain("$9.99");
  const usage = screen.getByRole("button", { name: /^Usage/u });
  await turned(() => {
    usage.click();
  });
  expect(rendered.container.querySelector("#usage")?.textContent).toContain(
    "$0.30",
  );
});

/** A report the worker wrote as markdown must draw as markdown, and the
 * newline between two lines of the same paragraph must survive as a line
 * break rather than being folded into a run-on sentence. */
test("a reported run draws its markdown and keeps its line breaks", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [runSummary()],
    execution: {
      ...runSummary(),
      attempts: [runAttempt("a1")],
      result: {
        manifest: "m1",
        attempt: "a1",
        schemaVersion: 3,
        digest: runDigest,
        verdict: "Pass",
        recordedAt: "2026-08-27T00:01:00Z",
        artifacts: [],
        report: "**All good.**\nEvery check passed.",
      },
    },
    transcripts: [runTranscriptPage([1, 2], true)],
  });
  const report = rendered.container.querySelector(".run-report");
  expect(report?.querySelector("strong")?.textContent).toBe("All good.");
  expect(report?.querySelector("br")).toBeTruthy();
  expect(report?.textContent).toBe("All good.Every check passed.");
});

/** An old worker wrote no evidence, and the pane it leaves is a stated absence
 * rather than a blank one. */
test("a run from a worker that wrote no evidence says so", async () => {
  const rendered = await ticketPage({
    ticket: { ticket: 11, phase: "Pending", sequence: 7, ...ticketInstants },
    executions: [runSummary({ runTotals: undefined })],
    execution: {
      ...runSummary({ runTotals: undefined }),
      attempts: [runAttempt("a1", { run: undefined })],
    },
    transcripts: [],
  });
  expect(
    rendered.container.querySelector('[data-attempt="a1"]')?.textContent,
  ).toContain("recorded no run evidence");
  expect(
    rendered.container.querySelector(".ticket-status")?.textContent,
  ).toContain("—");
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
  const reason = rendered.container.querySelector(".ledger-row .ledger-reason");
  expect(reason?.textContent).toBe(killed);
  expect(reason?.getAttribute("title")).toBe(killed);
  expect(errorReads(rendered.reads)).toHaveLength(1);
});

test("a run whose worker left no reason shows none, and asks for none", async () => {
  const rendered = await runPageDrawn(atlas, lostRun(undefined));
  expect(rendered.container.querySelector(".ledger-reason")).toBeNull();
  expect(errorReads(rendered.reads)).toEqual([]);
});

/** The text is the worker's, so a reason is drawn as what it says. */
test("a reason that reads as markup is drawn as text", async () => {
  const written = '<img src="x" onerror="alert(1)"><b>killed</b>';
  const rendered = await runPageDrawn(atlas, lostRun(written));
  const reason = rendered.container.querySelector(".ledger-reason");
  expect(reason?.textContent).toBe(written);
  expect(reason?.querySelector("img, b")).toBeNull();
});

/** A runner's placement failure, whose engine's own words start past the cut. */
const pullFailed =
  "Worker could not start: the runner could not pull ghcr.io/kasofsk/chuggy-worker:0.31.0 for this run. " +
  "The container engine answered: Error response from daemon: manifest for ghcr.io/kasofsk/chuggy-worker:0.31.0 not found: manifest unknown";

/** A phone cannot hover, so the details are where a long reason is read. */
test("a reason longer than a row's line is drawn whole in the run's details", async () => {
  const rendered = await ticketPage(lostRun(pullFailed));
  const line = rendered.container.querySelector(".ledger-row .ledger-reason");
  expect(line?.textContent).not.toContain("manifest unknown");
  expect(
    rendered.container.querySelector('[data-attempt="a1"]')?.textContent,
  ).toContain(pullFailed);
});

test("the attempts table scrolls itself rather than widening the run's details", async () => {
  const rendered = await ticketPage(lostRun(pullFailed));
  const table = rendered.container.querySelector("table.attempts");
  expect(table).not.toBeNull();
  expect(table?.parentElement?.classList).toContain("overflow-x-auto");
  expect(table?.parentElement?.classList).toContain("max-w-full");
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

/** Every value the ledger's sheet, at any width, gives one element for one property. */
function ledgerDeclared(element: Element, property: string): readonly string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(ledgerSheet);
  return styleRules(sheet.cssRules).flatMap((rule) => {
    const value = rule.style.getPropertyValue(property);
    return value !== "" && element.matches(rule.selectorText) ? [value] : [];
  });
}

/**
 * Whether the line then breaks before a phone's edge is a browser's to say,
 * and no suite here runs one; what this holds is that the ledger's sheet asks
 * for no single line, on the reason or anything it inherits from.
 */
test("nothing in the ledger's sheet holds a row's reason to one line", async () => {
  const rendered = await runPageDrawn(atlas, lostRun(killed));
  const reason = rendered.container.querySelector(".ledger-row .ledger-reason");
  expect(reason).not.toBeNull();
  for (let at = reason; at !== null; at = at.parentElement) {
    for (const value of ledgerDeclared(at, "white-space"))
      expect(["normal", "pre-wrap", "pre-line", "break-spaces"]).toContain(
        value,
      );
    for (const property of ["text-wrap", "text-wrap-mode"])
      expect(ledgerDeclared(at, property)).not.toContain("nowrap");
  }
  if (reason === null) return;
  for (const property of ["text-overflow", "line-clamp", "-webkit-line-clamp"])
    expect(ledgerDeclared(reason, property), property).toEqual([]);
  expect(ledgerDeclared(reason, "overflow-wrap")).toContain("anywhere");
});
