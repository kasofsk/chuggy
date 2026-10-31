/**
 * A resource read its caller marks `Streamed`, kept rather than read again on a
 * visit while the partition's stream holds its position, because the frames
 * that name its key have kept it — and read as every other is the moment the
 * stream holds none.
 *
 * The table is `projectStreamedResources`, and the cases on it are what stop a
 * key no frame names from being kept: each kind it admits is one whose frame
 * lands on exactly the key a read of that resource is held at, and a part, a
 * view and a list are refused under every kind.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { projectChangeKinds } from "../../../src/contract/events.ts";
import type {
  ProjectChangeKind,
  ProjectStreamEvent,
} from "../../../src/contract/events.ts";
import { usePanelResource } from "../app/browser/api.ts";
import type { PanelResourceKept } from "../app/browser/api.ts";
import { applyResourceArrival } from "../app/browser/stream.tsx";
import { apiTicket } from "../app/core/apiRoutes.ts";
import { projectCacheCommands } from "../app/core/projectCacheCommands.ts";
import {
  projectListMarker,
  projectResourceKey,
  projectStreamedNamed,
  projectStreamedResources,
} from "../app/core/projectQueryKeys.ts";
import { projectStreamHolding } from "../app/core/projectStream.ts";
import type { ProjectStreamConnection } from "../app/core/projectStream.ts";
import { streamReopenDelayMsMin } from "../app/core/streamConnection.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import {
  answer,
  openedStream,
  queryClientUnretried,
  ScreenHarness,
  visitHeld,
  scriptedFetch,
  settled,
  turned,
} from "./screenHarness.tsx";
import type { Visit } from "./screenHarness.tsx";
import { frame, streamServer } from "./streamDouble.ts";
import type { StreamServer } from "./streamDouble.ts";
import { ticketInstants } from "./ticketInstants.ts";

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
const ticketKey = projectResourceKey(atlas, "Ticket", "3");
const ticketRead = { ticket: 3, phase: "Work", sequence: 9, ...ticketInstants };

/** One sample resource of each kind, as that kind's frame names it. */
const sampleResources: Readonly<Record<ProjectChangeKind, string>> = {
  Operation: "op-one",
  Ticket: "3",
  Draft: "3",
  Configuration: "r2",
  Project: "atlas",
  Execution: "ex-one",
  NativeAction: "3",
  AgenticRefusal: "3",
  Session: "session-one",
};

test("every kind the table admits is one whose frame lands on the key its read is held at", () => {
  for (const kind of projectChangeKinds) {
    const resource = sampleResources[kind];
    if (!projectStreamedNamed(kind, resource)) continue;
    const event = {
      event: kind,
      sequence: 1,
      data: { version: 1, resource, representation: null },
    } as unknown as ProjectStreamEvent;
    const keys = projectCacheCommands(atlas, event).flatMap((command) =>
      "key" in command ? [command.key] : [],
    );
    expect(keys, kind).toEqual([projectResourceKey(atlas, kind, resource)]);
  }
});

test("the table admits the ticket, draft, configuration, operation and execution kinds and no other", () => {
  expect(Object.keys(projectStreamedResources).sort()).toEqual([
    "Configuration",
    "Draft",
    "Execution",
    "Operation",
    "Ticket",
  ]);
  for (const kind of projectChangeKinds)
    expect(projectStreamedNamed(kind, sampleResources[kind]), kind).toBe(
      kind in projectStreamedResources,
    );
});

test("a part, a view and a list are refused under every kind the table admits", () => {
  for (const kind of Object.keys(
    projectStreamedResources,
  ) as ProjectChangeKind[]) {
    const resource = sampleResources[kind];
    for (const refused of [
      `${resource}/artifacts/1`,
      `${resource}/attempts/1/configuration`,
      `view=${resource}`,
      projectListMarker,
      "",
    ])
      expect(projectStreamedNamed(kind, refused), `${kind} ${refused}`).toBe(
        false,
      );
  }
  expect(projectStreamedNamed("Ticket", "ex-one")).toBe(false);
});

test("a stream holds its position only while open and answered", () => {
  const connections: readonly ProjectStreamConnection[] = [
    "Opening",
    "Open",
    "Waiting",
    "Stopped",
  ];
  for (const connection of connections)
    for (const answered of [false, true])
      expect(
        projectStreamHolding({
          connection,
          source: "live",
          cause: undefined,
          answered,
        }),
        `${connection} ${String(answered)}`,
      ).toBe(connection === "Open" && answered);
});

