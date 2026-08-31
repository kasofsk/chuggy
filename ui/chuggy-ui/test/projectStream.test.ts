/**
 * The stream client, driven against a server made of strings.
 *
 * What is checked is the recovery the contract asks for — the replay id, the
 * refusals that end an attempt and the ones that do not, the backoff, and that
 * stopping really abandons the request rather than leaving it reading.
 */

import { expect, test } from "vitest";

import type { ProjectStreamEvent } from "../../../src/contract/events.ts";
import {
  openProjectStream,
  projectStreamCarrying,
  projectStreamDelayMs,
  projectStreamUnanswered,
  projectStreamUrl,
  streamOpenFailuresMax,
  streamReopenDelayMsMax,
  streamReopenDelayMsMin,
} from "../app/core/projectStream.ts";
import type { ProjectStreamStatus } from "../app/core/projectStream.ts";
import { frame, streamServer } from "./streamDouble.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };

function collector(): {
  readonly events: ProjectStreamEvent[];
  readonly statuses: ProjectStreamStatus[];
  readonly handlers: {
    onEvent: (event: ProjectStreamEvent) => void;
    onStatus: (status: ProjectStreamStatus) => void;
  };
} {
  const events: ProjectStreamEvent[] = [];
  const statuses: ProjectStreamStatus[] = [];
  return {
    events,
    statuses,
    handlers: {
      onEvent: (event) => events.push(event),
      onStatus: (status) => statuses.push(status),
    },
  };
}

test("the stream is opened at the partition's own events route", () => {
  expect(projectStreamUrl(partition)).toBe(
    "/api/v1/tenants/acme/projects/atlas/events",
  );
});

test("the first open carries the bearer and no replay id", async () => {
  const server = streamServer([
    { status: 200, chunks: [frame("ready", undefined, { version: 1 })] },
  ]);
  const opened = openProjectStream(
    server.ports,
    partition,
    collector().handlers,
  );
  await opened.finished;
  expect(server.headersSeen[0]?.["authorization"]).toBe("Bearer token");
  expect(server.headersSeen[0]?.["last-event-id"]).toBeUndefined();
});

test("a reopen replays from the last sequence the stream delivered", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("ready", undefined, { version: 1 }),
        frame("Ticket", "41", {
          version: 1,
          resource: "3",
          representation: {
            ticket: 3,
            phase: "Working",
            sequence: 9,
            ...ticketInstants,
          },
        }),
      ],
    },
    { status: 200, chunks: [] },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen[1]?.["last-event-id"]).toBe("41");
  expect(server.headersSeen[2]?.["last-event-id"]).toBe("41");
});

test("a reset reaches the handler and carries no sequence with it", async () => {
  const server = streamServer([
    { status: 200, chunks: [frame("reset", undefined, { version: 1 })] },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.events[0]).toEqual({ event: "reset", data: { version: 1 } });
  expect(server.headersSeen[1]?.["last-event-id"]).toBeUndefined();
});

test("a 503 at open marks the source degraded and tries again", async () => {
  const server = streamServer([{ status: 503 }, { status: 401 }]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.statuses.some((status) => status.source === "degraded")).toBe(
    true,
  );
  expect(server.headersSeen.length).toBe(2);
});

test("a source frame is what turns the state back to live", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("source", undefined, { version: 1, state: "live" })],
    },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.statuses.some((status) => status.source === "live")).toBe(true);
});

test("a 401 before any stream byte ends the attempt for good", async () => {
  const server = streamServer([{ status: 401 }]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen.length).toBe(1);
  expect(seen.statuses.at(-1)?.connection).toBe("Stopped");
});

test("opens that will not stay open are given up after the budget", async () => {
  const server = streamServer([]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen.length).toBe(streamOpenFailuresMax);
  expect(seen.statuses.at(-1)?.reason).toBe("the stream would not stay open");
});

/**
 * The handling a representation the wire rejects gets, now that the contract
 * parses it: the connection ends and the reopen budget bounds the retrying.
 */
test("a frame the contract rejects ends the connection rather than being skipped", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("Ticket", "9", {
          version: 1,
          resource: "3",
          representation: { ticket: "three" },
        }),
        frame("Ticket", "10", {
          version: 1,
          resource: "4",
          representation: {
            ticket: 4,
            phase: "Working",
            sequence: 1,
            ...ticketInstants,
          },
        }),
      ],
    },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.events).toEqual([]);
  expect(server.headersSeen.length).toBe(2);
  expect(server.headersSeen[1]?.["last-event-id"]).toBeUndefined();
});

test("the reopen delay doubles from the floor and stops at the ceiling", () => {
  expect(projectStreamDelayMs(1)).toBe(streamReopenDelayMsMin);
  expect(projectStreamDelayMs(2)).toBe(streamReopenDelayMsMin * 2);
  expect(projectStreamDelayMs(20)).toBe(streamReopenDelayMsMax);
});

test("stopping abandons the request that is reading rather than leaving it", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("ready", undefined, { version: 1 })],
      hold: true,
    },
  ]);
  const seen = collector();
  const opened = openProjectStream(server.ports, partition, seen.handlers);
  await server.holding;
  opened.stop();
  await opened.finished;
  expect(server.aborts.length).toBe(1);
  expect(server.headersSeen.length).toBe(1);
});

function statusAt(
  connection: ProjectStreamStatus["connection"],
  source: ProjectStreamStatus["source"],
  answered = true,
): ProjectStreamStatus {
  return {
    connection,
    source,
    answered,
    reason: undefined,
    lastSequence: undefined,
  };
}

test("only an open connection on a live log is carrying what a screen shows", () => {
  expect(projectStreamCarrying(statusAt("Open", "live"))).toBe(true);
  expect(projectStreamCarrying(statusAt("Open", "degraded"))).toBe(false);
  expect(projectStreamCarrying(statusAt("Opening", "unknown", false))).toBe(
    false,
  );
  expect(projectStreamCarrying(statusAt("Waiting", "live"))).toBe(false);
  expect(projectStreamCarrying(statusAt("Stopped", "live"))).toBe(false);
});

/**
 * The pair the shell's banner and the bounded fallback both read. Opening is
 * not carrying, so the fallback runs across a whole reopen ladder rather than
 * being restarted at each rung; and every rung but the first has been answered,
 * so a stale screen is drawn as one while a first paint is not.
 */
test("only a first open that nothing has answered is unanswered", () => {
  expect(projectStreamUnanswered(statusAt("Opening", "unknown", false))).toBe(
    true,
  );
  expect(projectStreamUnanswered(statusAt("Opening", "unknown"))).toBe(false);
  expect(projectStreamUnanswered(statusAt("Opening", "live"))).toBe(false);
  expect(projectStreamUnanswered(statusAt("Waiting", "unknown", false))).toBe(
    false,
  );
  expect(projectStreamUnanswered(statusAt("Open", "unknown", false))).toBe(
    false,
  );
});

/** The reopen the banner has to be able to tell from a first open: the run says
 * so itself, rather than the shell inferring it from an absent source. */
test("a reopen is answered even when no open has ever succeeded", async () => {
  const server = streamServer([
    { status: 500 },
    { status: 200, chunks: [], hold: true },
  ]);
  const seen = collector();
  const opened = openProjectStream(server.ports, partition, seen.handlers);
  await server.holding;
  opened.stop();
  await opened.finished;
  const opening = seen.statuses.filter(
    (status) => status.connection === "Opening",
  );
  expect(opening.map((status) => status.answered)).toEqual([false, true]);
});
