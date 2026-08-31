// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const digest = "a".repeat(64);

function totals(costUsdMicros: number): Record<string, unknown> {
  return {
    turns: 3,
    durationMs: 252_000,
    durationApiMs: 200_000,
    tokensInput: 10,
    tokensOutput: 20,
    tokensCacheCreation: 30,
    tokensCacheRead: 40,
    costUsdMicros,
    costBasis: "List",
    permissionDenials: 0,
    models: [],
  };
}

function summary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    execution: "e1",
    ticket: 11,
    task: 1,
    taskKind: "Work",
    stage: 1,
    cluster: "rig",
    configurationRevision: "r1",
    requirementIdentity: "req-1",
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "chuggy/worker",
    },
    requirementDigest: digest,
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Terminal",
    outcome: "Passed",
    retriesSpent: 1,
    registeredAt: "2026-08-27T00:00:00Z",
    runTotals: totals(150_000),
    ...over,
  };
}

function attempt(
  attemptId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    attempt: attemptId,
    number: 1,
    generation: 1,
    state: "Reported",
    openedAt: "2026-08-27T00:00:00Z",
    run: {
      startedAt: "2026-08-27T00:00:00Z",
      turnsRecorded: 3,
      totals: totals(100_000),
      transcript: {
        batches: 2,
        bytes: 40,
        highWaterBatch: 2,
        observedAt: "2026-08-27T00:00:10Z",
      },
    },
    ...over,
  };
}

function transcript(
  batches: readonly number[],
  complete: boolean,
): Record<string, unknown> {
  return {
    batches: batches.map((batch) => ({
      batch,
      recordedAt: "2026-08-27T00:00:10Z",
      bytes: 20,
      read: "Content",
      content: `{"type":"assistant","message":{"content":[{"type":"text","text":"batch ${String(batch)}"}]}}`,
    })),
    observedAt: "2026-08-27T00:00:10Z",
    complete,
  };
}

interface Rendered {
  readonly container: HTMLElement;
  readonly reads: readonly string[];
  readonly push: (chunk: string) => void;
}