function TicketProbe(props: { readonly kept: PanelResourceKept }): ReactNode {
  const state = usePanelResource(
    atlas,
    "Ticket",
    "3",
    (ports) => apiTicket(ports, atlas, 3),
    undefined,
    props.kept,
  );
  return <p>{state.state === "Ready" ? state.value.phase : state.state}</p>;
}

interface ProbeDrawn {
  readonly client: QueryClient;
  readonly server: StreamServer;
  readonly reads: () => number;
  readonly visit: Visit;
}

async function probeDrawn(
  kept: PanelResourceKept,
  server: StreamServer = openedStream(),
): Promise<ProbeDrawn> {
  const scripted = scriptedFetch(() => answer(ticketRead));
  vi.stubGlobal("fetch", scripted.fetch);
  const client = queryClientUnretried();
  const visit = visitHeld();
  render(
    <ScreenHarness
      partition={atlas}
      client={client}
      transport={server.ports.fetch}
    >
      <visit.Visited>
        <TicketProbe kept={kept} />
      </visit.Visited>
    </ScreenHarness>,
  );
  await settled();
  return {
    client,
    server,
    visit,
    reads: () =>
      scripted.sent.filter((sent) => sent.url.endsWith("/tickets/3")).length,
  };
}

test("a streamed read returned to while the stream holds its position is drawn from the cache with no read", async () => {
  const drawn = await probeDrawn("Streamed");
  expect(drawn.reads()).toBe(1);
  await drawn.visit.visited(false);
  await drawn.visit.visited(true);
  expect(drawn.reads()).toBe(1);
  expect(screen.getByText("Work")).toBeDefined();
});

test("a frame arriving while the read is left is drawn on return with no read", async () => {
  const drawn = await probeDrawn("Streamed");
  await drawn.visit.visited(false);
  await turned(() => {
    drawn.server.push(
      frame("Ticket", "5", {
        version: 1,
        resource: "3",
        representation: { ...ticketRead, phase: "Evaluation", sequence: 10 },
      }),
    );
  });
  await settled();
  await drawn.visit.visited(true);
  expect(drawn.reads()).toBe(1);
  expect(screen.getByText("Evaluation")).toBeDefined();
});

test("a streamed read returned to while the stream is not open reads again", async () => {
  const drawn = await probeDrawn("Streamed", streamServer([{ status: 401 }]));
  expect(drawn.reads()).toBe(1);
  await drawn.visit.visited(false);
  await drawn.visit.visited(true);
  expect(drawn.reads()).toBe(2);
});

test("a read not marked streamed reads again on every return though the stream holds its position", async () => {
  const drawn = await probeDrawn("Read");
  await drawn.visit.visited(false);
  await drawn.visit.visited(true);
  await drawn.visit.visited(false);
  await drawn.visit.visited(true);
  expect(drawn.reads()).toBe(3);
});

test("an invalidation reads a streamed read the stream is keeping", async () => {
  const drawn = await probeDrawn("Streamed");
  await act(async () => {
    await drawn.client.invalidateQueries({ queryKey: ticketKey });
  });
  await settled();
  expect(drawn.reads()).toBe(2);
});

test("a screen's own confirmation is drawn over a streamed read with no read", async () => {
  const drawn = await probeDrawn("Streamed");
  await turned(() => {
    applyResourceArrival(drawn.client, ticketKey, {
      arrival: "Write",
      representation: { ...ticketRead, phase: "Done", sequence: 11 },
    });
  });
  await settled();
  expect(screen.getByText("Done")).toBeDefined();
  expect(drawn.reads()).toBe(1);
});

function PartProbe(): ReactNode {
  const state = usePanelResource(
    atlas,
    "Execution",
    "ex-one/artifacts/1",
    () => Promise.resolve({ outcome: "Absent" as const }),
    undefined,
    "Streamed",
  );
  return <p>{state.state}</p>;
}

test("a part marked streamed is refused when it is read", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const server = openedStream();
  expect(() =>
    render(
      <ScreenHarness
        partition={atlas}
        client={queryClientUnretried()}
        transport={server.ports.fetch}
      >
        <PartProbe />
      </ScreenHarness>,
    ),
  ).toThrow("no frame names it");
});
