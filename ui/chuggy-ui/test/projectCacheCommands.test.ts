/**
 * What a stream event does to the cache, one case per event the contract can
 * send.
 *
 * The tombstone and the unreadable representation are the two the console gets
 * wrong quietly: the first leaves a deleted resource on the screen, the second
 * caches something no screen can render.
 */

import { expect, test } from "vitest";

import { projectCacheCommands } from "../app/core/projectCacheCommands.ts";
import {
  projectPartitionKey,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";

const partition = { tenant: "acme", project: "atlas" };
const ticket = { ticket: 3, phase: "Working", sequence: 9 };

test("a reset invalidates the whole partition and nothing narrower", () => {
  const commands = projectCacheCommands(partition, {
    event: "reset",
    data: { version: 1 },
  });
  expect(commands).toEqual([
    {
      command: "InvalidatePartition",
      key: projectPartitionKey(partition),
    },
  ]);
});

test("ready and source touch the cache at all", () => {
  expect(
    projectCacheCommands(partition, { event: "ready", data: { version: 1 } }),
  ).toEqual([]);
  expect(
    projectCacheCommands(partition, {
      event: "source",
      data: { version: 1, state: "degraded" },
    }),
  ).toEqual([]);
});

test("a change writes the representation and offers it to the lists", () => {
  const commands = projectCacheCommands(partition, {
    event: "Ticket",
    sequence: 12,
    data: { version: 1, resource: "3", representation: ticket },
  });
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
  const commands = projectCacheCommands(partition, {
    event: "Ticket",
    sequence: 13,
    data: { version: 1, resource: "3", representation: null },
  });
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

test("a representation the kind's schema rejects invalidates instead", () => {
  expect(
    projectCacheCommands(partition, {
      event: "Ticket",
      sequence: 14,
      data: { version: 1, resource: "3", representation: { ticket: "three" } },
    }),
  ).toEqual([
    { command: "InvalidatePartition", key: projectPartitionKey(partition) },
  ]);
});
