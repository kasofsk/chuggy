/**
 * The stand-in refetch loop, and where it stops.
 *
 * Both ends are checked: the budget, so a broken stream cannot poll forever,
 * and the abort, so `live` really does end it rather than leaving one running
 * behind the next.
 */

import { expect, test } from "vitest";

import {
  fallbackIntervalMs,
  fallbackRefetchesMax,
  runProjectFallback,
} from "../app/core/projectFallback.ts";

function waiter(): {
  readonly waitsMs: number[];
  readonly ports: {
    sleepMs: (ms: number, signal: AbortSignal) => Promise<void>;
  };
} {
  const waitsMs: number[] = [];
  return {
    waitsMs,
    ports: {
      sleepMs: (ms, signal) => {
        waitsMs.push(ms);
        return signal.aborted
          ? Promise.reject(new Error("abandoned"))
          : Promise.resolve();
      },
    },
  };
}

test("the loop refetches on its own interval and stops at the budget", async () => {
  const held = waiter();
  let refetches = 0;
  const end = await runProjectFallback(
    held.ports,
    () => {
      refetches += 1;
    },
    new AbortController().signal,
  );
  expect(end).toBe("Exhausted");
  expect(refetches).toBe(fallbackRefetchesMax);
  expect(held.waitsMs[0]).toBe(fallbackIntervalMs);
});

test("an abort ends the loop rather than letting it finish its budget", async () => {
  const held = waiter();
  const controller = new AbortController();
  let refetches = 0;
  const end = await runProjectFallback(
    held.ports,
    () => {
      refetches += 1;
      controller.abort();
    },
    controller.signal,
  );
  expect(end).toBe("Stopped");
  expect(refetches).toBe(1);
});

test("a loop aborted before it begins never refetches at all", async () => {
  const held = waiter();
  const controller = new AbortController();
  controller.abort();
  let refetches = 0;
  const end = await runProjectFallback(
    held.ports,
    () => {
      refetches += 1;
    },
    controller.signal,
  );
  expect(end).toBe("Stopped");
  expect(refetches).toBe(0);
});
