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
import type { Entry } from "../../src/actor/journal.ts";
import { retryableIn } from "../../src/domain/enablement.ts";
import type {
  DecisionEvent,
  Phase,
} from "../../src/domain/generated/modelTypes.ts";
import {
  reasonTags,
  resumeTags,
  retryPricingTags,
} from "../../src/domain/generated/modelTypes.ts";
import { actorInit, journalStep, memoryCore } from "../../src/actor/state.ts";
import { materializationOf } from "../../src/interpreter/decisionPlan.ts";
import { inputBundleReferencesOf } from "../../src/interpreter/decisionPlan.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asResultManifestId } from "../../src/interpreter/resultManifest.ts";
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
  parseStoredTicketCommand,
  parseTicketCommand,
} from "../../src/interpreter/wire.ts";
import {
  plainAuthoring,
  plainResult,
  refinementInstance,
} from "../actor/harness.ts";
import { coreOf, id, ticketOn } from "../domain/fixtures.ts";
import { populated } from "./roster.ts";
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

test("trusted classification reserves safety traffic", () => {
  const safety = {
    version: 1,
    command: "Decide",
    event: asOperationDecisionEvent({ type: "Revoke", value: id(1) }),
  } as const;
  assert.deepEqual(classifyCommand(safety), {
    admission: "CorrectnessReducing",
    priority: "Safety",
  });
});

