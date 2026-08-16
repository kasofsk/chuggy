/**
 * The structural comparison the replayer reports its findings through.
 *
 * WHAT A COMPARER HAS TO GET RIGHT IS NOT "EQUAL VALUES COMPARE EQUAL" — that
 * is the easy half and a corpus exercises it on every green run. It is the
 * other half: every field that CAN differ must be seen to differ. A comparer
 * that silently skipped one field would report a replay as green forever, and
 * that field is exactly where a decider defect would hide. So the `Ticket` case
 * below walks its whole field roster, one mutation per field, and requires each
 * to be reported under its own path.
 *
 * The set-valued fields are pinned as sets, because the values they are
 * compared against come out of ITF documents that carry no order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { core, jDraft, jWork, solo, wt } from "../domain/fixtures.test.ts";
import type { StepRecord, Task, Ticket } from "../domain/measure.ts";
import { diffCore, diffRecords, diffStepRecord } from "./compare.ts";

const record: StepRecord = {
  label: "dispatch",
  transitions: [{ ticket: 1, from: "PPending", to: "PWorking" }],
  effects: ["SpawnWorkTasks"],
  attempt: { tag: "WOAttempt", project: 2, invalidated: true },
};

test("diffStepRecord: identical records agree, and every field can disagree", () => {
  assert.equal(diffStepRecord(record, record, "rec"), undefined);
  const rows: readonly (readonly [string, StepRecord])[] = [
    ["rec.label", { ...record, label: "task-done" }],
    ["rec.transitions", { ...record, transitions: [] }],
    [
      "rec.transitions[0].ticket",
      {
        ...record,
        transitions: [{ ticket: 2, from: "PPending", to: "PWorking" }],
      },
    ],
    [
      "rec.transitions[0].from",
      {
        ...record,
        transitions: [{ ticket: 1, from: "PDraft", to: "PWorking" }],
      },
    ],
    [
      "rec.transitions[0].to",
      {
        ...record,
        transitions: [{ ticket: 1, from: "PPending", to: "PDone" }],
      },
    ],
    ["rec.effects[0]", { ...record, effects: ["Complete"] }],
    ["rec.attempt", { ...record, attempt: { tag: "WONone" } }],
    [
      "rec.attempt.project",
      {
        ...record,
        attempt: { tag: "WOAttempt", project: 1, invalidated: true },
      },
    ],
    [
      "rec.attempt.invalidated",
      {
        ...record,
        attempt: { tag: "WOAttempt", project: 2, invalidated: false },
      },
    ],
  ];
  for (const [path, mutated] of rows) {
    const difference = diffStepRecord(record, mutated, "rec");
    assert.ok(difference !== undefined, path);
    assert.ok(difference.startsWith(path), `${path}: got ${difference}`);
  }
});

test("diffCore: every Ticket field is compared, one mutation each", () => {
  const before = solo(jWork);
  assert.equal(diffCore(before, before, "c"), undefined);
  // ONE ROW PER FIELD of `model/measure.qnt`'s Ticket, in its declaration
  // order. A field with no row here is a field this comparer could be blind to.
  const rows: readonly (readonly [string, Partial<Ticket>])[] = [
    ["phase", { phase: "PDone" }],
    ["deps", { deps: new Set([7]) }],
    ["wrapUp", { wrapUp: { tag: "WNone" } }],
    ["artifact", { artifact: { tag: "ASome", id: 1 } }],
    ["project", { project: 2 }],
    ["program", { program: [{ fanout: 1, combinator: "CAnyPass" }] }],
    ["tasks", { tasks: [wt(1, "TPassed"), wt(2, "TFailed")] }],
    ["record", { record: [wt(1, "TPassed")] }],
    ["spawned", { spawned: 9 }],
    // The fixture is part-spent, so each account mutation below moves it.
    ["reworkLeft", { reworkLeft: 1 }],
    ["wrapUpLeft", { wrapUpLeft: 0 }],
    ["gasLeft", { gasLeft: 0 }],
    ["resumeAt", { resumeAt: "RWorking" }],
    ["reason", { reason: "RsGasExhausted" }],
    ["completions", { completions: 1 }],
  ];
  const fields = new Set<string>();
  for (const [field, mutation] of rows) {
    fields.add(field);
    const difference = diffCore(before, solo({ ...jWork, ...mutation }), "c");
    assert.ok(difference !== undefined, field);
    assert.ok(
      difference.startsWith(`c.tickets[1].${field}`),
      `${field}: got ${difference}`,
    );
  }
  assert.deepEqual(fields, new Set(Object.keys(jWork)));
});

test("diffCore: a fleet with an id too many or too few is reported by id", () => {
  const one = solo(jDraft);
  const two = core([
    [1, jDraft],
    [2, jDraft],
  ]);
  assert.ok(diffCore(one, two, "c")?.includes("unexpected ids [2]"));
  assert.ok(diffCore(two, one, "c")?.includes("expected ids [2]"));
});

test("diffCore: a Set[int] is compared as a set, never by order", () => {
  const forwards = solo({ ...jDraft, deps: new Set([1, 2]) });
  const backwards = solo({ ...jDraft, deps: new Set([2, 1]) });
  assert.equal(diffCore(forwards, backwards, "c"), undefined);
});

test("diffRecords: the ghost is compared per ticket and elementwise", () => {
  const task: Task = wt(1, "TPassed");
  const before = new Map([[1, [task]]]);
  assert.equal(diffRecords(before, new Map([[1, [task]]]), "prev"), undefined);
  assert.ok(
    diffRecords(before, new Map([[1, []]]), "prev")?.includes("entries"),
  );
  assert.ok(
    diffRecords(before, new Map([[1, [wt(1, "TFailed")]]]), "prev")?.includes(
      "state.outcome",
    ),
  );
  assert.ok(
    diffRecords(before, new Map(), "prev")?.includes("expected ids [1]"),
  );
  assert.ok(
    diffRecords(new Map(), new Map([[2, []]]), "prev")?.includes(
      "unexpected ids [2]",
    ),
  );
});
