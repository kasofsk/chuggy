/**
 * The structural equalities held to the shapes they claim to compare: one
 * roster per product type, typed `Record<keyof Shape, ...>`, and every field in
 * it shown to change the answer.
 *
 * A HAND-ROLLED EQUALITY FAILS BY OMISSION, and the omission is silent: the
 * conjunction still compiles, still returns a boolean, and answers `true` on
 * two values that differ in the field nobody added a conjunct for. Downstream
 * that is `recoveryComplete` green on a state the journal cannot rebuild and
 * `journalLegalOn` accepting a forged record — so the roster's type is what
 * makes a field added to a domain type a compile error here, and the loop below
 * is what makes a field named in the roster but unread by the conjunction a
 * failure.
 *
 * `recordEqualsTransition` and `ticketEqualsStage` are not exported, so their
 * rosters are lifted into the exported comparison that reaches them — a
 * transition inside a record, a stage inside a ticket's plan, and the
 * protocol's own shapes inside the instance the ticket carries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { recordEquals, ticketEquals } from "../../src/actor/equality.ts";
import { instanceEquals } from "../../src/domain/evaluation.ts";
import { initRecord } from "../../src/domain/ticketGraph.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import { id, judgedInstance, workOutstanding } from "../domain/fixtures.ts";
import { flatPlan, plainDefinition } from "./harness.ts";
import { evaluatorOf, evaluatorTaskOf } from "../../src/domain/config.ts";
import type {
  EvaluationInput,
  EvaluationInstance,
  EvaluationProgress,
  EvaluatorDefinition,
  ReleasedTicket,
  StageDefinition,
  StageRun,
  StepRecord,
  Ticket,
  Transition,
} from "../../src/domain/generated/modelTypes.ts";

/** One mutation per declared field of a shape; a roster short a field does not compile. */
type FieldMutants<Shape> = Record<keyof Shape, (value: Shape) => Shape>;

/** The base value is equal to itself, and every field the roster declares changes that answer. */
function assertDiscriminates<Shape>(
  base: Shape,
  equals: (left: Shape, right: Shape) => boolean,
  mutants: FieldMutants<Shape>,
): void {
  const fields = Object.keys(mutants) as (keyof Shape)[];
  assert.ok(fields.length > 0, "the roster declares no field");
  assert.ok(equals(base, base), "the base value is not equal to itself");
  for (const field of fields) {
    assert.ok(
      !equals(base, mutants[field](base)),
      `${String(field)}: the equality does not read this field`,
    );
  }
}

const baseTicket: Ticket = freshTicket(plainDefinition);

/** A judgement of one cycle, which is the smallest instance a ticket can carry. */
const judged: EvaluationInstance = judgedInstance(1, 1, flatPlan);

/** A ticket carrying this definition, which is how a definition is compared at all. */
const carrying = (definition: ReleasedTicket): Ticket => ({
  ...baseTicket,
  definition,
});

const definitionMutants: FieldMutants<ReleasedTicket> = {
  id: (d) => ({ ...d, id: d.id + 1 }),
  content: (d) => ({ ...d, content: d.content + 1 }),
  dependencies: (d) => ({ ...d, dependencies: new Set([2]) }),
  workConfiguration: (d) => ({
    ...d,
    workConfiguration: { ...d.workConfiguration, workload: 0 },
  }),
  evaluationPlan: (d) => ({ ...d, evaluationPlan: { stages: [] } }),
  finalizationConfiguration: (d) => ({
    ...d,
    finalizationConfiguration: d.finalizationConfiguration + 1,
  }),
};

const ticketMutants: FieldMutants<Ticket> = {
  phase: (t) => ({ ...t, phase: "Done" }),
  definition: (t) => ({ ...t, definition: definitionMutants.id(t.definition) }),
  source: (t) => ({ ...t, source: t.source + 1 }),
  artifact: (t) => ({
    ...t,
    artifact: { type: "ProducedArtifact", value: 1 },
  }),
  tasks: (t) => ({ ...t, tasks: new Set([workOutstanding(1, 1)]) }),
  evaluations: (t) => ({ ...t, evaluations: [judged] }),
  workCyclesStarted: (t) => ({
    ...t,
    workCyclesStarted: t.workCyclesStarted + 1,
  }),
  spawned: (t) => ({ ...t, spawned: t.spawned + 1 }),
  escalation: (t) => ({ ...t, escalation: "WorkFailureEscalated" }),
  completions: (t) => ({ ...t, completions: t.completions + 1 }),
};

const recordMutants: FieldMutants<StepRecord> = {
  label: (r) => ({ ...r, label: "ticket-done" }),
  transitions: (r) => ({
    ...r,
    transitions: [{ ticket: id(1), from: "Pending", to: "Work" }],
  }),
  effects: (r) => ({ ...r, effects: ["SpawnWorkTasks"] }),
};

const baseTransition: Transition = {
  ticket: id(1),
  from: "Work",
  to: "Evaluation",
};

const transitionMutants: FieldMutants<Transition> = {
  ticket: (t) => ({ ...t, ticket: id(2) }),
  from: (t) => ({ ...t, from: "Pending" }),
  to: (t) => ({ ...t, to: "Done" }),
};

const baseStage: StageDefinition = { key: 1, evaluators: [evaluatorOf(1)] };

const stageMutants: FieldMutants<StageDefinition> = {
  key: (s) => ({ ...s, key: s.key + 1 }),
  evaluators: (s) => ({ ...s, evaluators: [evaluatorOf(2)] }),
};

const evaluatorMutants: FieldMutants<EvaluatorDefinition> = {
  key: (e) => ({ ...e, key: e.key + 1 }),
  task: (e) => ({ ...e, task: evaluatorTaskOf(e.key + 1) }),
};

