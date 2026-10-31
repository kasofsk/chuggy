/**
 * The bounded fallback as the provider starts it, on the one state the shell's
 * banner also has to answer for.
 *
 * A connection that is opening is not carrying, so the fallback reads past it —
 * which is what keeps a reopening console from sitting still through every rung
 * of its backoff ladder, since each rung passes back through `Opening` and a
 * condition that excluded it aborted the loop before its first sleep was up.
 * `sleepMs` is instant here and the grace with it, so the interval is not
 * what is being checked; whether the loop ran at all is, and its own budget is
 * what says so — and the waits asked for, which say whether it backed off.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  fallbackIntervalMs,
  fallbackIntervalMsMax,
} from "../app/core/projectFallback.ts";
import { projectResourceKey } from "../app/core/projectQueryKeys.ts";
import {
  streamGraceMs,
  useProjectFallbackExhausted,
} from "../app/browser/stream.tsx";
import { openedStream, ScreenHarness, settled } from "./screenHarness.tsx";
import type { StreamTransport } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";

const waits = vi.hoisted(() => ({ asked: [] as number[] }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: (ms: number) => {
    waits.asked.push(ms);
    return Promise.resolve();
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  waits.asked.length = 0;
});

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };
const held = projectResourceKey(atlas, "Ticket", "3");

/** Whether the loop has spent its whole budget, which under an instant sleep is
 * how a loop that ran is told from one that never started. */
function Spent(): ReactNode {
  return <p>{useProjectFallbackExhausted() ? "spent" : "unspent"}</p>;
}

/** An entry under the partition, so a partition-wide refetch is visible as a
 * state rather than as traffic. */
async function heldEntryAfter(
  transport: StreamTransport,
  children: ReactNode = null,
): Promise<QueryClient> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(held, {
    ticket: 3,
    phase: "Work",
    sequence: 9,
    ...ticketInstants,
  });
  render(
    <ScreenHarness partition={atlas} client={client} transport={transport}>
      <Spent />
      {children}
    </ScreenHarness>,
  );
  await settled();
  return client;
}

test("a connection that has not opened yet is read past by the fallback", async () => {
  const client = await heldEntryAfter(() => new Promise(() => undefined));
  expect(client.getQueryState(held)?.isInvalidated).toBe(true);
  expect(screen.getByText("spent")).toBeDefined();
});

test("a stream that has opened spends none of the fallback's budget", async () => {
  await heldEntryAfter(openedStream().ports.fetch);
  expect(screen.getByText("unspent")).toBeDefined();
});

/** A read the fallback reaches, which fails every time it is asked. */
function Failing(): ReactNode {
  useQuery({
    queryKey: projectResourceKey(atlas, "Ticket", "4"),
    queryFn: () => Promise.reject(new Error("the API answered 500")),
  });
  return null;
}

test("a fallback whose reads all fail waits longer between them, up to its ceiling", async () => {
  await heldEntryAfter(() => new Promise(() => undefined), <Failing />);
  const polled = waits.asked.filter((ms) => ms >= fallbackIntervalMs);
  expect(polled.slice(0, 4)).toEqual([
    streamGraceMs,
    fallbackIntervalMs,
    fallbackIntervalMs * 2,
    fallbackIntervalMs * 4,
  ]);
  expect(Math.max(...polled)).toBe(fallbackIntervalMsMax);
});
