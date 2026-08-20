import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  executionBlockedEvent,
  releaseTicketEvent,
  revokeEvent,
  taskDoneEvent,
} from "../../src/actor/decisionEvent.ts";
import { actorInit, journalStep, memoryCore } from "../../src/actor/state.ts";
import { materializationOf } from "../../src/interpreter/decisionPlan.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
  asIdempotencyKey,
  asOperationDecisionEvent,
  asOperationId,
  classifyCommand,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import { observe } from "../../src/interpreter/ticketService.ts";
import {
  encodeTicketCommand,
  parseTicketCommand,
} from "../../src/interpreter/wire.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { id } from "../domain/fixtures.ts";
import { asTaskId } from "../../src/domain/ids.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

function input(
  event: ReturnType<typeof asOperationDecisionEvent>,
): DecisionInput {
  const command = { version: 1, command: "Decide", event } as const;
  return {
    partition,
    ordinal: 1,
    priority: classifyCommand(command).priority,
    source: {
      kind: "Operation",
      operation: asOperationId("operation"),
      command,
      resolvedEvent: event,
    },
  };
}

test("typed commands round-trip and internal reducers are not operation commands", () => {
  const command = {
    version: 1,
    command: "Decide",
    event: asOperationDecisionEvent(releaseTicketEvent(id(1), plainAuthoring)),
  } as const;
  assert.deepEqual(parseTicketCommand(encodeTicketCommand(command)), {
    parsed: "Ok",
    value: command,
  });
  assert.equal(parseTicketCommand('{"version":2}').parsed, "Refused");
  assert.throws(
    () => asOperationDecisionEvent({ type: "WorkReduce", value: id(1) }),
    /internal continuation/,
  );
});

test("trusted classification reserves completion and safety traffic", () => {
  const completion = {
    version: 1,
    command: "Decide",
    event: asOperationDecisionEvent(
      taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    ),
  } as const;
  const safety = {
    version: 1,
    command: "Decide",
    event: asOperationDecisionEvent({ type: "Revoke", value: id(1) }),
  } as const;
  assert.deepEqual(classifyCommand(completion), {
    admission: "CorrectnessReducing",
    priority: "Completion",
  });
  assert.deepEqual(classifyCommand(safety), {
    admission: "CorrectnessReducing",
    priority: "Safety",
  });
});

test("native-action resume is ordinary while revoke remains safety traffic", () => {
  const command = {
    version: 1 as const,
    command: "ResolveNativeAction" as const,
    action: "action",
    authorizingSeq: 1,
    resolution: "Resume" as const,
  };
  assert.deepEqual(classifyCommand(command), {
    admission: "Ordinary",
    priority: "Ordinary",
  });
  assert.deepEqual(classifyCommand({ ...command, resolution: "Revoke" }), {
    admission: "CorrectnessReducing",
    priority: "Safety",
  });
});

test("dispatch materializes exact logical work tasks from the pure state delta", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const dispatched = journalStep(
    refinementInstance,
    released,
    dispatchEvent(id(1)),
  );
  const entry = dispatched.journal[1];
  assert.ok(entry !== undefined);
  const planned = materializationOf(
    input(asOperationDecisionEvent(entry.event)),
    memoryCore(released),
    memoryCore(dispatched),
    entry,
  );
  assert.equal(planned.execution.length, 1);
  assert.equal(planned.execution[0]?.kind, "SpawnWork");
  assert.equal(planned.execution[0]?.tasks.length, plainAuthoring.workFanout);
});

test("a decision leaving escalation withdraws its open native action", () => {
  const released = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const working = journalStep(
    refinementInstance,
    released,
    dispatchEvent(id(1)),
  );
  const escalated = journalStep(
    refinementInstance,
    working,
    executionBlockedEvent(id(1), "TicketConfigIncompatible"),
  );
  const revoked = journalStep(
    refinementInstance,
    escalated,
    revokeEvent(id(1)),
  );
  const entry = revoked.journal.at(-1);
  assert.ok(entry !== undefined);
  const planned = materializationOf(
    input(asOperationDecisionEvent(entry.event)),
    memoryCore(escalated),
    memoryCore(revoked),
    entry,
  );
  assert.deepEqual(planned.withdrawActionsFor, [id(1)]);
});

test("telemetry failures cannot escape into ticket-service correctness", () => {
  assert.doesNotThrow(() => {
    observe(() => {
      throw new Error("exporter unavailable");
    });
  });
});

test("submission exposes no caller-selected admission or priority", () => {
  const submission: Submission = {
    partition,
    operation: asOperationId("operation"),
    authority: {
      kind: asAuthorityKind("User"),
      subject: asAuthoritySubject("subject"),
    },
    key: asIdempotencyKey("key"),
    command: {
      version: 1,
      command: "Decide",
      event: asOperationDecisionEvent(
        releaseTicketEvent(id(1), plainAuthoring),
      ),
    },
  };
  assert.equal("admission" in submission, false);
  assert.equal("priority" in submission, false);
});
