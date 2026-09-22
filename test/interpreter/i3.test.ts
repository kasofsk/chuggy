import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchEvent,
  finalizationResultEvent,
  releaseTicketEvent,
  resumeTicketEvent,
  revokeEvent,
  taskDoneEvent,
  workReduceEvent,
} from "../../src/actor/decisionEvent.ts";
import type { Entry } from "../../src/actor/journal.ts";
import { retryableIn } from "../../src/domain/enablement.ts";
import type { Config } from "../../src/domain/config.ts";
import type {
  DecisionEvent,
  FailureKind,
  TaskIdentity,
} from "../../src/domain/generated/modelTypes.ts";
import { escalationTags } from "../../src/domain/generated/modelTypes.ts";
import { actorInit, journalStep, memoryGraph } from "../../src/actor/state.ts";
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
  isCompletionDecisionEvent,
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
  plainDisposition,
  refinementInstance,
} from "../actor/harness.ts";
import {
  graphOf,
  id,
  judgedReport,
  producedReport,
  stoppedReport,
  ticketOn,
} from "../domain/fixtures.ts";
import { populated } from "./roster.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type { DecisionInput } from "../../src/interpreter/projectDiscovery.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

/** A work task settling with the artifact it produced, which is what a completion names. */
function workDone(cycle: number) {
  const work = workTaskOf(1, cycle);
  return taskDoneEvent(id(1), work, producedReport(work), plainDisposition);
}

/** One evaluator of a stage answering, under the disposition its failure is taken on. */
function judged(
  cycle: number,
  evaluator: number,
  verdict: "EvaluatorPass" | "EvaluatorFail",
  onFailure:
    "ReworkEvaluationFailure" | "EscalateEvaluationFailure" = plainDisposition,
) {
  const judge = evaluationTaskOf(1, cycle, 1, 1, evaluator);
  return taskDoneEvent(id(1), judge, judgedReport(judge, verdict), onFailure);
}

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
  const work = workTaskOf(1, 1);
  for (const report of [
    producedReport(work),
    stoppedReport(work, "ExecutionUnavailableFailure"),
  ]) {
    const event = taskDoneEvent(id(1), work, report, plainDisposition);
    assert.throws(
      () => asOperationDecisionEvent(event),
      /not a public decision command/,
    );
    const submitted = {
      type: "TaskDone",
      value: { ticket: id(1), task: work, report },
    } as const;
    const stored = JSON.stringify({
      version: 1,
      command: "Decide",
      event: submitted,
    });
    assert.equal(parseTicketCommand(stored).parsed, "Refused");
    assert.deepEqual(parseStoredTicketCommand(stored), {
      parsed: "Ok",
      value: { version: 1, command: "Decide", event: submitted },
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
    memoryGraph(released),
    memoryGraph(dispatched),
    entry,
  );
  assert.equal(planned.execution.length, 1);
  assert.equal(planned.execution[0]?.kind, "SpawnWork");
  assert.equal(planned.execution[0]?.tasks.length, 1);
});

/**
 * How each event reaches a writer: the one reduce on its continuation, a
 * completion on the scheduler's operation, a public command on its own. A
 * release is left out, because it spawns nothing.
 */
function plannedInput(
  event: DecisionEvent,
  ticket: ReturnType<typeof id>,
  phase: string,
): DecisionInput | undefined {
  if (isCompletionDecisionEvent(event)) {
    const { onFailure: _picked, ...value } = event.value;
    const completion = { type: "TaskDone", value } as const;
    return {
      partition,
      ordinal: 1,
      priority: "Completion",
      source: {
        kind: "Operation",
        operation: asOperationId("completion"),
        command: { version: 1, command: "Decide", event: completion },
        completion,
      },
    };
  }
  if (event.type !== "WorkReduce")
    return event.type === "CreateTicket"
      ? undefined
      : input(asOperationDecisionEvent(event));
  return {
    partition,
    ordinal: 1,
    priority: "Continuation",
    source: {
      kind: "Continuation",
      continuation: "continuation",
      reduction: { ticket },
      expectedTicketVersion: 1,
      expectedPhase: phase,
      taskSetGeneration: 1,
    },
  };
}

