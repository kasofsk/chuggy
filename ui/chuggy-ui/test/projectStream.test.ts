/**
 * The stream client, driven against a server made of strings.
 *
 * What is checked is the recovery the contract asks for — the replay id, the
 * refusals that end an attempt and the ones that do not, the backoff, and that
 * stopping really abandons the request rather than leaving it reading.
 *
 * The double's project route answers 401 once its script runs out, so every
 * case that does not stop the stream itself ends there.
 */

import { expect, test } from "vitest";

import type { ProjectStreamEvent } from "../../../src/contract/events.ts";
import {
  openProjectStream,
  projectStreamCarrying,
  projectStreamHeldInitial,
  projectStreamNotice,
  projectStreamSilenceMs,
  projectStreamUnanswered,
  projectStreamUrl,
} from "../app/core/projectStream.ts";
import type { ProjectStreamStatus } from "../app/core/projectStream.ts";
import {
  streamDelayMs,
  streamOpenFailuresMax,
  streamReopenDelayMsMax,
  streamReopenDelayMsMin,
} from "../app/core/streamConnection.ts";
import { frame, streamServer } from "./streamDouble.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };

function collector(): {
  readonly events: ProjectStreamEvent[];
  readonly statuses: ProjectStreamStatus[];
  readonly skipped: number[];
  readonly handlers: {
    onEvent: (event: ProjectStreamEvent) => void;
    onStatus: (status: ProjectStreamStatus) => void;
    onSkipped: () => void;
  };
} {
  const events: ProjectStreamEvent[] = [];
  const statuses: ProjectStreamStatus[] = [];
  const skipped: number[] = [];
  return {
    events,
    statuses,
    skipped,
    handlers: {
      onEvent: (event) => events.push(event),
      onStatus: (status) => statuses.push(status),
      onSkipped: () => skipped.push(1),
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
            phase: "Work",
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

test("opens that will not stay open are asked again at the ceiling past the budget, and only a 401 stops them", async () => {
  const failing = streamOpenFailuresMax + 2;
  const server = streamServer(
    Array.from({ length: failing }, () => ({ status: 500 })),
  );
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen.length).toBe(failing + 1);
  expect(server.delaysMs).toEqual(
    Array.from({ length: failing }, (_unused, at) =>
      at + 1 < streamOpenFailuresMax
        ? streamDelayMs(at + 1)
        : streamReopenDelayMsMax,
    ),
  );
  expect(
    seen.statuses.filter((status) => status.connection === "Stopped"),
  ).toEqual([
    {
      connection: "Stopped",
      source: "unknown",
      cause: "Refused",
      answered: true,
    },
  ]);
});

/** The server ends every open at an age of its own, so an open that handed a
 * frame over and ended soon is a stream that worked. */
test("opens that hand frames over and end soon keep being asked, and never stop the stream", async () => {
  const delivering = {
    status: 200,
    chunks: [frame("source", undefined, { version: 1, state: "live" })],
  };
  const closes = streamOpenFailuresMax;
  const server = streamServer(Array.from({ length: closes }, () => delivering));
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen.length).toBe(closes + 1);
  expect(server.delaysMs).toEqual(
    Array.from({ length: closes }, (_unused, at) => streamDelayMs(at + 1)),
  );
  expect(
    seen.statuses.filter((status) => status.connection === "Stopped").length,
  ).toBe(1);
  expect(seen.statuses.at(-1)?.cause).toBe("Refused");
});

test("a 404 at open is an open that failed, and is asked again", async () => {
  const server = streamServer([{ status: 404 }, { status: 404 }]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.headersSeen.length).toBe(3);
  expect(seen.statuses.at(-1)?.cause).toBe("Refused");
});

test("a 503 naming a wait is waited for what it names, and reads degraded", async () => {
  const server = streamServer([{ status: 503, retryAfter: "7" }]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.delaysMs).toEqual([7_000]);
  expect(seen.statuses).toContainEqual({
    connection: "Waiting",
    source: "degraded",
    cause: "Busy",
    answered: true,
  });
});

test("a body silent past the deadline is a close, and the stream is opened again", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("ready", undefined, { version: 1 })],
      silent: true,
    },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(server.silencesMs).toEqual([projectStreamSilenceMs]);
  expect(server.headersSeen.length).toBe(2);
  expect(seen.statuses).toContainEqual({
    connection: "Waiting",
    source: "unknown",
    cause: "Silent",
    answered: true,
  });
});

test("a held body is not cut by its deadline while it stays open", async () => {
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
  expect(server.silencesMs).toEqual([]);
  expect(server.headersSeen.length).toBe(1);
});

