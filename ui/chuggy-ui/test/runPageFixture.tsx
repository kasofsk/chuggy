/**
 * The ticket page over one execution and its run: the rows the ledger reads,
 * the execution its details read, the pages of its transcript and the
 * configuration snapshot its prompt is read from.
 *
 * Shared by the suites about a run's evidence, its conversation and the Now
 * card, because each draws the same page and differs only in what the run
 * recorded.
 */

import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { TicketPage } from "../app/browser/TicketPage.tsx";
import {
  answer,
  apiDouble,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";

export const runDigest = "a".repeat(64);

export function runTotals(costUsdMicros: number): Record<string, unknown> {
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

export function runSummary(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    execution: "e1",
    ticket: 11,
    task: 1,
    taskKind: "Work",
    identity: { type: "WorkTask", value: { ticket: 11, cycle: 1 } },
    cluster: "rig",
    configurationRevision: "r1",
    requirementIdentity: "req-1",
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "chuggy/worker",
    },
    requirementDigest: runDigest,
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Terminal",
    outcome: "Passed",
    retriesSpent: 1,
    registeredAt: "2026-08-27T00:00:00Z",
    runTotals: runTotals(150_000),
    ...over,
  };
}

/** A run's evidence, its transcript as high as a case names. */
export function runEvidenceOf(
  highWaterBatch: number,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    startedAt: "2026-08-27T00:00:00Z",
    turnsRecorded: 3,
    totals: runTotals(100_000),
    transcript: {
      batches: highWaterBatch,
      bytes: 20 * highWaterBatch,
      highWaterBatch,
      observedAt: "2026-08-27T00:00:10Z",
    },
    ...over,
  };
}

/** Where the run's snapshot is kept, which is what makes its prompt readable. */
export const runConfigurationRef = {
  digest: runDigest,
  bytes: 400,
  recordedAt: "2026-08-27T00:00:01Z",
};

export function runAttempt(
  attemptId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    attempt: attemptId,
    number: 1,
    generation: 1,
    state: "Reported",
    openedAt: "2026-08-27T00:00:00Z",
    run: runEvidenceOf(2),
    ...over,
  };
}

/** One assistant line saying what a case wants it to. */
export function assistantLine(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

/** A page of batches, each holding what `content` writes for it. */
export function runTranscriptPage(
  batches: readonly number[],
  complete: boolean,
  content: (batch: number) => string = (batch) =>
    assistantLine(`batch ${String(batch)}`),
): Record<string, unknown> {
  return {
    batches: batches.map((batch) => ({
      batch,
      recordedAt: "2026-08-27T00:00:10Z",
      bytes: 20,
      read: "Content",
      content: content(batch),
    })),
    observedAt: "2026-08-27T00:00:10Z",
    complete,
  };
}

/** The snapshot a Claude run wrote, handed the prompt a case names. */
export function runSnapshot(
  prompt: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const content = JSON.stringify({
    argv: ["claude", "--print", "--output-format", "stream-json", prompt],
    agent: "Claude",
    claudeVersion: "2.1.247",
    init: { type: "system", subtype: "init", model: "opus" },
    files: [],
    dropped: [],
    ...over,
  });
  return { read: "Content", digest: runDigest, bytes: 400, content };
}

export interface RunPageServed {
  readonly ticket: Record<string, unknown>;
  readonly executions: readonly Record<string, unknown>[];
  readonly execution: Record<string, unknown>;
  readonly transcripts: readonly Record<string, unknown>[];
  /** The run's snapshot, and a `404` where a case keeps none. */
  readonly configuration?: Record<string, unknown>;
}

export interface RunPageDrawn {
  readonly container: HTMLElement;
  readonly reads: readonly string[];
  readonly push: (chunk: string) => void;
}

function runPageRoute(
  partition: PartitionIdentity,
  served: RunPageServed,
): (url: string) => Response {
  let transcriptPage = 0;
  return (url) => {
    if (url.includes("/transcript")) {
      const page =
        served.transcripts[transcriptPage] ?? served.transcripts.at(-1);
      transcriptPage += 1;
      return answer(page);
    }
    if (url.includes("/configuration"))
      return served.configuration === undefined
        ? answer({}, 404)
        : answer(served.configuration);
    if (url.includes("/dispatch-view")) return answer({ result: "Reset" });
    if (url.includes("/native-actions")) return answer({ actions: [] });
    if (url.includes("/executions/")) return answer(served.execution);
    if (url.includes("/executions"))
      return answer({ executions: served.executions });
    if (url.includes("/drafts/")) return answer({}, 404);
    if (url.includes("/tickets/")) return answer(served.ticket);
    return answer({ partition, sequence: 8, tickets: [] });
  };
}

export async function runPageDrawn(
  partition: PartitionIdentity,
  served: RunPageServed,
): Promise<RunPageDrawn> {
  const reads: string[] = [];
  const route = runPageRoute(partition, served);
  const api = apiDouble({
    operation: { operation: "op-one", acceptedAt: "x", state: "Pending" },
    route: (url) => {
      reads.push(url);
      return route(url);
    },
  });
  vi.stubGlobal("fetch", api.fetch);
  const server = openedStream();
  const view = render(
    <ScreenHarness
      partition={partition}
      client={new QueryClient()}
      transport={server.ports.fetch}
    >
      <TicketPage />
    </ScreenHarness>,
  );
  await settled();
  return { container: view.container, reads, push: server.push };
}

/** The query each transcript read asked with, in the order it asked. */
export function transcriptReads(reads: readonly string[]): readonly string[] {
  return reads
    .filter((url) => url.includes("/transcript"))
    .map((url) => url.slice(url.indexOf("?")));
}

export function configurationReads(reads: readonly string[]): number {
  return reads.filter((url) => url.includes("/configuration")).length;
}
