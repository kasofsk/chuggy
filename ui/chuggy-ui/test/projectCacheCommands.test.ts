/**
 * What a stream event does to the cache, one case per event the contract can
 * send.
 *
 * Every event is decoded from a frame by the contract's own parser rather than
 * built by hand, so a case cannot assert over a shape the wire would refuse.
 * The tombstone is the one the console gets wrong quietly: it leaves a deleted
 * resource on the screen.
 */

import { expect, test } from "vitest";

import { parseProjectStreamEvent } from "../../../src/contract/events.ts";
import type { ProjectStreamFrame } from "../../../src/contract/events.ts";
import { projectCacheCommands } from "../app/core/projectCacheCommands.ts";
import {
  projectPartitionKey,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";

const partition = { tenant: "acme", project: "atlas" };
const ticket = { ticket: 3, phase: "Working", sequence: 9 };

function decoded(
  frame: ProjectStreamFrame,
): ReturnType<typeof parseProjectStreamEvent> {
  return parseProjectStreamEvent(frame);
}

test("a reset invalidates the whole partition and nothing narrower", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({ event: "reset", data: { version: 1 } }),
  );
  expect(commands).toEqual([
    { command: "InvalidatePartition", key: projectPartitionKey(partition) },
  ]);
});

test("ready and source touch the cache at all", () => {
  expect(
    projectCacheCommands(
      partition,
      decoded({ event: "ready", data: { version: 1 } }),
    ),
  ).toEqual([]);
  expect(
    projectCacheCommands(
      partition,
      decoded({
        event: "source",
        data: { version: 1, state: "degraded" },
      }),
    ),
  ).toEqual([]);
});

test("a change writes the representation and offers it to the lists", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({
      event: "Ticket",
      id: "12",
      data: { version: 1, resource: "3", representation: ticket },
    }),
  );
  expect(commands[0]).toEqual({
    command: "WriteResource",
    key: projectResourceKey(partition, "Ticket", "3"),
    representation: ticket,
  });
  expect(commands[1]).toEqual({
    command: "FoldLists",
    kind: "Ticket",
    resource: "3",
    representation: ticket,
  });
});

test("a null representation drops the entry rather than leaving it stale", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({
      event: "Ticket",
      id: "13",
      data: { version: 1, resource: "3", representation: null },
    }),
  );
  expect(commands[0]).toEqual({
    command: "DropResource",
    key: projectResourceKey(partition, "Ticket", "3"),
  });
  expect(commands[1]).toEqual({
    command: "FoldLists",
    kind: "Ticket",
    resource: "3",
    representation: null,
  });
});

test("a Project frame invalidates the partition rather than writing", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({
      event: "Project",
      id: "20",
      data: { version: 1, resource: "atlas", representation: partition },
    }),
  );
  expect(commands).toEqual([
    { command: "InvalidatePartition", key: projectPartitionKey(partition) },
  ]);
});

test("a Project tombstone invalidates too, and drops nothing by hand", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({
      event: "Project",
      id: "21",
      data: { version: 1, resource: "atlas", representation: null },
    }),
  );
  expect(commands).toEqual([
    { command: "InvalidatePartition", key: projectPartitionKey(partition) },
  ]);
});

/** The wire refuses it, so no cache decision is ever taken over one. */
test("a representation the kind's schema rejects never becomes an event", () => {
  expect(() =>
    decoded({
      event: "Ticket",
      id: "14",
      data: { version: 1, resource: "3", representation: { ticket: "three" } },
    }),
  ).toThrow();
});
