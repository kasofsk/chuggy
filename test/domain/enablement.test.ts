/**
 * The enablement predicates, which the golden replay does not reach and cannot.
 *
 * A replayer routes on the action the trace recorded and hands the decider its
 * picks; it never asks whether the action was enabled, because the golden's
 * existence is that guarantee. So every one of these predicates is unexercised
 * by the corpus, and the mutant they exist to catch — a guard that drifted from
 * the one the machine consults — is invisible to it. This suite is the whole of
 * their evidence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canReleaseIn,
  completableIn,
  deliverableTasksIn,
  dependableIn,
  depArtifacts,
  depsDoneIn,
  doneIn,
  finalizableIn,
  finalizationOutcomes,
  finalizingIn,
  isBlockedIn,
  isReadyIn,
  outstandingTasksIn,
  outstandingTaskIn,
  quietIn,
  readiesIn,
  releasableIdsIn,
  retryableIn,
  retryablesIn,
  revocableIn,
  revocablesIn,
  waitsOn,
} from "../../src/domain/enablement.ts";
import {
  defaultPlan,
  evaluatorOf,
  releasedTicketOf,
  releasedTicketValid,
} from "../../src/domain/config.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  evaluationTaskOf,
  taskIdentityEquals,
  workTaskOf,
} from "../../src/domain/task.ts";
import type {
  ReleasedTicket,
  StageDefinition,
  TicketGraph,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { modelInstance } from "./configs.ts";
import {
  graphOf,
  depsOf,
  id,
  judgedInstance,
  rosterOf,
  runningInstance,
  ticketOn,
  workResultOf,
} from "./fixtures.ts";

const config = modelInstance;
const plan = defaultPlan(config);

/** An artifact mark, as a ticket that ran carries one. */
const produced = (value: number) =>
  ({ type: "ProducedArtifact", value }) as const;

/** A fleet under the sparse ids a release actually draws, which dense fixtures never build. */
function sparseGraph(entries: readonly [number, Ticket][]): TicketGraph {
  return { tickets: new Map(entries.map(([at, t]) => [id(at), t])) };
}

test("room for one more release runs out exactly at the fleet bound", () => {
  const fleet = Array.from({ length: config.nTickets }, () => ticketOn(config));
  assert.ok(canReleaseIn(config, graphOf([]), id(1)));
  assert.ok(canReleaseIn(config, graphOf(fleet.slice(0, -1)), id(3)));
  assert.ok(!canReleaseIn(config, graphOf(fleet), id(4)));
});

test("an id is claimable once: not outside the universe, and never again after", () => {
  const held = sparseGraph([
    [2, ticketOn(config)],
    [5, ticketOn(config, { phase: "Done" })],
  ]);
  assert.ok(canReleaseIn(config, held, id(4)));
  assert.ok(
    !canReleaseIn(config, held, asTicketId(config.nTickets * 2 + 1)),
    "the universe is finite, and a release draws from it",
  );
  assert.ok(!canReleaseIn(config, held, id(2)));
  assert.ok(
    !canReleaseIn(config, held, id(5)),
    "an id is never reused, so a settled ticket still holds its own",
  );
  assert.deepEqual(releasableIdsIn(config, held), [1, 3, 4, 6].map(id));
  assert.deepEqual(
    releasableIdsIn(
      config,
      graphOf([ticketOn(config), ticketOn(config), ticketOn(config)]),
    ),
    [],
    "a fleet at its bound offers nothing, whatever the universe still holds",
  );
});

test("a release may depend on anything but a tombstone", () => {
  const graph = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
    }),
  ]);
  assert.deepEqual(dependableIn(graph), [id(1), id(3)]);
});

test("the absorbing terminals and the point of no return are the unrevocable phases", () => {
  const graph = graphOf([
    ticketOn(config, { phase: "Pending" }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
    }),
    ticketOn(config, { phase: "Work" }),
    ticketOn(config, { phase: "Done" }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, { phase: "Finalization" }),
  ]);
  assert.deepEqual(revocablesIn(graph), [id(1), id(2), id(3)]);
  assert.ok(!revocableIn(graph, id(4)));
  assert.ok(!revocableIn(graph, id(5)));
  assert.ok(
    !revocableIn(graph, id(6)),
    "the finalizer is running, and nothing recalls it",
  );
});

test("a dependency that is not Done blocks, whatever else it is doing", () => {
  const blocked = graphOf([
    ticketOn(config, { phase: "Work" }),
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
  ]);
  assert.ok(isBlockedIn(blocked, id(2)));
  assert.ok(!isReadyIn(blocked, id(2)));
  assert.deepEqual(readiesIn(blocked), []);

  const landed = graphOf([
    ticketOn(config, { phase: "Done" }),
    ticketOn(config, { phase: "Pending", dependencies: depsOf(1) }),
  ]);
  assert.ok(isReadyIn(landed, id(2)));
  assert.ok(!isBlockedIn(landed, id(2)));
  assert.ok(depsDoneIn(landed, id(2)));
  assert.deepEqual(readiesIn(landed), [id(2)]);
});