/**
 * The wire number is the ticket's own running count and the task's place in
 * its set, so an evaluation stage takes a contiguous run above the work cycle
 * it judges and a rework starts above both.
 */
test("a ticket's task numbers ascend over its whole history and never repeat", () => {
  const history = [
    releaseTicketEvent(id(1), plainAuthoring),
    dispatchEvent(id(1)),
    workDone(1),
    workReduceEvent(id(1)),
    judged(1, 1, "EvaluatorFail"),
    workDone(2),
    workReduceEvent(id(1)),
  ];
  const minted = mintedUnder(history, refinementInstance);
  assert.deepEqual(
    minted.map((each) => each.task),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    minted.map((each) => each.identity.type),
    ["WorkTask", "EvaluationTask", "WorkTask", "EvaluationTask"],
  );
  assert.deepEqual(minted[2]?.identity, workTaskOf(1, 2));
  assert.deepEqual(minted[3]?.identity, evaluationTaskOf(1, 2, 1, 1, 1));
});

/**
 * A history minted step by step under `config`: the identities each run
 * spawns and the wire numbers the plan gave them.
 */
function mintedUnder(
  history: readonly DecisionEvent[],
  config: Config = { ...refinementInstance, nTasks: 3 },
): readonly { task: number; identity: TaskIdentity }[] {
  const minted: { task: number; identity: TaskIdentity }[] = [];
  let state = actorInit();
  for (const event of history) {
    const before = memoryGraph(state);
    state = journalStep(config, state, event);
    const entry = state.journal.at(-1);
    assert.ok(entry !== undefined);
    const post = memoryGraph(state);
    const decided = plannedInput(
      entry.event,
      id(1),
      ticketAt(post, id(1)).phase,
    );
    if (decided === undefined) continue;
    const planned = materializationOf(decided, before, post, entry);
    minted.push(...planned.execution.flatMap((request) => [...request.tasks]));
  }
  return minted;
}

/** A program whose one stage lists evaluators 1 and 3 and no evaluator 2. */
const sparseAuthoring = {
  deps: new Set<number>(),
  prog: [{ key: 1, evaluators: [{ key: 1 }, { key: 3 }] }],
} as const;

/**
 * The count a spawn spends is the set's size, so a sparse stage takes the two
 * numbers after the work task and the rework takes the one after those. Minted
 * by evaluator key instead, the stage would skip a number and the rework would
 * take the one the stage's second evaluator already holds.
 */
test("a sparse stage mints consecutive numbers and the set after it repeats none", () => {
  const minted = mintedUnder([
    releaseTicketEvent(id(1), sparseAuthoring),
    dispatchEvent(id(1)),
    workDone(1),
    workReduceEvent(id(1)),
    judged(1, 1, "EvaluatorFail"),
    judged(1, 3, "EvaluatorPass"),
  ]);
  assert.deepEqual(
    minted.map((each) => each.task),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    minted.map((each) => each.identity),
    [
      workTaskOf(1, 1),
      evaluationTaskOf(1, 1, 1, 1, 1),
      evaluationTaskOf(1, 1, 1, 1, 3),
      workTaskOf(1, 2),
    ],
  );
});

/** A program whose one stage lists three evaluators, so a resume can re-ask one of them. */
const wideAuthoring = {
  deps: new Set<number>(),
  prog: [{ key: 1, evaluators: [{ key: 1 }, { key: 2 }, { key: 3 }] }],
} as const;

/** One evaluator stopped rather than answering, which is what a resume comes back for. */
function stopped(cycle: number, evaluator: number, kind: FailureKind) {
  const judge = evaluationTaskOf(1, cycle, 1, 1, evaluator);
  return taskDoneEvent(
    id(1),
    judge,
    stoppedReport(judge, kind),
    plainDisposition,
  );
}

/**
 * The count a run spends is its whole roster, generation by generation, so the
 * re-ask takes a number above every one the first pass minted rather than one
 * of the set it is resuming. Minted off the tasks dispatched instead, the lone
 * re-ask would land back inside its own stage's first run.
 */
