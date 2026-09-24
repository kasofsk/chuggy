import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTicketCommand,
  dispatchTicketCommand,
  reportFinalizationResultCommand,
  reportTaskTerminalCommand,
  resumeTicketCommand,
  revokeTicketCommand,
  type TicketCommand,
} from "../../src/actor/command.ts";
import type { Entry } from "../../src/actor/journal.ts";
import type { EvaluationFailurePolicy } from "../../src/domain/deciders.ts";
import { retryableIn } from "../../src/domain/enablement.ts";
import type { Config } from "../../src/domain/config.ts";
import type {
  FailureKind,
  Obligation,
  TaskIdentity,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { escalationTags } from "../../src/domain/generated/modelTypes.ts";
import {
  actorInit,
  journalStep,
  memoryGraph,
  type ActorState,
} from "../../src/actor/state.ts";
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
  asOperationTicketCommand,
  asOperationId,
  classifyCommand,
  type Submission,
} from "../../src/interpreter/operationInbox.ts";
import { observe } from "../../src/interpreter/ticketService.ts";
import { encodeTicketCommand } from "../../src/generated/model-api.ts";
import {
  allNativeActionKinds,
  allNativeActionResolutions,
  isApprovalResolution,
  isCompletionTicketCommand,
  nativeActionResolutions,
  safetyResolution,
  type ProjectCommand,
} from "../../src/interpreter/projectCommand.ts";
import {
  encodeProjectCommand,
  parseProjectCommand,
  parseStoredProjectCommand,
} from "../../src/interpreter/wire.ts";
import {
  plainDefinitionOf,
  plainPolicy,
  refinementInstance,
} from "../actor/harness.ts";
import {
  graphOf,
  id,
  judgedReport,
  producedReport,
  resultFor,
  stoppedReport,
  ticketOn,
} from "../domain/fixtures.ts";
import { populated } from "./roster.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import {
  aDispatchSource,
  anAcceptedSource,
  evaluatorOf,
  releasedTicketOf,
} from "../../src/domain/config.ts";
import {
  artifactOf,
  liveObligations,
  taskRefOf,
} from "../../src/domain/ticket.ts";
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
  return reportTaskTerminalCommand(producedReport(work));
}

/** One evaluator of a stage answering. */
function judged(
  cycle: number,
  evaluator: number,
  verdict: "EvaluatorPass" | "EvaluatorFail",
) {
  const judge = evaluationTaskOf(1, cycle, 1, 1, evaluator);
  return reportTaskTerminalCommand(judgedReport(judge, verdict));
}

/** One command decided and journalled: the graphs it stands between, its entry and what it owes. */
interface Decided {
  readonly state: ActorState;
  readonly before: TicketGraph;
  readonly after: TicketGraph;
  readonly entry: Entry;
  readonly obligations: readonly Obligation[];
}

function decidedAt(
  state: ActorState,
  event: TicketCommand,
  config: Config = refinementInstance,
  policy: EvaluationFailurePolicy = plainPolicy,
): Decided {
  const next = journalStep(config, state, event, policy);
  const entry = next.journal.at(-1);
  assert.ok(entry !== undefined);
  const last = next.view.last;
  assert.ok(last !== "NoDecision" && last.type === "Decided");
  return {
    state: next,
    before: memoryGraph(state),
    after: memoryGraph(next),
    entry,
    obligations: last.value.obligations,
  };
}

/** Every command of a history decided in turn, under the policy the suite is not steering. */
function walked(
  history: readonly TicketCommand[],
  config: Config = refinementInstance,
): ActorState {
  return history.reduce(
    (state, event) => journalStep(config, state, event, plainPolicy),
    actorInit(),
  );
}

/** What one decided command materializes, reached by the input it arrives in. */
function plannedAt(decided: Decided, input: DecisionInput) {
  return materializationOf(
    input,
    decided.before,
    decided.after,
    decided.entry,
    decided.obligations,
  );
}

