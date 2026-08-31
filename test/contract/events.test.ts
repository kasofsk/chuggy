/**
 * The project stream vocabulary: what a frame must carry to be understood, and
 * what a reader may do with it.
 *
 * A change frame's representation is the GET's own body, so the cases that
 * prove it start from `src/adapters/http/outcomes.ts` and feed what it emits
 * back through the stream. `Project` is the exception and the only one: its
 * representation is the inventory entry, which no encoder emits alone.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  configurationResponse,
  draftResponse,
  executionResponse,
  operationResponse,
  ticketNativeActionsResponse,
  ticketResponse,
} from "../../src/adapters/http/outcomes.ts";
import {
  parseProjectStreamEvent,
  projectChangeDataSchemas,
  projectChangeKinds,
  projectChangeRepresentationSchemas,
  projectSourceDataSchema,
  projectStreamVersion,
  type ProjectChangeKind,
} from "../../src/contract/events.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { populated } from "../interpreter/roster.ts";
import {
  configuration,
  execution,
  draft as draftResource,
  operation,
  partition,
  ticketInstants,
  versionedConfiguration,
} from "./representations.ts";

const ticketRepresentation = ticketResponse({
  ticket: asTicketId(3),
  phase: "Working",
  sequence: 9,
  ...ticketInstants,
}).body;

const nativeActionRepresentation = ticketNativeActionsResponse([
  {
    action: "approval",
    kind: "FinalizationApproval",
    authorizingSequence: 11,
    admits: ["Approve", "Decline"],
  },
]).body;

/** One representation per kind, each as the kind's own GET route emits it. */
const representations: Readonly<Record<ProjectChangeKind, unknown>> = {
  Ticket: ticketRepresentation,
  Execution: executionResponse(execution).body,
  Draft: draftResponse(draftResource).body,
  Configuration: configurationResponse(configuration).body,
  Operation: operationResponse(operation).body,
  Project: partition,
  NativeAction: nativeActionRepresentation,
};

test("a change frame carries the GET's own representation under its identity", () => {
  const event = parseProjectStreamEvent({
    event: "Ticket",
    id: "42",
    data: {
      version: projectStreamVersion,
      resource: "3",
      representation: ticketRepresentation,
    },
  });
  assert.equal(event.event, "Ticket");
  assert.equal(event.event === "Ticket" ? event.sequence : undefined, 42);
  assert.equal(
    event.event === "Ticket" ? event.data.representation?.phase : undefined,
    "Working",
  );
});

test("every kind parses the body its own GET route answers with", () => {
  for (const kind of populated(projectChangeKinds, "the change kinds")) {
    const event = parseProjectStreamEvent({
      event: kind,
      id: "7",
      data: {
        version: projectStreamVersion,
        resource: "one",
        representation: representations[kind],
      },
    });
    assert.equal(event.event, kind);
    assert.notEqual(event.data.representation, null);
    assert.deepEqual(
      event.data.representation,
      projectChangeRepresentationSchemas[kind].parse(representations[kind]),
      kind,
    );
  }
});

test("a configuration frame carries the version the read answers with", () => {
  const event = parseProjectStreamEvent({
    event: "Configuration",
    id: "8",
    data: {
      version: projectStreamVersion,
      resource: "revision-one",
      representation: configurationResponse(versionedConfiguration).body,
    },
  });
  assert.deepEqual(
    event.event === "Configuration"
      ? event.data.representation?.version
      : undefined,
    { name: "work", number: 3 },
  );
});

test("a representation another kind's route would answer with is refused", () => {
  assert.throws(() =>
    parseProjectStreamEvent({
      event: "Ticket",
      id: "7",
      data: {
        version: projectStreamVersion,
        resource: "3",
        representation: representations.Project,
      },
    }),
  );
  assert.throws(() =>
    projectChangeDataSchemas.Project.parse({
      version: projectStreamVersion,
      resource: "atlas",
      representation: ticketRepresentation,
    }),
  );
});

test("a ticket's open actions are its own resource under the ticket's identity", () => {
  const opened = parseProjectStreamEvent({
    event: "NativeAction",
    id: "12",
    data: {
      version: projectStreamVersion,
      resource: "3",
      representation: nativeActionRepresentation,
    },
  });
  assert.deepEqual(
    opened.event === "NativeAction"
      ? opened.data.representation?.actions.map((action) => action.kind)
      : undefined,
    ["FinalizationApproval"],
  );
  const answered = projectChangeDataSchemas.NativeAction.parse({
    version: projectStreamVersion,
    resource: "3",
    representation: ticketNativeActionsResponse([]).body,
  });
  assert.deepEqual(answered.representation, { actions: [] });
  assert.throws(() =>
    projectChangeDataSchemas.Ticket.parse({
      version: projectStreamVersion,
      resource: "3",
      representation: nativeActionRepresentation,
    }),
  );
  assert.throws(() =>
    projectChangeDataSchemas.NativeAction.parse({
      version: projectStreamVersion,
      resource: "3",
      representation: ticketRepresentation,
    }),
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
    assert.equal(event.data.representation, null);
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
  const data = {
    version: projectStreamVersion,
    resource: "3",
    representation: ticketRepresentation,
  };
  assert.throws(
    () => parseProjectStreamEvent({ event: "Rumour", id: "1", data }),
    RangeError,
  );
  assert.throws(
    () => parseProjectStreamEvent({ event: "Ticket", data }),
    RangeError,
  );
  assert.throws(() =>
    parseProjectStreamEvent({ event: "Ticket", id: "007", data }),
  );
  assert.throws(() =>
    projectChangeDataSchemas.Ticket.parse({
      ...data,
      version: projectStreamVersion + 1,
    }),
  );
  assert.throws(() =>
    projectSourceDataSchema.parse({
      version: projectStreamVersion,
      state: "guessing",
    }),
  );
});