test("a resume re-asks the stopped evaluator alone, at a number the first pass never held", () => {
  const minted = mintedUnder([
    releaseTicketEvent(id(1), wideAuthoring),
    dispatchEvent(id(1)),
    workDone(1),
    workReduceEvent(id(1)),
    judged(1, 1, "EvaluatorPass"),
    stopped(1, 2, "ProcessFailure"),
    judged(1, 3, "EvaluatorPass"),
    resumeTicketEvent(id(1)),
  ]);
  assert.deepEqual(
    minted.map((each) => each.task),
    [1, 2, 3, 4, 6],
  );
  assert.deepEqual(minted.at(-1)?.identity, evaluationTaskOf(1, 1, 1, 2, 2));
});

/**
 * A cancellation names only the tasks it retires, by the numbers their spawn
 * minted: the retired evaluator's position is counted in the whole set, not
 * among the tasks the cancellation lists.
 */
test("a cancellation names a retired task by the number its spawn minted", () => {
  const minted = mintedUnder([
    releaseTicketEvent(id(1), sparseAuthoring),
    dispatchEvent(id(1)),
    workDone(1),
    workReduceEvent(id(1)),
    judged(1, 1, "EvaluatorPass"),
    revokeEvent(id(1)),
  ]);
  assert.deepEqual(minted.at(-1), {
    task: 3,
    identity: evaluationTaskOf(1, 1, 1, 1, 3),
  });
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
    taskDoneEvent(
      id(1),
      workTaskOf(1, 1),
      stoppedReport(workTaskOf(1, 1), "ExecutionUnavailableFailure"),
      plainDisposition,
    ),
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
    memoryGraph(escalated),
    memoryGraph(revoked),
    entry,
  );
  assert.deepEqual(planned.withdrawActionsFor, [id(1)]);
});

/** The state a ticket reaches by passing its whole program: one finalization awaiting a report. */
function finalizing(): ReturnType<typeof journalStep> {
  const steps: readonly DecisionEvent[] = [
    releaseTicketEvent(id(1), plainAuthoring),
    dispatchEvent(id(1)),
    workDone(1),
    workReduceEvent(id(1)),
    judged(1, 1, "EvaluatorPass"),
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
    outcome: "FinalizationNeedsWork",
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
  const result = finalizationResultEvent(id(1), "FinalizationNeedsWork");
  const after = journalStep(refinementInstance, before, result);
  const entry = after.journal.at(-1);
  assert.ok(entry !== undefined);
  const planned = materializationOf(
    finalizationInput(result),
    memoryGraph(before),
    memoryGraph(after),
    entry,
  );
  assert.deepEqual(planned.withdrawActionsFor, [id(1)]);
});

/** The raise's own record: the transition every park writes, and the task it opens. */
function parkEntry(): Entry {
  return {
    seq: 4,
    event: judged(1, 1, "EvaluatorFail", "EscalateEvaluationFailure"),
    rec: {
      label: "ticket-escalated",
      transitions: [{ ticket: 1, from: "Evaluation", to: "Escalated" }],
      effects: ["OpenHumanTask"],
    },
  };
}

/** The item a reduce reaches the writer as, which carries no principal's command. */
function continuationInput(): DecisionInput {
  return {
    partition,
    ordinal: 1,
    priority: "Ordinary",
    source: {
      kind: "Continuation",
      continuation: "continuation",
      reduction: { ticket: id(1) },
      expectedTicketVersion: 1,
      expectedPhase: "Evaluation",
      taskSetGeneration: 1,
    },
  };
}

/**
 * Every wall derives a resume, so enablement accepts both answers at every one
 * of them and an action offering fewer would be short of what the actor takes.
 */
test("an open action admits exactly the answers the actor's enablement accepts", () => {
  for (const escalation of escalationTags) {
    if (escalation === "NoEscalation") continue;
    const post = graphOf([
      ticketOn(refinementInstance, { phase: "Escalated", escalation }),
    ]);
    const planned = materializationOf(
      continuationInput(),
      graphOf([]),
      post,
      parkEntry(),
    );
    assert.ok(retryableIn(post, id(1)), escalation);
    assert.equal(planned.actions[0]?.escalation, escalation);
    assert.deepEqual(
      planned.actions[0]?.resolutions,
      ["Resume", "Revoke"],
      escalation,
    );
  }
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
      memoryGraph(before),
      memoryGraph(after),
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
