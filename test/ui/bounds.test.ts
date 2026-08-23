/**
 * The bounds the refresh loop and the paged reads run under.
 *
 * House rule 9 reaches the browser: every case below is a way the loop could
 * fail to terminate, and the assertion is that it stops.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  backoffDelayMs,
  jitteredDelayMs,
  pollDecision,
  pollDeferred,
  pollFailed,
  pollFailuresMax,
  pollIntervalMsBase,
  pollIntervalMsMax,
  pollJitterMsMax,
  pollPaused,
  pollResumed,
  pollStart,
  pollSucceeded,
  pollTicksMax,
  retryDelayMs,
} from "../../ui/app/polling.js";
import {
  pagingItemsMax,
  pagingPagesMax,
  pagingStart,
  pagingStep,
} from "../../ui/app/paging.js";

test("backoff doubles from the base and stops at the ceiling", () => {
  assert.equal(backoffDelayMs(0), pollIntervalMsBase);
  assert.equal(backoffDelayMs(1), pollIntervalMsBase);
  assert.equal(backoffDelayMs(2), pollIntervalMsBase * 2);
  assert.equal(backoffDelayMs(3), pollIntervalMsBase * 4);
  for (let failures = 0; failures <= pollFailuresMax * 4; failures += 1) {
    assert.ok(backoffDelayMs(failures) <= pollIntervalMsMax);
  }
  assert.throws(() => backoffDelayMs(-1), RangeError);
});

test("a server-named delay is honoured and still bounded", () => {
  assert.equal(retryDelayMs(3), 3_000);
  assert.equal(retryDelayMs(0), 1_000);
  assert.equal(retryDelayMs(10_000), pollIntervalMsMax);
});

test("jitter only ever adds, and never more than its own ceiling", () => {
  assert.equal(jitteredDelayMs(1_000, 0), 1_000);
  assert.ok(jitteredDelayMs(1_000, 0.999) < 1_000 + pollJitterMsMax);
  assert.throws(() => jitteredDelayMs(1_000, 1), RangeError);
});

test("a loop that keeps failing stops inside the failure budget", () => {
  let state = pollStart();
  let polls = 0;
  while (pollDecision(state, pollIntervalMsMax).action === "Poll") {
    state = pollFailed(state);
    polls += 1;
    assert.ok(
      polls <= pollFailuresMax,
      "the failure budget did not stop the loop",
    );
  }
  assert.deepEqual(pollDecision(state, pollIntervalMsMax), {
    action: "Stopped",
    reason: "Failures",
  });
});

test("a loop that keeps succeeding stops at the tick budget", () => {
  let state = pollStart();
  let polls = 0;
  while (pollDecision(state, pollIntervalMsMax).action === "Poll") {
    state = pollSucceeded(state);
    polls += 1;
    assert.ok(polls <= pollTicksMax, "the tick budget did not stop the loop");
  }
  assert.equal(polls, pollTicksMax);
  assert.deepEqual(pollDecision(state, pollIntervalMsMax), {
    action: "Stopped",
    reason: "Ticks",
  });
});

test("a paused loop is stopped until an operator resumes it", () => {
  const paused = pollPaused(pollStart());
  assert.deepEqual(pollDecision(paused, pollIntervalMsMax), {
    action: "Stopped",
    reason: "Paused",
  });
  assert.equal(
    pollDecision(pollResumed(paused), pollIntervalMsMax).action,
    "Poll",
  );
});

test("a read before its time waits by exactly the time remaining", () => {
  assert.deepEqual(pollDecision(pollStart(), 1_000), {
    action: "Wait",
    delayMs: pollIntervalMsBase - 1_000,
  });
  assert.deepEqual(pollDecision(pollDeferred(pollStart(), 30), 0), {
    action: "Wait",
    delayMs: 30_000,
  });
});

test("paging follows the continuation token past a short page", () => {
  let state = pagingStart();
  const first = pagingStep(state, { items: ["a"], next: "cursor-1" });
  assert.equal(first.done, false);
  assert.equal(first.done === false ? first.next : undefined, "cursor-1");
  state = first.done === false ? first.state : state;
  const second = pagingStep(state, { items: ["b", "c"], next: undefined });
  assert.deepEqual(second, {
    done: true,
    items: ["a", "b", "c"],
    truncated: false,
  });
});

test("paging stops at its page ceiling and says it was truncated", () => {
  let state = pagingStart();
  let pages = 0;
  for (;;) {
    const stepped = pagingStep(state, { items: ["x"], next: "more" });
    pages += 1;
    if (stepped.done) {
      assert.equal(stepped.truncated, true);
      assert.equal(pages, pagingPagesMax);
      return;
    }
    state = stepped.state;
    assert.ok(pages < pagingPagesMax, "the page ceiling did not stop the walk");
  }
});

test("paging stops at its item ceiling", () => {
  const items = Array.from({ length: pagingItemsMax + 1 }, (_, index) => index);
  const stepped = pagingStep(pagingStart(), { items, next: "more" });
  assert.equal(stepped.done, true);
  assert.equal(stepped.done ? stepped.items.length : 0, pagingItemsMax);
});
