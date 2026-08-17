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
 * transition inside a record, a stage inside a ticket's program.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { recordEquals, ticketEquals } from "../../src/actor/equality.ts";
import {
  initRecord,
  type StepRecord,
  type Transition,
} from "../../src/domain/core.ts";
import { freshTicket } from "../../src/domain/deciders.ts";
import { asProjectId } from "../../src/domain/ids.ts";
import type { Stage } from "../../src/domain/program.ts";
import type { Ticket } from "../../src/domain/ticket.ts";
import {
  aNone,
  aSome,
  wNone,
  wExclusive,
  woAttempt,
} from "../../src/domain/wrapUp.ts";
import { depsOf, id, workRunning, workTask } from "../domain/fixtures.ts";
import { flatProgram, refinementInstance } from "./harness.ts";

const config = refinementInstance;

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

const baseTicket: Ticket = freshTicket(
  config,
  depsOf(),
  flatProgram,
  asProjectId(1),
  wExclusive(1),
);

const ticketMutants: FieldMutants<Ticket> = {
  phase: (t) => ({ ...t, phase: "PDone" }),
  deps: (t) => ({ ...t, deps: [id(2)] }),
  wrapUp: (t) => ({ ...t, wrapUp: wNone }),
  artifact: (t) => ({ ...t, artifact: aSome(1) }),
  project: (t) => ({ ...t, project: asProjectId(2) }),
  program: (t) => ({ ...t, program: [] }),
  tasks: (t) => ({ ...t, tasks: [workRunning(1)] }),
  record: (t) => ({ ...t, record: [workTask(1, "TPassed")] }),
  spawned: (t) => ({ ...t, spawned: t.spawned + 1 }),
  reworkLeft: (t) => ({ ...t, reworkLeft: t.reworkLeft + 1 }),
  wrapUpLeft: (t) => ({ ...t, wrapUpLeft: t.wrapUpLeft + 1 }),
  gasLeft: (t) => ({ ...t, gasLeft: t.gasLeft + 1 }),
  resumeAt: (t) => ({ ...t, resumeAt: "RWorking" }),
  reason: (t) => ({ ...t, reason: "RsWorkFailed" }),
};

const recordMutants: FieldMutants<StepRecord> = {
  label: (r) => ({ ...r, label: "ticket-done" }),
  transitions: (r) => ({
    ...r,
    transitions: [{ ticket: id(1), from: "PDraft", to: "PPending" }],
  }),
  effects: (r) => ({ ...r, effects: ["Complete"] }),
  attempt: (r) => ({ ...r, attempt: woAttempt(asProjectId(1), true) }),
};

const baseTransition: Transition = {
  ticket: id(1),
  from: "PWorking",
  to: "PEvaluating",
};

const transitionMutants: FieldMutants<Transition> = {
  ticket: (t) => ({ ...t, ticket: id(2) }),
  from: (t) => ({ ...t, from: "PPending" }),
  to: (t) => ({ ...t, to: "PDone" }),
};

const baseStage: Stage = { fanout: 1, combinator: "CUnanimousPass" };

const stageMutants: FieldMutants<Stage> = {
  fanout: (s) => ({ ...s, fanout: s.fanout + 1 }),
  combinator: (s) => ({ ...s, combinator: "CAnyPass" }),
};

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

test("the stage comparison reads every field Stage declares", () => {
  const inTicket = (stage: Stage): Ticket => ({
    ...baseTicket,
    program: [stage],
  });
  assertDiscriminates(
    baseStage,
    (left, right) => ticketEquals(inTicket(left), inTicket(right)),
    stageMutants,
  );
});

test("a list of equal length is compared member by member, not by length alone", () => {
  const twice = (stage: Stage): Ticket => ({
    ...baseTicket,
    program: [stage, stage],
  });
  assert.ok(
    !ticketEquals(twice(baseStage), twice(stageMutants.combinator(baseStage))),
  );
});

test("each variant arm's payload is compared, not only its tag", () => {
  const attempted = (project: number, invalidated: boolean): StepRecord => ({
    ...initRecord,
    attempt: woAttempt(asProjectId(project), invalidated),
  });
  assert.ok(!recordEquals(attempted(1, true), attempted(2, true)));
  assert.ok(!recordEquals(attempted(1, true), attempted(1, false)));
  const marked = (mark: number): Ticket => ({
    ...baseTicket,
    artifact: aSome(mark),
  });
  assert.ok(!ticketEquals(marked(1), marked(2)));
  assert.ok(!ticketEquals(marked(1), { ...baseTicket, artifact: aNone }));
});
