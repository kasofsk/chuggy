/**
 * The decision log's own query rule, at the tier that owns it.
 *
 * THE ROUTE IS NOT THE ONLY CALLER. `src/adapters/http/server.ts` narrows the
 * wire's `order` before this ever sees it, so the two refusals below are the
 * ones a caller that is not the route would meet — and until they had a case,
 * neither of the two arms said which one enforced the rule.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { selectorHistoryLimitMax } from "../../src/contract/http.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { SelectorInteractionRecord } from "../../src/interpreter/selector.ts";
import {
  checkedSelectorHistoryQuery,
  selectorDecisionSummary,
} from "../../src/interpreter/selectorHistory.ts";
import type { SelectorHistoryQuery } from "../../src/interpreter/selectorHistory.ts";
import { selectorOperationalContext } from "./selectorFixture.ts";

test("a query the log can answer is returned as it stands", () => {
  const forward: SelectorHistoryQuery = {
    after: 4,
    limit: selectorHistoryLimitMax,
    order: "oldest",
  };
  assert.deepEqual(checkedSelectorHistoryQuery(forward), forward);
  const newest: SelectorHistoryQuery = { limit: 1, order: "newest" };
  assert.deepEqual(checkedSelectorHistoryQuery(newest), newest);
});

test("an order the roster does not name is refused, not guessed at", () => {
  for (const order of ["Newest", "sideways", "", "NEWEST"])
    assert.throws(() =>
      checkedSelectorHistoryQuery({
        limit: 1,
        order: order as SelectorHistoryQuery["order"],
      }),
    );
});

test("a cursor into the newest page is refused, because nothing follows it", () => {
  assert.throws(() =>
    checkedSelectorHistoryQuery({ after: 1, limit: 1, order: "newest" }),
  );
  assert.throws(
    () => checkedSelectorHistoryQuery({ after: 0, limit: 1, order: "newest" }),
    RangeError,
    "a cursor of zero is still a cursor",
  );
});

test("a page bound outside what the log answers is refused", () => {
  for (const limit of [0, -1, 1.5, selectorHistoryLimitMax + 1])
    assert.throws(() =>
      checkedSelectorHistoryQuery({ limit, order: "oldest" }),
    );
  for (const after of [-1, 2.5])
    assert.throws(() =>
      checkedSelectorHistoryQuery({ after, limit: 1, order: "oldest" }),
    );
});

const decisionRecord = (
  deliveries: SelectorInteractionRecord["deliveries"],
): SelectorInteractionRecord => ({
  ordinal: 4,
  decision: "selector-decision-one",
  partition: { tenant: asTenantId("tenant"), project: asProjectId("project") },
  instructionsVersion: "1.0",
  instructions: "prompt",
  observedView: [],
  context: {
    operationalContext: selectorOperationalContext,
    handoffNote: {},
  },
  toolActivity: [],
  result: { dispatches: [{ ticket: 41 }, { ticket: 42 }] },
  implementationRevision: "build",
  modelRevision: "model",
  policyRevision: "policy",
  accounting: {},
  deliveries,
  startedAt: "2026-09-03T00:00:00.000Z",
  completedAt: "2026-09-03T00:00:01.000Z",
});

/**
 * What a dispatch did is the delivery row, never the retained result: a
 * decision that chose two tickets and delivered one must not read as two, which
 * is what reading the result would have said.
 */
test("the log draws a dispatch from its delivery row and not from the result", () => {
  assert.deepEqual(
    selectorDecisionSummary(
      decisionRecord([
        { ticket: asTicketId(41), state: "Submitted" },
        {
          ticket: asTicketId(42),
          state: "Terminal",
          outcome: { state: "Refused", code: "SelectionChanged" },
        },
      ]),
    ).dispatches,
    [
      { ticket: 41, state: "Submitted" },
      { ticket: 42, state: "Terminal", outcome: "SelectionChanged" },
    ],
  );
  assert.deepEqual(
    selectorDecisionSummary(decisionRecord([])).dispatches,
    [],
    "a decision with no delivery row dispatched nothing, whatever it chose",
  );
});

/**
 * The outcome is the code where the operation named one, and otherwise the word
 * the settlement did carry — a delivery terminated at submission carries an
 * acceptance and no code at all.
 */
test("a settled dispatch says the code it settled on, or the word it has", () => {
  const outcomes = [
    { state: "Refused", code: "TicketChanged" },
    { state: "Succeeded", decidedSequence: 4 },
    { accepted: "InvalidCommand" },
    { unreadable: true },
  ].map(
    (outcome) =>
      selectorDecisionSummary(
        decisionRecord([{ ticket: asTicketId(7), state: "Terminal", outcome }]),
      ).dispatches[0]?.outcome,
  );
  assert.deepEqual(outcomes, [
    "TicketChanged",
    "Succeeded",
    "InvalidCommand",
    undefined,
  ]);
});
