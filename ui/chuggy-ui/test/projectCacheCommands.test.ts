/**
 * What a stream event does to the cache, one case per event the contract can
 * send.
 *
 * Every event is decoded from a frame by the contract's own parser rather than
 * built by hand, so a case cannot assert over an envelope the wire would
 * refuse. The tombstone is the one the console gets wrong quietly: it leaves a
 * deleted resource on the screen.
 */

import { expect, test } from "vitest";

import {
  parseProjectStreamEvent,
  projectStreamKinds,
} from "../../../src/contract/events.ts";
import type { ProjectStreamFrame } from "../../../src/contract/events.ts";
import { projectCacheCommands } from "../app/core/projectCacheCommands.ts";
import {
  projectHeldKey,
  projectPartitionKey,
  projectResourceKey,
} from "../app/core/projectQueryKeys.ts";

const partition = { tenant: "acme", project: "atlas" };
const ticket = { ticket: 3, state: "Working" };
const leadResource = JSON.stringify({
  session: "lead-atlas",
  kind: "Lead",
  turn: "turn-7",
});

function decoded(
  frame: ProjectStreamFrame,
): ReturnType<typeof parseProjectStreamEvent> {
  return parseProjectStreamEvent(frame);
}

test("a reset invalidates the whole partition and nothing narrower", () => {
  expect(
    projectCacheCommands(
      partition,
      decoded({ event: "reset", data: { version: 1 } }),
    ),
  ).toEqual([
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
      decoded({ event: "source", data: { version: 1, state: "degraded" } }),
    ),
  ).toEqual([]);
});

/**
 * The representation is not parsed by the wire here, so it is not written into
 * a key a typed reader would hand back as its own shape; the entry is staled
 * and the route's own parsed answer is what fills it.
 */
test("a change stales its resource rather than writing an unparsed body", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({
      event: "Ticket",
      id: "12",
      data: { version: 1, resource: "3", representation: ticket },
    }),
  );
  expect(commands[0]).toEqual({
    command: "StaleResource",
    key: projectResourceKey(partition, "Ticket", "3"),
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

/** The two kinds beside the ticket, each named under its own key rather than
 * folded into the ticket's. */
test("an execution and a session are keyed under their own kinds", () => {
  const execution = projectCacheCommands(
    partition,
    decoded({
      event: "Execution",
      id: "20",
      data: {
        version: 1,
        resource: "run-1",
        representation: { task: "run-1" },
      },
    }),
  );
  expect(execution[0]).toEqual({
    command: "StaleResource",
    key: projectResourceKey(partition, "Execution", "run-1"),
  });
  const session = projectCacheCommands(
    partition,
    decoded({
      event: "Session",
      id: "21",
      data: { version: 1, resource: leadResource, representation: null },
    }),
  );
  expect(session[1]).toEqual({
    command: "FoldLists",
    kind: "Session",
    resource: leadResource,
    representation: null,
  });
});

/**
 * A held key is the console's own working state and no read of the wire, so a
 * partition reset must reach it and no resource command ever can. Both halves
 * are the position of one element: inside the partition prefix every command
 * shares, and outside every kind a frame can name.
 */
test("a key a screen holds is inside the partition and outside every kind", () => {
  const prefix = projectPartitionKey(partition);
  const held = projectHeldKey(partition, "table-filters");
  expect(held.slice(0, prefix.length)).toEqual(prefix);
  for (const kind of projectStreamKinds)
    expect(held[prefix.length]).not.toBe(kind);
});

/** The envelope is what the wire pins, so a change frame with no sequence on it
 * is refused and never becomes a cache decision. */
test("a change frame carrying no sequence never becomes an event", () => {
  expect(() =>
    decoded({
      event: "Ticket",
      data: { version: 1, resource: "3", representation: ticket },
    }),
  ).toThrow();
});

/**
 * The divergence this console is built on: the routes answer bodies they do not
 * parse, so a representation of any object shape rides the wire and the cache
 * layer never treats it as a read.
 */
test("a representation no route schema would accept still rides the wire", () => {
  const commands = projectCacheCommands(
    partition,
    decoded({
      event: "Ticket",
      id: "14",
      data: { version: 1, resource: "3", representation: { ticket: "three" } },
    }),
  );
  expect(commands[0]).toEqual({
    command: "StaleResource",
    key: projectResourceKey(partition, "Ticket", "3"),
  });
});
