import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  evalReduceEvent,
  executionBlockedEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  revokeEvent,
  taskDoneEvent,
  workReduceEvent,
} from "../../src/actor/decisionEvent.ts";
import type { DecisionEvent } from "../../src/domain/generated/modelTypes.ts";
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
  allNativeActionKinds,
  allNativeActionResolutions,
  isApprovalResolution,
  nativeActionResolutions,
  safetyResolution,
} from "../../src/interpreter/ticketCommand.ts";
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
    event: asOperationDecisionEvent(dispatchEvent(id(1))),
  } as const;
  assert.deepEqual(parseTicketCommand(encodeTicketCommand(command)), {
    parsed: "Ok",
    value: command,
  });
  assert.equal(parseTicketCommand('{"version":2}').parsed, "Refused");
  assert.throws(
    () => asOperationDecisionEvent({ type: "WorkReduce", value: id(1) }),
    /not a public decision command/,
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

test("every answer but the safety one is ordinary, and each belongs to one question", () => {
  const command = {
    version: 1 as const,
    command: "ResolveNativeAction" as const,
    action: "action",
    authorizingSeq: 1,
  };
  for (const resolution of allNativeActionResolutions) {
    const offered = { ...command, resolution };
    assert.deepEqual(parseTicketCommand(encodeTicketCommand(offered)), {
      parsed: "Ok",
      value: offered,
    });
    const reducing = resolution === safetyResolution;
    assert.deepEqual(
      classifyCommand({ ...command, resolution }),
      {
        admission: reducing ? "CorrectnessReducing" : "Ordinary",
        priority: reducing ? "Safety" : "Ordinary",
      },
      resolution,
    );
    const asking = allNativeActionKinds.filter((kind) =>
      nativeActionResolutions[kind].some((each) => each === resolution),
    );
    assert.deepEqual(asking.length, 1, resolution);
    assert.equal(
      isApprovalResolution(resolution),
      asking[0] === "FinalizationApproval",
      resolution,
    );
  }
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

/** The state a ticket reaches by passing its whole program: one finalization awaiting a report. */
function finalizing(): ReturnType<typeof journalStep> {
  const steps: readonly DecisionEvent[] = [
    releaseTicketEvent(id(1), plainAuthoring),
    dispatchEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    workReduceEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(2), "Pass", plainResult),
    evalReduceEvent(id(1)),
  ];
  return steps.reduce(
    (state, event) => journalStep(refinementInstance, state, event),
    actorInit(),
  );
}

/** The input the one finalizer door mints, which carries no public command. */
function finalizationInput(event: DecisionEvent): DecisionInput {
  const command = {
    version: 1,
    command: "SubmitFinalizationResult",
    request: "request",
    attempt: "attempt",
    requestGeneration: 1,
    recoveryEpoch: "epoch",
    outcome: "FinalizationFailed",
  } as const;
  return {
    partition,
    ordinal: 1,
    priority: "Completion",
    source: {
      kind: "Operation",
      operation: asOperationId("operation"),
      command,
      resolvedEvent: event,
      finalizationRequest: {
        request: command.request,
        requestGeneration: command.requestGeneration,
        open: true,
      },
    },
  };
}

test("a decision leaving finalization withdraws the approval it left unanswered", () => {
  const before = finalizing();
  const result = finalizationResultEvent(id(1), "FinalizationFailed");
  const after = journalStep(refinementInstance, before, result);
  const entry = after.journal.at(-1);
  assert.ok(entry !== undefined);
  const planned = materializationOf(
    finalizationInput(result),
    memoryCore(before),
    memoryCore(after),
    entry,
  );
  assert.deepEqual(planned.withdrawActionsFor, [id(1)]);
});

test("a decision that leaves a ticket where it found it withdraws nothing", () => {
  const before = journalStep(
    refinementInstance,
    actorInit(),
    releaseTicketEvent(id(1), plainAuthoring),
  );
  const after = journalStep(refinementInstance, before, dispatchEvent(id(1)));
  const entry = after.journal.at(-1);
  assert.ok(entry !== undefined);
  assert.deepEqual(
    materializationOf(
      input(asOperationDecisionEvent(entry.event)),
      memoryCore(before),
      memoryCore(after),
      entry,
    ).withdrawActionsFor,
    [],
  );
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
      event: asOperationDecisionEvent(dispatchEvent(id(1))),
    },
  };
  assert.equal("admission" in submission, false);
  assert.equal("priority" in submission, false);
});
