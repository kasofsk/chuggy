/**
 * The turn a document takes among the others of its origin, over a lock
 * manager that is a double: what the browser's own would grant, keep waiting
 * or abandon is said by each case, so what is checked is what the port asks of
 * it and what it does where there is none.
 */

import { afterEach, expect, test, vi } from "vitest";

import { exclusively } from "../app/browser/ports.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface LockAsked {
  readonly name: string;
  readonly signal: AbortSignal;
}

/** A lock manager that grants at once, or keeps every request waiting until
 * the request's own signal abandons it. */
function lockManager(grants: boolean): { readonly asked: LockAsked[] } {
  const asked: LockAsked[] = [];
  vi.stubGlobal("navigator", {
    locks: {
      request: (
        name: string,
        options: { readonly signal: AbortSignal },
        granted: () => Promise<unknown>,
      ): Promise<unknown> => {
        asked.push({ name, signal: options.signal });
        if (grants) return granted();
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new Error("the request was abandoned"));
          });
        });
      },
    },
  });
  return { asked };
}

test("a browser with no lock manager runs the body at once", async () => {
  vi.stubGlobal("navigator", {});

  expect(await exclusively("turn", 1_000, () => Promise.resolve("ran"))).toBe(
    "ran",
  );
});

test("the body runs under the name it was asked under, and its answer is handed back", async () => {
  const manager = lockManager(true);

  expect(await exclusively("turn", 1_000, () => Promise.resolve("ran"))).toBe(
    "ran",
  );
  expect(manager.asked.map((asked) => asked.name)).toEqual(["turn"]);
});

test("a turn that does not come within the wait is abandoned, and the body never runs", async () => {
  vi.useFakeTimers();
  const manager = lockManager(false);
  let ran = false;

  const waiting = exclusively("turn", 1_000, () => {
    ran = true;
    return Promise.resolve();
  });
  const abandoned = expect(waiting).rejects.toThrow("abandoned");
  await vi.advanceTimersByTimeAsync(999);
  expect(manager.asked[0]?.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);

  await abandoned;
  expect(ran).toBe(false);
});

test("a turn that came is not abandoned by a body that outlasts the wait", async () => {
  vi.useFakeTimers();
  const manager = lockManager(true);
  let finish = (): void => undefined;

  const running = exclusively(
    "turn",
    1_000,
    () =>
      new Promise<string>((resolve) => {
        finish = () => {
          resolve("ran");
        };
      }),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  expect(manager.asked[0]?.signal.aborted).toBe(false);
  finish();

  expect(await running).toBe("ran");
});