test("a ready or reset naming the log's head is where the next open resumes", async () => {
  const server = streamServer([
    { status: 200, chunks: [frame("ready", "4", { version: 1 })] },
    { status: 200, chunks: [frame("reset", "9", { version: 1 })] },
    { status: 200, chunks: [frame("ready", undefined, { version: 1 })] },
    { status: 401 },
  ]);
  await openProjectStream(server.ports, partition, collector().handlers)
    .finished;
  expect(server.headersSeen.map((headers) => headers["last-event-id"])).toEqual(
    [undefined, "4", "9", "9"],
  );
});

/** A console older than the API it reads is handed frames it cannot parse,
 * and replaying one of them at every open would leave it never live. */
test("a frame the contract rejects is skipped, its sequence taken and the partition read again", async () => {
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
            phase: "Work",
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
  expect(seen.skipped.length).toBe(1);
  expect(seen.events.map((event) => event.event)).toEqual(["Ticket"]);
  expect(server.headersSeen.length).toBe(2);
  expect(server.headersSeen[1]?.["last-event-id"]).toBe("10");
});

test("a frame naming an event this console does not know is skipped and its sequence taken", async () => {
  const server = streamServer([
    {
      status: 200,
      chunks: [frame("Unheard", "12", { version: 1 })],
    },
  ]);
  const seen = collector();
  await openProjectStream(server.ports, partition, seen.handlers).finished;
  expect(seen.skipped.length).toBe(1);
  expect(seen.events).toEqual([]);
  expect(server.headersSeen[1]?.["last-event-id"]).toBe("12");
});

test("a status is published once for as long as it does not change", async () => {
  const live = frame("source", undefined, { version: 1, state: "live" });
  const server = streamServer([
    {
      status: 200,
      chunks: [live, live, live, live],
      hold: true,
    },
  ]);
  const seen = collector();
  const opened = openProjectStream(server.ports, partition, seen.handlers);
  await server.holding;
  opened.stop();
  await opened.finished;
  expect(seen.statuses.map((status) => status.connection)).toEqual([
    "Opening",
    "Open",
    "Open",
  ]);
  expect(seen.statuses.map((status) => status.source)).toEqual([
    "unknown",
    "unknown",
    "live",
  ]);
});

/** A renewal hands the next run what the last one learnt. */
test("a run handed what an earlier one held replays from its cursor and is answered", async () => {
  const server = streamServer([{ status: 200, chunks: [], hold: true }]);
  const held = {
    ...projectStreamHeldInitial(),
    lastSequence: 41,
    answered: true,
  };
  const seen = collector();
  const opened = openProjectStream(
    server.ports,
    partition,
    seen.handlers,
    held,
  );
  await server.holding;
  opened.stop();
  await opened.finished;
  expect(server.headersSeen[0]?.["last-event-id"]).toBe("41");
  expect(seen.statuses[0]?.answered).toBe(true);
});

test("the reopen delay doubles from the floor and stops at the ceiling", () => {
  expect(streamDelayMs(1)).toBe(streamReopenDelayMsMin);
  expect(streamDelayMs(2)).toBe(streamReopenDelayMsMin * 2);
  expect(streamDelayMs(20)).toBe(streamReopenDelayMsMax);
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
  return { connection, source, answered, cause: undefined };
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

test("nothing is said until the grace has lapsed, nor while the stream carries", () => {
  expect(
    projectStreamNotice(statusAt("Waiting", "live"), false, false),
  ).toEqual({ notice: "Quiet" });
  expect(projectStreamNotice(statusAt("Open", "live"), true, true)).toEqual({
    notice: "Quiet",
  });
  expect(
    projectStreamNotice(statusAt("Opening", "unknown", false), true, false),
  ).toEqual({ notice: "Quiet" });
});

test("a stream past the grace is reconnecting while it climbs, and not live once nothing reads", () => {
  expect(
    projectStreamNotice(statusAt("Waiting", "live"), true, false).notice,
  ).toBe("Reconnecting");
  expect(
    projectStreamNotice(statusAt("Opening", "live"), true, false).notice,
  ).toBe("Reconnecting");
  expect(
    projectStreamNotice(statusAt("Waiting", "live"), true, true).notice,
  ).toBe("NotLive");
  expect(
    projectStreamNotice(statusAt("Stopped", "live"), true, false).notice,
  ).toBe("NotLive");
  expect(
    projectStreamNotice(statusAt("Open", "degraded"), true, false),
  ).toEqual({ notice: "NotLive", detail: "Change log degraded" });
});