test("what a ticket waits on is what its dependencies produced, read in id order", () => {
  const graph = sparseGraph([
    [
      1,
      ticketOn(config, {
        phase: "Done",
        evaluations: [judgedInstance(1, 1, plan)],
        workCyclesStarted: 1,
      }),
    ],
    [
      4,
      ticketOn(config, {
        phase: "Done",
        evaluations: [judgedInstance(4, 1, plan)],
        workCyclesStarted: 1,
      }),
    ],
    [
      6,
      ticketOn(config, {
        phase: "Pending",
        dependencies: depsOf(4, 1),
      }),
    ],
  ]);
  assert.deepEqual(
    [...waitsOn(graph, id(6))].sort((a, b) => a - b),
    [1, 4],
  );
  assert.deepEqual(
    depArtifacts(graph, id(6)),
    [produced(workResultOf(1, 1)), produced(workResultOf(4, 1))],
    "the read is ordered by dependency id, so it does not inherit a set's iteration order",
  );
});

test("a completion lands on a ticket owing a task, and on nothing else", () => {
  const graph = graphOf([
    ticketOn(config, {
      phase: "Work",
      workCyclesStarted: 1,
      spawned: 1,
    }),
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [runningInstance(2, 1, plan, new Set([1]))],
      workCyclesStarted: 1,
      spawned: 3,
    }),
    ticketOn(config, { phase: "Finalization" }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkFailureEscalated",
      workCyclesStarted: 1,
      spawned: 1,
    }),
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [judgedInstance(5, 1, plan)],
      workCyclesStarted: 1,
      spawned: 3,
    }),
  ]);
  assert.deepEqual(completableIn(graph), [id(1), id(2)]);
  assert.deepEqual(
    outstandingTasksIn(graph, id(4)),
    [],
    "a parked work cycle owes the fabric nothing",
  );
  assert.deepEqual(
    outstandingTasksIn(graph, id(5)),
    [],
    "a judgement that has settled owes nothing, whatever phase the ticket is in",
  );
});

test("the phase holding the finalizer obligation is the only one a result resolves from", () => {
  const graph = graphOf([
    ticketOn(config, { phase: "Finalization" }),
    ticketOn(config, { phase: "Evaluation" }),
    ticketOn(config, {
      phase: "Done",
      completions: 1,
    }),
  ]);
  assert.deepEqual(finalizingIn(graph), [id(1)]);
  assert.ok(finalizableIn(graph, id(1)));
  assert.ok(!finalizableIn(graph, id(2)));
  assert.ok(
    !finalizableIn(graph, asTicketId(9)),
    "a result for a ticket the fleet never held is refused rather than looked up",
  );
  assert.deepEqual(doneIn(graph), [id(3)]);
});

test("the fabric may still report on exactly the tasks a ticket has outstanding", () => {
  const graph = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [runningInstance(1, 1, plan, new Set([1]))],
      workCyclesStarted: 1,
      spawned: 3,
    }),
    ticketOn(config, { phase: "Pending" }),
  ]);
  assert.deepEqual(outstandingTasksIn(graph, id(1)), [
    evaluationTaskOf(1, 1, 1, 1, 2),
  ]);
  assert.ok(outstandingTaskIn(graph, id(1), evaluationTaskOf(1, 1, 1, 1, 2)));
  assert.ok(
    !outstandingTaskIn(graph, id(1), evaluationTaskOf(1, 1, 1, 1, 1)),
    "a duplicate for a resolved task matches nothing outstanding",
  );
  assert.ok(
    !outstandingTaskIn(graph, id(1), workTaskOf(1, 1)),
    "a stale delivery names the work task the judgement was opened over",
  );
  assert.deepEqual(outstandingTasksIn(graph, id(2)), []);
});

test("a park is retryable, and only a park is", () => {
  const parked = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "WorkExecutionUnavailableEscalated",
    }),
    ticketOn(config, {
      phase: "Escalated",
      escalation: "EvaluationBlockedEscalated",
    }),
    ticketOn(config, { phase: "Work" }),
  ]);
  assert.ok(retryableIn(parked, id(1)));
  assert.ok(retryableIn(parked, id(2)));
  assert.ok(
    !retryableIn(parked, id(3)),
    "a ticket that is not parked has nothing to resume from",
  );
  assert.deepEqual(retryablesIn(parked), [id(1), id(2)]);
});

test("the finalizer reports every lifecycle result", () => {
  assert.deepEqual(finalizationOutcomes, [
    "FinalizationSucceeded",
    "FinalizationNeedsWork",
    "FinalizationResultUnavailable",
  ]);
});

/** A release of ticket one under the default plan, which each case below varies. */
const releaseOfOne = releasedTicketOf(1, depsOf(), defaultPlan(config));

/** The same release, carrying the plan given. */
const stagedAs = (stages: readonly StageDefinition[]): ReleasedTicket => ({
  ...releaseOfOne,
  evaluationPlan: { stages },
});