const inputMutants: FieldMutants<EvaluationInput> = {
  ticket: (i) => ({ ...i, ticket: i.ticket + 1 }),
  workResult: (i) => ({ ...i, workResult: i.workResult + 1 }),
  acceptedSourceRef: (i) => ({
    ...i,
    acceptedSourceRef: i.acceptedSourceRef + 1,
  }),
};

const instanceMutants: FieldMutants<EvaluationInstance> = {
  workCycle: (i) => ({ ...i, workCycle: i.workCycle + 1 }),
  input: (i) => ({ ...i, input: { ...i.input, workResult: 2 } }),
  plan: (i) => ({ ...i, plan: { stages: [] } }),
  state: (i) => ({ ...i, state: { type: "EvaluationFailed", value: [] } }),
};

const baseRun: StageRun = {
  stageIndex: 0,
  generation: 1,
  evaluators: new Map([[1, "Awaiting"]]),
};

const runMutants: FieldMutants<StageRun> = {
  stageIndex: (r) => ({ ...r, stageIndex: r.stageIndex + 1 }),
  generation: (r) => ({ ...r, generation: r.generation + 1 }),
  evaluators: (r) => ({
    ...r,
    evaluators: new Map([
      [1, { type: "Produced", value: { type: "EvaluatorPassed", value: 1 } }],
    ]),
  }),
};

const baseProgress: EvaluationProgress = {
  completedStages: [],
  stage: baseRun,
};

const progressMutants: FieldMutants<EvaluationProgress> = {
  completedStages: (p) => ({ ...p, completedStages: [baseRun] }),
  stage: (p) => ({ ...p, stage: runMutants.generation(baseRun) }),
};

/** The instance in the state that carries a progress, which is how a run is reached. */
function running(progress: EvaluationProgress): EvaluationInstance {
  return { ...judged, state: { type: "Running", value: progress } };
}

test("ticketEquals reads every field Ticket declares", () => {
  assertDiscriminates(baseTicket, ticketEquals, ticketMutants);
});

test("recordEquals reads every field StepRecord declares", () => {
  assertDiscriminates(initRecord, recordEquals, recordMutants);
});

test("the transition comparison reads every field Transition declares", () => {
  const inRecord = (transition: Transition): StepRecord => ({
    ...initRecord,
    transitions: [transition],
  });
  assertDiscriminates(
    baseTransition,
    (left, right) => recordEquals(inRecord(left), inRecord(right)),
    transitionMutants,
  );
});

test("the definition comparison reads every field ReleasedTicket declares", () => {
  assertDiscriminates(
    plainDefinition,
    (left, right) => ticketEquals(carrying(left), carrying(right)),
    definitionMutants,
  );
});

test("the stage comparison reads every field StageDefinition declares", () => {
  const inTicket = (stage: StageDefinition): Ticket =>
    carrying({
      ...plainDefinition,
      evaluationPlan: { stages: [stage] },
    });
  assertDiscriminates(
    baseStage,
    (left, right) => ticketEquals(inTicket(left), inTicket(right)),
    stageMutants,
  );
});

test("the evaluator comparison reads every field EvaluatorDefinition declares", () => {
  const inTicket = (entry: EvaluatorDefinition): Ticket =>
    carrying({
      ...plainDefinition,
      evaluationPlan: { stages: [{ key: 1, evaluators: [entry] }] },
    });
  assertDiscriminates(
    evaluatorOf(1),
    (left, right) => ticketEquals(inTicket(left), inTicket(right)),
    evaluatorMutants,
  );
});

test("instanceEquals reads every field EvaluationInstance declares", () => {
  assertDiscriminates(judged, instanceEquals, instanceMutants);
});

test("instanceEquals reads every field EvaluationInput declares", () => {
  const withInput = (input: EvaluationInput): EvaluationInstance => ({
    ...judged,
    input,
  });
  assertDiscriminates(
    judged.input,
    (left, right) => instanceEquals(withInput(left), withInput(right)),
    inputMutants,
  );
});

test("the progress comparison reads every field EvaluationProgress declares", () => {
  assertDiscriminates(
    baseProgress,
    (left, right) => instanceEquals(running(left), running(right)),
    progressMutants,
  );
});

test("the run comparison reads every field StageRun declares", () => {
  const inProgress = (run: StageRun): EvaluationInstance =>
    running({ ...baseProgress, stage: run });
  assertDiscriminates(
    baseRun,
    (left, right) => instanceEquals(inProgress(left), inProgress(right)),
    runMutants,
  );
  const produced = (mark: number): StageRun => ({
    ...baseRun,
    evaluators: new Map([
      [
        1,
        { type: "Produced", value: { type: "EvaluatorPassed", value: mark } },
      ],
    ]),
  });
  assert.ok(
    !instanceEquals(inProgress(produced(1)), inProgress(produced(2))),
    "what a produced status produced is part of the status",
  );
});

test("a list of equal length is compared member by member, not by length alone", () => {
  const twice = (stage: StageDefinition): Ticket =>
    carrying({
      ...plainDefinition,
      evaluationPlan: { stages: [stage, stage] },
    });
  assert.ok(
    !ticketEquals(twice(baseStage), twice(stageMutants.evaluators(baseStage))),
  );
});

test("each variant arm's payload is compared, not only its tag", () => {
  const marked = (mark: number): Ticket => ({
    ...baseTicket,
    artifact: { type: "ProducedArtifact", value: mark },
  });
  assert.ok(!ticketEquals(marked(1), marked(2)));
  assert.ok(
    !ticketEquals(marked(1), { ...baseTicket, artifact: "NoArtifact" }),
  );
});