async function ticketPage(served: {
  readonly ticket: Record<string, unknown>;
  readonly executions: readonly Record<string, unknown>[];
  readonly execution: Record<string, unknown>;
  readonly transcripts: readonly Record<string, unknown>[];
}): Promise<Rendered> {
  const reads: string[] = [];
  let batchPage = 0;
  const api = apiDouble({
    operation: { operation: "op-one", acceptedAt: "x", state: "Pending" },
    route: (url) => {
      reads.push(url);
      if (url.includes("/transcript")) {
        const page = served.transcripts[batchPage] ?? served.transcripts.at(-1);
        batchPage += 1;
        return answer(page);
      }
      if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
      if (url.includes("/native-actions")) return answer({ actions: [] });
      if (url.includes("/executions/")) return answer(served.execution);
      if (url.includes("/executions"))
        return answer({ executions: served.executions });
      if (url.includes("/drafts/")) return answer({}, 404);
      if (url.includes("/tickets/")) return answer(served.ticket);
      return answer({ partition: atlas, sequence: 8, tickets: [] });
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  const view = render(
    <ScreenHarness
      partition={atlas}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  await turned(() => {
    screen.getAllByRole("button", { name: "Details" })[0]?.click();
  });
  await settled();
  return { container: view.container, reads, push: server.push };
}

function transcriptReads(reads: readonly string[]): readonly string[] {
  return reads
    .filter((url) => url.includes("/transcript"))
    .map((url) => url.slice(url.indexOf("?")));
}

const ticket = {
  ticket: 11,
  phase: "Pending",
  sequence: 7,
  runTotals: totals(9_990_000),
  ...ticketInstants,
};

/** The high-water mark rides the frame the browser already receives; a pane
 * that re-read from the first batch would cost the transcript twice over. */
test("a rising high-water mark reads exactly the batches above what is held", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [summary()],
    execution: { ...summary(), attempts: [attempt("a1")] },
    transcripts: [transcript([1, 2], false), transcript([3, 4], false)],
  });
  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);

  await turned(() => {
    rendered.push(
      frame("Execution", "1", {
        version: 1,
        resource: "e1",
        representation: {
          ...summary(),
          attempts: [
            attempt("a1", {
              run: {
                startedAt: "2026-08-27T00:00:00Z",
                turnsRecorded: 3,
                totals: totals(100_000),
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
  expect(screen.getByText("batch 4")).toBeTruthy();
  expect(
    rendered.container.querySelector(".transcript .freshness")?.textContent,
  ).toMatch(/^as of /);
});

/** Complete is the attempt no longer being live, not the pane having caught up,
 * and a pane that kept reading a sealed run would read forever. */
test("a run whose attempt has ended draws complete and reads no further", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [summary()],
    execution: { ...summary(), attempts: [attempt("a1")] },
    transcripts: [transcript([1, 2], true)],
  });
  expect(transcriptReads(rendered.reads)).toEqual(["?after=0"]);
  expect(
    rendered.container.querySelector(".transcript .freshness")?.textContent,
  ).toBe("complete");

  await turned(() => {
    rendered.push(
      frame("Execution", "1", {
        version: 1,
        resource: "e1",
        representation: {
          ...summary(),
          attempts: [attempt("a1", { endedAt: "2026-08-27T00:01:00Z" })],
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
    executions: [summary()],
    execution: {
      ...summary(),
      attempts: [
        attempt("a1", {
          state: "Lost",
          number: 1,
          evidence: "LeaseExpired",
          endedAt: "2026-08-27T00:00:30Z",
        }),
        attempt("a2", { number: 2 }),
      ],
      result: {
        manifest: "m1",
        attempt: "a2",
        schemaVersion: 3,
        digest,
        verdict: "Pass",
        recordedAt: "2026-08-27T00:01:00Z",
        artifacts: [],
        report: "the work passed",
      },
    },
    transcripts: [transcript([1, 2], true)],
  });
  const lost = rendered.container.querySelector('.run[data-attempt="a1"]');
  expect(lost?.textContent).toContain("ended without a result: LeaseExpired");
  expect(lost?.textContent).not.toContain("Pass");
  const reported = rendered.container.querySelector('.run[data-attempt="a2"]');
  expect(reported?.textContent).toContain("the work passed");
});

/** #363: a worker below the schema that carries a summary reports none, and a
 * blank pane says nothing about why. */
test("a result older than the summary field draws the reason there is none", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [summary()],
    execution: {
      ...summary(),
      attempts: [attempt("a1")],
      result: {
        manifest: "m1",
        attempt: "a1",
        schemaVersion: 2,
        digest,
        verdict: "Pass",
        recordedAt: "2026-08-27T00:01:00Z",
        artifacts: [],
      },
    },
    transcripts: [transcript([1, 2], true)],
  });
  expect(
    rendered.container.querySelector('.run[data-attempt="a1"]')?.textContent,
  ).toContain("report schema too old");
});

/** The server's sum is over every attempt of every execution, including the
 * ones past the page this screen holds; a client sum would be quietly short. */
test("the ticket's total is the figure the ticket read answered with", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [summary(), summary({ execution: "e2" })],
    execution: { ...summary(), attempts: [attempt("a1")] },
    transcripts: [transcript([1, 2], true)],
  });
  expect(
    rendered.container.querySelector(".ticket-figures")?.textContent,
  ).toContain("$9.99");
  expect(
    rendered.container.querySelector(".ticket-usage")?.textContent,
  ).toContain("$0.30");
});

/** A report the worker wrote as markdown must draw as markdown, and the
 * newline between two lines of the same paragraph must survive as a line
 * break rather than being folded into a run-on sentence. */
test("a reported run draws its markdown and keeps its line breaks", async () => {
  const rendered = await ticketPage({
    ticket,
    executions: [summary()],
    execution: {
      ...summary(),
      attempts: [attempt("a1")],
      result: {
        manifest: "m1",
        attempt: "a1",
        schemaVersion: 3,
        digest,
        verdict: "Pass",
        recordedAt: "2026-08-27T00:01:00Z",
        artifacts: [],
        report: "**All good.**\nEvery check passed.",
      },
    },
    transcripts: [transcript([1, 2], true)],
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
    executions: [summary({ runTotals: undefined })],
    execution: {
      ...summary({ runTotals: undefined }),
      attempts: [attempt("a1", { run: undefined })],
    },
    transcripts: [],
  });
  expect(
    rendered.container.querySelector('.run[data-attempt="a1"]')?.textContent,
  ).toContain("recorded no run evidence");
  expect(
    rendered.container.querySelector(".ticket-figures")?.textContent,
  ).toContain("—");
  expect(transcriptReads(rendered.reads)).toEqual([]);
});