test("a completion is no command a principal may offer, and a writer still reads one", () => {
  for (const event of [
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    executionBlockedEvent(id(1), "ExecutionProfileUnavailable"),
  ]) {
    assert.throws(
      () => asOperationDecisionEvent(event),
      /not a public decision command/,
    );
    const stored = JSON.stringify({ version: 1, command: "Decide", event });
    assert.equal(parseTicketCommand(stored).parsed, "Refused");
    assert.deepEqual(parseStoredTicketCommand(stored), {
      parsed: "Ok",
      value: { version: 1, command: "Decide", event },
    });
  }
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
  for (const resolution of populated(
    allNativeActionResolutions,
    "allNativeActionResolutions",
  )) {
    const offered = { ...command, resolution };
    assert.deepEqual(parseTicketCommand(encodeTicketCommand(offered)), {
      parsed: "Ok",
      value: offered,
    });
    const reducing =
      resolution === safetyResolution || resolution === "AbandonHandoff";
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

test("a spawn bundle pins its exact source and prior result manifests", () => {
  const references = inputBundleReferencesOf(
    { configurationRevision: "revision", configurationDigest: "d".repeat(64) },
    {
      bundle: "bundle",
      source: {
        repository: asRepositoryId("repository"),
        targetRef: asGitRefName("refs/heads/main"),
        targetCommit: asGitObjectId("a".repeat(40)),
        manifests: [asResultManifestId("manifest-one")],
      },
    },
  );
  assert.deepEqual(references.slice(1), [
    { kind: "Repository", reference: "repository" },
    { kind: "TargetCommit", reference: "a".repeat(40) },
    { kind: "ResultManifest", reference: "manifest-one" },
  ]);
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
        acceptedPromotion: {
          repository: "unrelated-work",
          commit: "a".repeat(40),
          configurationRevision: "revision",
          configurationDigest: "b".repeat(64),
        },
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

test("promotion and an unproven publication materialize a resumable handoff hold", () => {
  const before = finalizing();
  const promotion = finalizationResultEvent(id(1), "PromotionAccepted");
  const publishing = journalStep(refinementInstance, before, promotion);
  const promotionEntry = publishing.journal.at(-1);
  assert.ok(promotionEntry !== undefined);
  const promotionPlan = materializationOf(
    finalizationInput(promotion),
    memoryCore(before),
    memoryCore(publishing),
    promotionEntry,
  );
  assert.equal(promotionPlan.finalization.length, 1);
  assert.match(promotionPlan.finalization[0]?.request ?? "", /PublishHandoff/u);
  assert.equal(
    promotionPlan.finalization[0]?.acceptedPromotion?.repository,
    "unrelated-work",
  );

  const unproven = finalizationResultEvent(id(1), "HandoffPublicationUnproven");
  const blocked = journalStep(refinementInstance, publishing, unproven);
  const blockedEntry = blocked.journal.at(-1);
  assert.ok(blockedEntry !== undefined);
  const blockedPlan = materializationOf(
    finalizationInput(unproven),
    memoryCore(publishing),
    memoryCore(blocked),
    blockedEntry,
  );
  assert.deepEqual(
    blockedPlan.actions.map((action) => action.kind),
    ["HandoffBlock"],
  );
  assert.deepEqual(blockedPlan.actions[0]?.resolutions, [
    "RetryHandoff",
    "AbandonHandoff",
  ]);
});

/** The raise's own record: the transition every park writes, and the task it opens. */
function parkEntry(
  phase: Extract<Phase, "Escalated" | "HandoffBlocked">,
): Entry {
  return {
    seq: 4,
    event: evalReduceEvent(id(1)),
    rec: {
      label: "ticket-escalated",
      transitions: [{ ticket: 1, from: "Evaluating", to: phase }],
      effects: ["OpenHumanTask"],
    },
  };
}

/** The item a reduce reaches the writer as, which carries no principal's command. */
function continuationInput(event: DecisionEvent): DecisionInput {
  return {
    partition,
    ordinal: 1,
    priority: "Ordinary",
    source: {
      kind: "Continuation",
      continuation: "continuation",
      command: event,
      expectedTicketVersion: 1,
      expectedPhase: "Evaluating",
      taskSetGeneration: 1,
    },
  };
}

test("an open action admits exactly the answers the actor's enablement accepts", () => {
  const offered = new Set<string>();
  for (const phase of ["Escalated", "HandoffBlocked"] as const) {
    for (const reason of reasonTags) {
      for (const resumeAt of resumeTags) {
        for (const resumePricing of retryPricingTags) {
          for (const gasLeft of [0, 1]) {
            const post = coreOf([
              ticketOn(refinementInstance, "ManagedFinalizer", {
                phase,
                reason,
                resumeAt,
                resumePricing,
                gasLeft,
              }),
            ]);
            const entry = parkEntry(phase);
            const planned = materializationOf(
              continuationInput(entry.event),
              coreOf([]),
              post,
              entry,
            );
            const answers =
              phase === "HandoffBlocked"
                ? (["RetryHandoff", "AbandonHandoff"] as const)
                : (["Resume", "Revoke"] as const);
            const expected = retryableIn(post, id(1))
              ? [answers[0], answers[1]]
              : [answers[1]];
            assert.deepEqual(
              planned.actions[0]?.resolutions,
              expected,
              [phase, reason, resumeAt, resumePricing, gasLeft].join("/"),
            );
            offered.add(expected.join(","));
          }
        }
      }
    }
  }
  assert.deepEqual([...offered].sort(), [
    "AbandonHandoff",
    "Resume,Revoke",
    "RetryHandoff,AbandonHandoff",
    "Revoke",
  ]);
});

/**
 * A ticket that spends its gas on a rework and a finalizer retry, and whose
 * promoted handoff then goes unproven. It reaches the hold with nothing left to
 * pay for the republication its resume point names.
 */
function handoffBlockedWithoutGas(): ReturnType<typeof journalStep> {
  const steps: readonly DecisionEvent[] = [
    releaseTicketEvent(id(1), plainAuthoring),
    dispatchEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(1), "Pass", plainResult),
    workReduceEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(2), "Fail", plainResult),
    evalReduceEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(3), "Pass", plainResult),
    workReduceEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(4), "Pass", plainResult),
    evalReduceEvent(id(1)),
    finalizationResultEvent(id(1), "FinalizationFailed"),
    taskDoneEvent(id(1), asTaskId(5), "Pass", plainResult),
    workReduceEvent(id(1)),
    taskDoneEvent(id(1), asTaskId(6), "Pass", plainResult),
    evalReduceEvent(id(1)),
    finalizationResultEvent(id(1), "PromotionAccepted"),
  ];
  return steps.reduce(
    (state, event) => journalStep(refinementInstance, state, event),
    actorInit(),
  );
}

test("a handoff hold with no gas for its republication admits only the abandon", () => {
  const publishing = handoffBlockedWithoutGas();
  const unproven = finalizationResultEvent(id(1), "HandoffPublicationUnproven");
  const blocked = journalStep(refinementInstance, publishing, unproven);
  const entry = blocked.journal.at(-1);
  assert.ok(entry !== undefined);
  const post = memoryCore(blocked);
  assert.equal(post.tickets.get(id(1))?.gasLeft, 0);
  assert.equal(post.tickets.get(id(1))?.resumeAt, "ResumePublishingHandoff");
  assert.equal(retryableIn(post, id(1)), false);
  const planned = materializationOf(
    finalizationInput(unproven),
    memoryCore(publishing),
    post,
    entry,
  );
  assert.deepEqual(planned.actions[0]?.resolutions, ["AbandonHandoff"]);
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