/**
 * One decision input naming the command, in the envelope that command actually
 * arrives in: a dispatch is asked for by name and carries no resolved command,
 * every other public decision carrying its own.
 */
function input(event: TicketCommand): DecisionInput {
  const command: ProjectCommand =
    event.type === "DispatchTicket"
      ? {
          version: 1,
          command: "ManualDispatch",
          ticket: id(event.value.ticket),
          expectedTicketVersion: 1,
        }
      : {
          version: 1,
          command: "Decide",
          ticketCommand: asOperationTicketCommand(event),
        };
  return {
    partition,
    ordinal: 1,
    deferredPasses: 0,
    priority: classifyCommand(command).priority,
    source: {
      kind: "Operation",
      operation: asOperationId("operation"),
      command,
      ...(command.command === "Decide"
        ? { ticketCommand: command.ticketCommand }
        : {}),
    },
  };
}

test("typed commands round-trip and a release is not an operation command", () => {
  const command = {
    version: 1,
    command: "Decide",
    ticketCommand: asOperationTicketCommand(resumeTicketCommand(id(1))),
  } as const;
  assert.deepEqual(parseProjectCommand(encodeProjectCommand(command)), {
    parsed: "Ok",
    value: command,
  });
  assert.equal(parseProjectCommand('{"version":2}').parsed, "Refused");
  assert.throws(
    () => asOperationTicketCommand(createTicketCommand(plainDefinitionOf(1))),
    /not a public ticket command/,
  );
});

