/**
 * The project stream vocabulary: what a frame must carry to be understood, and
 * what a reader may do with it.
 *
 * A change frame's representation is the GET's own body, so the case that
 * proves it is one that parses a representation back through the resource
 * schema it came from.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ticketResponse } from "../../src/adapters/http/outcomes.ts";
import {
  parseProjectStreamEvent,
  projectChangeDataSchema,
  projectChangeKinds,
  projectSourceDataSchema,
  projectStreamVersion,
} from "../../src/contract/events.ts";
import { ticketResponseSchema } from "../../src/contract/responses.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { populated } from "../interpreter/roster.ts";

const representation = ticketResponse({
  ticket: asTicketId(3),
  phase: "Working",
  sequence: 9,
}).body as Readonly<Record<string, unknown>>;

test("a change frame carries the GET's own representation under its identity", () => {
  const event = parseProjectStreamEvent({
    event: "Ticket",
    id: "42",
    data: { version: projectStreamVersion, resource: "3", representation },
  });
  assert.equal(event.event, "Ticket");
  assert.equal(event.event === "Ticket" ? event.sequence : undefined, 42);
  assert.equal(event.data.version, projectStreamVersion);
  assert.equal(
    ticketResponseSchema.parse(
      event.event === "Ticket" ? event.data.representation : undefined,
    ).phase,
    "Working",
  );
});

test("a null representation is the tombstone every kind may send", () => {
  for (const kind of populated(projectChangeKinds, "the change kinds")) {
    const event = parseProjectStreamEvent({
      event: kind,
      id: "1",
      data: {
        version: projectStreamVersion,
        resource: "one",
        representation: null,
      },
    });
    assert.equal(event.event, kind);
    assert.equal(event.data.version, projectStreamVersion);
  }
});

test("the control frames carry their version and the source its state", () => {
  assert.deepEqual(
    parseProjectStreamEvent({
      event: "ready",
      data: { version: projectStreamVersion },
    }),
    { event: "ready", data: { version: projectStreamVersion } },
  );
  assert.deepEqual(
    parseProjectStreamEvent({
      event: "reset",
      data: { version: projectStreamVersion },
    }),
    { event: "reset", data: { version: projectStreamVersion } },
  );
  const source = parseProjectStreamEvent({
    event: "source",
    data: { version: projectStreamVersion, state: "degraded" },
  });
  assert.equal(
    source.event === "source" ? source.data.state : undefined,
    "degraded",
  );
});

test("a frame the vocabulary does not name is refused, not guessed at", () => {
  assert.throws(
    () =>
      parseProjectStreamEvent({
        event: "Rumour",
        id: "1",
        data: { version: projectStreamVersion, resource: "1", representation },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      parseProjectStreamEvent({
        event: "Ticket",
        data: { version: projectStreamVersion, resource: "1", representation },
      }),
    RangeError,
  );
  assert.throws(() =>
    parseProjectStreamEvent({
      event: "Ticket",
      id: "007",
      data: { version: projectStreamVersion, resource: "1", representation },
    }),
  );
  assert.throws(() =>
    projectChangeDataSchema.parse({
      version: projectStreamVersion + 1,
      resource: "1",
      representation,
    }),
  );
  assert.throws(() =>
    projectSourceDataSchema.parse({
      version: projectStreamVersion,
      state: "guessing",
    }),
  );
});