/** One evaluator of the default plan, which a plan case repeats or rewrites. */
const anEvaluator = evaluatorOf(1);

test("a release draws every value it froze from a universe, and is refused outside one", () => {
  assert.ok(releasedTicketValid(config, releaseOfOne));
  assert.ok(!releasedTicketValid(config, stagedAs([])));
  assert.ok(
    !releasedTicketValid(
      config,
      stagedAs([{ key: 1, evaluators: [evaluatorOf(config.nTasks + 1)] }]),
    ),
    "an evaluator key may not pass the bound",
  );
  assert.ok(
    !releasedTicketValid(config, { ...releaseOfOne, content: 0 }),
    "and the content it froze is a reference, which zero is not",
  );
});

/**
 * The rest of the rule, conjunct by conjunct, because it is weighed nowhere
 * else: the released record is authored input, and a conjunct no case refutes
 * is one that could be deleted with every suite still green. The model's twin
 * refuses whole events, where the id and the dependency draw are dominated by
 * the guards in front of them; here the rule is a function, so nothing stands
 * in front of it.
 */
test("every remaining conjunct of the release rule refuses on its own", () => {
  assert.ok(!releasedTicketValid(config, { ...releaseOfOne, id: 0 }));
  assert.ok(
    !releasedTicketValid(config, {
      ...releaseOfOne,
      dependencies: new Set([0]),
    }),
    "nor is a ticket it waits on",
  );
  assert.ok(
    !releasedTicketValid(config, {
      ...releaseOfOne,
      workConfiguration: {
        ...releaseOfOne.workConfiguration,
        resultContract: 0,
      },
    }),
    "the work definition is a reference in every slot",
  );
  assert.ok(
    !releasedTicketValid(
      config,
      stagedAs([
        {
          key: 1,
          evaluators: [
            { ...anEvaluator, task: { ...anEvaluator.task, inputs: 0 } },
          ],
        },
      ]),
    ),
    "and so is an evaluator's own",
  );
  assert.ok(
    !releasedTicketValid(
      config,
      stagedAs([{ key: 1, evaluators: [anEvaluator, anEvaluator] }]),
    ),
    "a stage may not list one evaluator key twice",
  );
  assert.ok(
    !releasedTicketValid(
      config,
      stagedAs([{ key: 2, evaluators: [anEvaluator] }]),
    ),
    "a stage is keyed by its own position",
  );
  assert.ok(
    !releasedTicketValid(
      config,
      stagedAs(
        Array.from({ length: config.maxStages + 1 }, (_unused, index) => ({
          key: index + 1,
          evaluators: [anEvaluator],
        })),
      ),
    ),
    "and a plan may not run past the stage bound",
  );
  assert.ok(
    !releasedTicketValid(config, {
      ...releaseOfOne,
      finalizationConfiguration: 0,
    }),
  );
});

test("the stutter is enabled exactly on a fully-released fleet of terminals", () => {
  const settled = [
    ticketOn(config, {
      phase: "Done",
      completions: 1,
    }),
    ticketOn(config, { phase: "Revoked" }),
    ticketOn(config, {
      phase: "Done",
      completions: 1,
    }),
  ];
  assert.ok(quietIn(config, graphOf(settled)));
  assert.ok(
    !quietIn(config, graphOf(settled.slice(0, -1))),
    "room for a release means the author can still act",
  );
  assert.ok(
    !quietIn(
      config,
      graphOf([...settled.slice(0, -1), ticketOn(config, { phase: "Work" })]),
    ),
    "a live ticket means some other action is enabled",
  );
  assert.ok(
    !quietIn(
      config,
      graphOf([
        ...settled.slice(0, -1),
        ticketOn(config, {
          phase: "Escalated",
          escalation: "WorkFailureEscalated",
        }),
      ]),
    ),
    "a parked ticket is still revocable, so the desk can act",
  );
});

test("every task a ticket was ever owed is deliverable, and the live ones among them", () => {
  const graph = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [
        judgedInstance(1, 1, plan, () => "EvaluatorFail"),
        runningInstance(1, 2, plan, new Set([1])),
      ],
      workCyclesStarted: 2,
      spawned: 2 + 2 * rosterOf(plan),
    }),
  ]);
  const deliverable = deliverableTasksIn(graph, id(1));
  assert.deepEqual(deliverable.slice(0, 2), [
    workTaskOf(1, 1),
    workTaskOf(1, 2),
  ]);
  for (const live of outstandingTasksIn(graph, id(1)))
    assert.ok(
      deliverable.some((task) => taskIdentityEquals(task, live)),
      "a live task is one the ticket was owed",
    );
  assert.ok(
    deliverable.some((task) =>
      taskIdentityEquals(task, evaluationTaskOf(1, 1, 1, 1, 1)),
    ),
    "the earlier cycle's evaluator is still named, which is what a stale event is built from",
  );
});
