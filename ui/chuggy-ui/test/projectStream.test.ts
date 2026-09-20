/**
 * The stream client, driven against a server made of strings.
 *
 * What is checked is the recovery the contract asks for — the replay id, the
 * reset that says a cursor was not replayable, the refusals that end an attempt
 * and the ones that do not, the backoff, and that stopping really abandons the
 * request rather than leaving it reading.
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

const partition = { tenant: "acme", project: "atlas" };
const ticketFrame = (id: string): string =>
  frame("Ticket", id, {
    version: 1,
    resource: "3",
    representation: { ticket: 3, state: "Working" },
  });

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
  await openProjectStream(server.ports, partition, collector().handlers)
    .finished;
  expect(server.headersSeen[0]?.["authorization"]).toBe("Bearer token");
  expect(server.headersSeen[0]?.["last-event-id"]).toBeUndefined();
});

test("a reopen replays from the last sequence the stream delivered", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("ready", undefined, { version: 1 }), ticketFrame("41")],
    },
    { status: 200, chunks: [] },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen[1]?.["last-event-id"]).toBe("41");
  expect(server.headersSeen[2]?.["last-event-id"]).toBe("41");
  expect(seen.statuses.at(-1)?.resume).toBe("Replayed");
});

/**
 * A reset is the server's answer to a cursor it will not replay, so keeping
 * that cursor would be asking the same unanswerable question at every rung of
 * the ladder.
 */
test("a reset drops the cursor so the next open is a first open again", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [ticketFrame("41"), frame("reset", undefined, { version: 1 })],
    },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen[1]?.["last-event-id"]).toBeUndefined();
  expect(seen.events.at(-1)).toEqual({ event: "reset", data: { version: 1 } });
});

/** Which of the two a resumed open was given, after the frame that said so has
 * gone by. */
test("a resumed open says whether it was replayed or reset", async () => {
  const server = streamServer([
    { status: 200, chunks: [ticketFrame("41")] },
    { status: 200, chunks: [frame("reset", undefined, { version: 1 })] },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  const resumes = seen.statuses.map((status) => status.resume);
  expect(resumes.indexOf("Replayed")).toBeGreaterThanOrEqual(0);
  expect(resumes.indexOf("Reset")).toBeGreaterThan(resumes.indexOf("Replayed"));
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

/** The envelope is what the contract pins, and a frame that breaks it ends the
 * connection rather than being skipped. */
test("a frame whose envelope the contract rejects ends the connection", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("Ticket", "9", { version: 2, resource: "3", representation: {} }),
        ticketFrame("10"),
      ],
    },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.events).toEqual([]);
  expect(server.headersSeen[1]?.["last-event-id"]).toBeUndefined();
});

/** The body inside the envelope is the route's own and no schema here judges
 * it, which is what lets a stream outlive a route whose shape moved. */
test("a representation no route schema would accept is carried rather than refused", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [
        frame("Ticket", "9", {
          version: 1,
          resource: "3",
          representation: { ticket: "three" },
        }),
      ],
    },
    { status: 401 },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.events.length).toBe(1);
  expect(server.headersSeen[1]?.["last-event-id"]).toBe("9");
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
  const opened = openProjectStream(
    server.ports,
    partition,
    collector().handlers,
  );
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
    resume: "Fresh",
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
  const server = streamServer([{ status: 401 }]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers, true)
    .finished;
  expect(seen.statuses[0]?.answered).toBe(true);
});
