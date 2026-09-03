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

import {
  parseProjectStreamEvent,
  projectChangeKinds,
} from "../../../src/contract/events.ts";
import type { ProjectStreamFrame } from "../../../src/contract/events.ts";
import { projectCacheCommands } from "../app/core/projectCacheCommands.ts";
import {
  projectPartitionKey,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";
import { ticketAttemptKey } from "../app/core/ticketActions.ts";
import { leadSession, leadSessionResource } from "./leadFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };
const ticket = { ticket: 3, phase: "Working", sequence: 9, ...ticketInstants };

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

/**
 * A held key is the console's own working state and no read of the wire, so a
 * partition reset must reach it and no `WriteResource` or `DropResource` ever
 * can. Both halves are the position of one element: inside the partition
 * prefix every command shares, and outside every kind a frame can name.
 */
test("a key a screen holds is inside the partition and outside every kind", () => {
  const prefix = projectPartitionKey(partition);
  const held = ticketAttemptKey(partition, 3);
  expect(held.slice(0, prefix.length)).toEqual(prefix);
  for (const kind of projectChangeKinds)
    expect(held[prefix.length]).not.toBe(kind);
});

/**
 * The two kinds slice 2 adds. The refusal names its ticket, so a page already
 * showing that ticket takes one more refusal as a re-read of a row it holds;
 * the session names itself, which is what makes the lead page's head and its
 * transcript move without a poll behind them.
 */
test("a refusal names its ticket and a session names itself", () => {
  const ledger = { ticket: 42, entries: [], more: false };
  const refusal = projectCacheCommands(
    partition,
    decoded({
      event: "AgenticRefusal",
      id: "30",
      data: { version: 1, resource: "42", representation: ledger },
    }),
  );
  expect(refusal[0]).toEqual({
    command: "WriteResource",
    key: projectResourceKey(partition, "AgenticRefusal", "42"),
    representation: ledger,
  });
  expect(refusal[1]).toEqual({
    command: "FoldLists",
    kind: "AgenticRefusal",
    resource: "42",
    representation: ledger,
  });
  const named = leadSessionResource(leadSession, "turn-7");
  const session = projectCacheCommands(
    partition,
    decoded({
      event: "Session",
      id: "31",
      data: { version: 1, resource: named, representation: null },
    }),
  );
  expect(session[1]).toEqual({
    command: "FoldLists",
    kind: "Session",
    resource: named,
    representation: null,
  });
});

/** The wire refuses a body its kind's schema rejects, so no cache decision is
 * taken over one. */
test("a body the wire would not send never becomes an event", () => {
  expect(() =>
    decoded({
      event: "AgenticRefusal",
      id: "32",
      data: {
        version: 1,
        resource: "42",
        representation: { ticket: "forty-two" },
      },
    }),
  ).toThrow();
});
