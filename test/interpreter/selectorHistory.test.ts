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
import { checkedSelectorHistoryQuery } from "../../src/interpreter/selectorHistory.ts";
import type { SelectorHistoryQuery } from "../../src/interpreter/selectorHistory.ts";

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
