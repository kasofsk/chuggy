/**
 * An `Execution` frame carries the executions list's row, which is less than
 * the execution's own read holds under its key. So the frame folds into the
 * lists and has that key read again, and the read happens only where a screen
 * has the execution mounted: a console looking at nothing to do with a run
 * reads none of its attempts or result.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import type { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { usePanelResource } from "../app/browser/api.ts";
import { useTicketExecutions } from "../app/browser/ticket/TicketLedger.tsx";
import { apiExecution } from "../app/core/apiRoutes.ts";
import { projectResourceKey } from "../app/core/projectQueryKeys.ts";
import { streamReopenDelayMsMin } from "../app/core/streamConnection.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { runAttempt, runSummary } from "./runPageFixture.tsx";
import {
  answer,
  openedStream,
  queryClientUnretried,
  ScreenHarness,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import { frame } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: (ms: number, signal?: AbortSignal) => {
    if (ms === streamReopenDelayMsMin) return Promise.resolve();
    return new Promise<void>((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("abandoned"));
        },
        { once: true },
      );
    });
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const executionKey = projectResourceKey(atlas, "Execution", "e1");

function ExecutionProbe(): ReactNode {
  const state = usePanelResource(
    atlas,
    "Execution",
    "e1",
    (ports) => apiExecution(ports, atlas, "e1"),
    undefined,
    "Streamed",
  );
  return (
    <p>
      {state.state === "Ready"
        ? `${state.value.status} ${String(state.value.attempts.length)}`
        : state.state}
    </p>
  );
}

function ListProbe(): ReactNode {
  const state = useTicketExecutions(atlas, 11);
  return (
    <ul>
      {state.state === "Ready"
        ? state.value.executions.map((row) => (
            <li key={row.execution}>{`${row.execution} ${row.status}`}</li>
          ))
        : state.state}
    </ul>
  );
}

interface FrameDrawn {
  readonly client: QueryClient;
  readonly server: StreamServer;
  readonly reads: (path: string) => number;
}

/** What is mounted, over an execution read that answers as `served` says now. */
async function frameDrawn(
  mounted: ReactNode,
  served: () => Record<string, unknown>,
  client: QueryClient = queryClientUnretried(),
): Promise<FrameDrawn> {
  const scripted = scriptedFetch((request) =>
    request.url.includes("/executions/e1")
      ? answer(served())
      : answer({ executions: [runSummary({ status: "Running" })] }),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const server = openedStream();
  render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={server.ports.fetch}
    >
      {mounted}
    </ScreenHarness>,
  );
  await settled();
  return {
    client,
    server,
    reads: (path) =>
      scripted.sent.filter((sent) => sent.url.split("?")[0]?.endsWith(path))
        .length,
  };
}

async function executionFramePushed(drawn: FrameDrawn): Promise<void> {
  await turned(() => {
    drawn.server.push(
      frame("Execution", "5", {
        version: 1,
        resource: "e1",
        representation: runSummary(),
      }),
    );
  });
  await settled();
}

test("a frame for an execution whose key is mounted reads it again, once", async () => {
  let served: Record<string, unknown> = {
    ...runSummary({ status: "Running" }),
    attempts: [],
  };
  const drawn = await frameDrawn(<ExecutionProbe />, () => served);
  expect(drawn.reads("/executions/e1")).toBe(1);
  expect(screen.getByText("Running 0")).toBeDefined();
  served = { ...runSummary(), attempts: [runAttempt("a1")] };
  await executionFramePushed(drawn);
  expect(drawn.reads("/executions/e1")).toBe(2);
  expect(screen.getByText("Terminal 1")).toBeDefined();
});

test("a frame for an execution nothing has mounted reads nothing and leaves its key stale", async () => {
  const held = { ...runSummary({ status: "Running" }), attempts: [] };
  const client = queryClientUnretried();
  client.setQueryData(executionKey, held);
  const drawn = await frameDrawn(null, () => held, client);
  await executionFramePushed(drawn);
  expect(drawn.reads("/executions/e1")).toBe(0);
  expect(client.getQueryState(executionKey)?.isInvalidated).toBe(true);
  expect(client.getQueryData(executionKey)).toEqual(held);
});

test("a frame's row is still folded into the list it belongs to", async () => {
  const drawn = await frameDrawn(<ListProbe />, () => ({}));
  expect(screen.getByText("e1 Running")).toBeDefined();
  await executionFramePushed(drawn);
  expect(screen.getByText("e1 Terminal")).toBeDefined();
  expect(drawn.reads("/executions")).toBe(1);
  expect(drawn.reads("/executions/e1")).toBe(0);
});