test("trusted classification reserves safety traffic", () => {
  const safety = {
    version: 1,
    command: "Decide",
    ticketCommand: asOperationTicketCommand({
      type: "RevokeTicket",
      value: id(1),
    }),
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
    const event = reportTaskTerminalCommand(report);
    assert.throws(
      () => asOperationTicketCommand(event),
      /not a public ticket command/,
    );
    const stored = JSON.stringify({
      version: 1,
      command: "Decide",
      ticketCommand: encodeTicketCommand(event),
    });
    assert.equal(parseProjectCommand(stored).parsed, "Refused");
    assert.deepEqual(parseStoredProjectCommand(stored), {
      parsed: "Ok",
      value: { version: 1, command: "Decide", ticketCommand: event },
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
    assert.deepEqual(parseProjectCommand(encodeProjectCommand(offered)), {
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

test("dispatch materializes exact logical work tasks from what it owes", () => {
  const released = walked([createTicketCommand(plainDefinitionOf(1))]);
  const dispatch = dispatchTicketCommand(id(1), aDispatchSource);
  const planned = plannedAt(decidedAt(released, dispatch), input(dispatch));
  assert.equal(planned.execution.length, 1);
  assert.equal(planned.execution[0]?.request, "2:0:ExecuteTask");
  assert.equal(planned.execution[0]?.kind, "SpawnWork");
  assert.equal(planned.execution[0]?.bundle?.bundle, "2:0:InputBundle");
  assert.equal(planned.execution[0]?.tasks.length, 1);
});

/**
 * How each command reaches a writer: a completion on the scheduler's
 * operation, a public command on its own. A release is left out, because it
 * owes nothing.
 */
function plannedInput(event: TicketCommand): DecisionInput | undefined {
  if (isCompletionTicketCommand(event))
    return {
      partition,
      ordinal: 1,
      deferredPasses: 0,
      priority: "Completion",
      source: {
        kind: "Operation",
        operation: asOperationId("completion"),
        command: { version: 1, command: "Decide", ticketCommand: event },
        ticketCommand: event,
      },
    };
  return event.type === "CreateTicket" ? undefined : input(event);
}

/** The input a command arrives in, for a command that arrives in one. */
function arrivedAs(event: TicketCommand): DecisionInput {
  const arrived = plannedInput(event);
  assert.ok(arrived !== undefined);
  return arrived;
}

/**
 * A work pass is one decision: the result is accepted and the first stage's
 * evaluators are owed at once, as one request named for the first of them.
 */
test("a work pass decides once and materializes its first stage under the obligation's identity", () => {
  const dispatched = walked(
    [
      createTicketCommand(wideDefinition),
      dispatchTicketCommand(id(1), aDispatchSource),
    ],
    { ...refinementInstance, nTasks: 3 },
  );
  const passed = decidedAt(dispatched, workDone(1), {
    ...refinementInstance,
    nTasks: 3,
  });
  assert.equal(passed.entry.event.type, "TicketWorkResultAccepted");
  assert.deepEqual(
    passed.obligations.map((owed) => owed.type),
    ["ExecuteTask", "ExecuteTask", "ExecuteTask"],
  );
  const planned = plannedAt(passed, arrivedAs(workDone(1)));
  assert.deepEqual(
    planned.execution.map((request) => [
      request.request,
      request.kind,
      request.effectPosition,
      request.bundle?.bundle,
      request.tasks.map((task) => task.identity),
    ]),
    [
      [
        "3:0:ExecuteTask",
        "SpawnEvaluation",
        0,
        "3:0:InputBundle",
        [1, 2, 3].map((evaluator) => evaluationTaskOf(1, 1, 1, 1, evaluator)),
      ],
    ],
  );
  assert.deepEqual(planned.actions, []);
  assert.deepEqual(planned.finalization, []);
});

/**
 * The wire number is the ticket's own running count and the task's place in
 * its set, so an evaluation stage takes a contiguous run above the work cycle
 * it judges and a rework starts above both.
 */
test("a ticket's task numbers ascend over its whole history and never repeat", () => {
  const history = [
    createTicketCommand(plainDefinitionOf(1)),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
    judged(1, 1, "EvaluatorFail"),
    workDone(2),
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
  history: readonly TicketCommand[],
  config: Config = { ...refinementInstance, nTasks: 3 },
): readonly { task: number; identity: TaskIdentity }[] {
  const minted: { task: number; identity: TaskIdentity }[] = [];
  let state = actorInit();
  for (const event of history) {
    const decided = decidedAt(state, event, config);
    state = decided.state;
    const arrived = plannedInput(event);
    if (arrived === undefined) continue;
    minted.push(
      ...plannedAt(decided, arrived).execution.flatMap((request) => [
        ...request.tasks,
      ]),
    );
  }
  return minted;
}

/** A release whose one stage lists evaluators 1 and 3 and no evaluator 2. */
const sparseDefinition = releasedTicketOf(1, new Set<number>(), [
  { key: 1, evaluators: [evaluatorOf(1), evaluatorOf(3)] },
]);

/**
 * The count a spawn spends is the set's size, so a sparse stage takes the two
 * numbers after the work task and the rework takes the one after those. Minted
 * by evaluator key instead, the stage would skip a number and the rework would
 * take the one the stage's second evaluator already holds.
 */
test("a sparse stage mints consecutive numbers and the set after it repeats none", () => {
  const minted = mintedUnder([
    createTicketCommand(sparseDefinition),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
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

/** A release whose one stage lists three evaluators, so a resume can re-ask one of them. */
const wideDefinition = releasedTicketOf(1, new Set<number>(), [
  { key: 1, evaluators: [evaluatorOf(1), evaluatorOf(2), evaluatorOf(3)] },
]);

/** One evaluator stopped rather than answering, which is what a resume comes back for. */
function stopped(cycle: number, evaluator: number, kind: FailureKind) {
  const judge = evaluationTaskOf(1, cycle, 1, 1, evaluator);
  return reportTaskTerminalCommand(stoppedReport(judge, kind));
}

/**
 * The count a run spends is its whole roster, generation by generation, so the
 * re-ask takes a number above every one the first pass minted rather than one
 * of the set it is resuming. Minted off the tasks dispatched instead, the lone
 * re-ask would land back inside its own stage's first run.
 */
test("a resume re-asks the stopped evaluator alone, at a number the first pass never held", () => {
  const minted = mintedUnder([
    createTicketCommand(wideDefinition),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
    judged(1, 1, "EvaluatorPass"),
    stopped(1, 2, "ProcessFailure"),
    judged(1, 3, "EvaluatorPass"),
    resumeTicketCommand(id(1)),
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
    createTicketCommand(sparseDefinition),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
    judged(1, 1, "EvaluatorPass"),
    revokeTicketCommand(id(1)),
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

/**
 * A passed work result moves the ticket onto the source it was accepted at and
 * opens the judgement over the reference its report carried: the instance
 * answers for that source, and every evaluator is asked under that reference as
 * its context. An evaluator's obligation is what the door has to rebuild, so
 * the two references are read here rather than trusted — and neither is the
 * cycle, which is what a rebuild that derived one would produce.
 */
test("a work pass carries its accepted source and its result into the judgement", () => {
  const passed = walked([
    createTicketCommand(plainDefinitionOf(1)),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
  ]);
  const ticket = ticketAt(memoryGraph(passed), id(1));
  assert.equal(ticket.source, anAcceptedSource);
  const instance = ticket.evaluations.at(-1);
  assert.ok(instance !== undefined);
  const reported = resultFor(workTaskOf(1, 1)).resultRef;
  assert.deepEqual(instance.input, {
    ticket: 1,
    workResult: reported,
    acceptedSourceRef: anAcceptedSource,
  });
  assert.deepEqual(artifactOf(ticket), {
    type: "ProducedArtifact",
    value: reported,
  });
  assert.deepEqual(
    liveObligations(ticket).map((owed) => owed.contextRef),
    [reported],
  );
  assert.notEqual(
    reported,
    taskRefOf(workTaskOf(1, 1)),
    "the judgement's context is the reported reference, not the cycle",
  );
});

test("a decision leaving escalation withdraws its open native action", () => {
  const escalated = walked([
    createTicketCommand(plainDefinitionOf(1)),
    dispatchTicketCommand(id(1), aDispatchSource),
    reportTaskTerminalCommand(
      stoppedReport(workTaskOf(1, 1), "ExecutionUnavailableFailure"),
    ),
  ]);
  const revoke = revokeTicketCommand(id(1));
  const planned = plannedAt(decidedAt(escalated, revoke), input(revoke));
  assert.deepEqual(planned.withdrawActionsFor, [id(1)]);
  assert.deepEqual(planned.execution, []);
});

/** A revoke owes a cancellation per live task, and they retire as one request named for the first. */
test("a revoke cancels the ticket's live tasks as one request", () => {
  const config = { ...refinementInstance, nTasks: 3 };
  const judging = walked(
    [
      createTicketCommand(sparseDefinition),
      dispatchTicketCommand(id(1), aDispatchSource),
      workDone(1),
    ],
    config,
  );
  const revoke = revokeTicketCommand(id(1));
  const revoked = decidedAt(judging, revoke, config);
  assert.equal(revoked.entry.event.type, "TicketRevoked");
  assert.deepEqual(
    revoked.obligations.map((owed) => owed.type),
    ["CancelTask", "CancelTask"],
  );
  assert.deepEqual(
    plannedAt(revoked, input(revoke)).execution.map((request) => [
      request.request,
      request.kind,
      request.bundle,
      request.tasks,
    ]),
    [
      [
        "4:0:CancelTask",
        "CancelTicketWork",
        undefined,
        [
          { task: 2, identity: evaluationTaskOf(1, 1, 1, 1, 1) },
          { task: 3, identity: evaluationTaskOf(1, 1, 1, 1, 3) },
        ],
      ],
    ],
  );
});

/** The state a ticket reaches by passing its whole program: one finalization awaiting a report. */
function finalizing(): ActorState {
  return walked([
    createTicketCommand(plainDefinitionOf(1)),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
    judged(1, 1, "EvaluatorPass"),
  ]);
}

/** A passing judgement owes the finalization, named for its obligation. */
test("a passing judgement materializes the finalization it owes", () => {
  const judging = walked([
    createTicketCommand(plainDefinitionOf(1)),
    dispatchTicketCommand(id(1), aDispatchSource),
    workDone(1),
  ]);
  const pass = judged(1, 1, "EvaluatorPass");
  const passed = decidedAt(judging, pass);
  assert.equal(passed.entry.event.type, "TicketEvaluationPassed");
  const planned = plannedAt(passed, arrivedAs(pass));
  assert.deepEqual(
    planned.finalization.map((request) => [
      request.request,
      request.effectPosition,
      request.requestGeneration,
    ]),
    [["4:0:FinalizeTicket", 0, 4]],
  );
  assert.deepEqual(planned.execution, []);
});

/** The input the one finalizer door mints, which carries no public command. */
function finalizationInput(event: TicketCommand): DecisionInput {
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
    deferredPasses: 0,
    priority: "Completion",
    source: {
      kind: "Operation",
      operation: asOperationId("operation"),
      command,
      ticketCommand: event,
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
  const result = reportFinalizationResultCommand(id(1), 1, 1, {
    type: "FinalizationNeedsWork",
    value: 1,
  });
  const planned = plannedAt(
    decidedAt(before, result),
    finalizationInput(result),
  );
  assert.deepEqual(planned.withdrawActionsFor, [id(1)]);
  assert.deepEqual(planned.fulfillFinalizationFor, [id(1)]);
  assert.equal(planned.execution[0]?.request, "5:0:ExecuteTask");
});

/** One ticket end to end: every command decided, and the last one fulfilling the request it concludes and owing nothing more. */
test("a ticket runs Work, Evaluation and Done, each step decided by its command", () => {
  const dispatched = walked([
    createTicketCommand(plainDefinitionOf(1)),
    dispatchTicketCommand(id(1), aDispatchSource),
  ]);
  assert.equal(ticketAt(memoryGraph(dispatched), id(1)).phase, "Work");
  const worked = decidedAt(dispatched, workDone(1));
  assert.equal(ticketAt(worked.after, id(1)).phase, "Evaluation");
  const passed = decidedAt(worked.state, judged(1, 1, "EvaluatorPass"));
  assert.equal(ticketAt(passed.after, id(1)).phase, "Finalization");
  const result = reportFinalizationResultCommand(id(1), 1, 1, {
    type: "FinalizationSucceeded",
    value: 1,
  });
  const done = decidedAt(passed.state, result);
  assert.equal(ticketAt(done.after, id(1)).phase, "Done");
  const planned = plannedAt(done, finalizationInput(result));
  assert.deepEqual(planned.fulfillFinalizationFor, [id(1)]);
  assert.deepEqual(planned.execution, []);
  assert.deepEqual(planned.finalization, []);
});

/** A judgement that parked its ticket, which owes nothing and opens the desk. */
function parkEntry(): Entry {
  const judge = evaluationTaskOf(1, 1, 1, 1, 1);
  return {
    seq: 4,
    event: {
      type: "TicketEvaluationFailureEscalated",
      value: {
        ticket: 1,
        report: judgedReport(judge, "EvaluatorFail"),
        evidence: [],
      },
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
      arrivedAs(judged(1, 1, "EvaluatorFail")),
      graphOf([]),
      post,
      parkEntry(),
      [],
    );
    assert.ok(retryableIn(post, id(1)), escalation);
    assert.equal(planned.actions[0]?.action, "4:TicketEscalation");
    assert.equal(planned.actions[0]?.escalation, escalation);
    assert.deepEqual(
      planned.actions[0]?.resolutions,
      ["Resume", "Revoke"],
      escalation,
    );
  }
});

test("a decision that leaves a ticket where it found it withdraws nothing", () => {
  const released = walked([createTicketCommand(plainDefinitionOf(1))]);
  const dispatch = dispatchTicketCommand(id(1), aDispatchSource);
  assert.deepEqual(
    plannedAt(decidedAt(released, dispatch), input(dispatch))
      .withdrawActionsFor,
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
      ticketCommand: asOperationTicketCommand(resumeTicketCommand(id(1))),
    },
  };
  assert.equal("admission" in submission, false);
  assert.equal("priority" in submission, false);
});
