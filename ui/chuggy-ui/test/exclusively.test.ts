/**
 * The turn a document takes among the others of its origin, over a lock
 * manager that is a double: what the browser's own would grant, keep waiting
 * or abandon is said by each case, so what is checked is what the port asks of
 * it and what it does where there is none.
 *
 * A document is hidden and shown here by the events a browser tells it with as
 * it leaves for another page and is come back to, which is all the port hears
 * of either.
 */

import { afterEach, expect, test, vi } from "vitest";

import { exclusively } from "../app/browser/ports.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What the lock manager here rejects a request with once it is abandoned. */
const abandoned = "the request was abandoned";

interface LockAsked {
  readonly name: string;
  readonly signal: AbortSignal;
  /** Gives this request its turn, as the browser does when the lock is free. */
  readonly grant: () => void;
}

/** A lock manager that grants at once, or keeps every request waiting until
 * it is granted or the request's own signal abandons it. */
function lockManager(grants: boolean): { readonly asked: LockAsked[] } {
  const asked: LockAsked[] = [];
  vi.stubGlobal("navigator", {
    locks: {
      request: (
        name: string,
        options: { readonly signal: AbortSignal },
        granted: () => Promise<unknown>,
      ): Promise<unknown> => {
        if (grants) {
          asked.push({ name, signal: options.signal, grant: () => undefined });
          return granted();
        }
        return new Promise((resolve, reject) => {
          asked.push({
            name,
            signal: options.signal,
            grant: () => {
              resolve(granted());
            },
          });
          options.signal.addEventListener("abort", () => {
            reject(new Error(abandoned));
          });
        });
      },
    },
  });
  return { asked };
}

/** Whether a promise has settled by the time everything able to run has. */
async function pending(asked: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  asked.then(mark, mark);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return !settled;
}

/** What a wait has come to, read without waiting on it: one that nothing
 * abandons never settles, and the clock that would end its case is faked. */
function outcome(waiting: Promise<unknown>): { said: string } {
  const held = { said: "waiting" };
  waiting.then(
    () => {
      held.said = "ran";
    },
    (failure: unknown) => {
      held.said = failure instanceof Error ? failure.message : "failed";
    },
  );
  return held;
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
  const came = outcome(waiting);
  await vi.advanceTimersByTimeAsync(999);
  expect(manager.asked[0]?.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);

  expect(came.said).toBe(abandoned);
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

test("a document hidden while it waits gives the wait up, asks afresh when it is shown again, and runs when that turn comes", async () => {
  const manager = lockManager(false);
  let ran = false;

  const waiting = exclusively("turn", 1_000, () => {
    ran = true;
    return Promise.resolve("ran");
  });
  dispatchEvent(new Event("pagehide"));

  expect(manager.asked.map((asked) => asked.signal.aborted)).toEqual([true]);
  expect(await pending(waiting)).toBe(true);
  expect(ran).toBe(false);
  dispatchEvent(new Event("pageshow"));

  expect(manager.asked.map((asked) => asked.name)).toEqual(["turn", "turn"]);
  expect(manager.asked[1]?.signal.aborted).toBe(false);
  manager.asked[1]?.grant();
  expect(await waiting).toBe("ran");
});

test("a document shown while it still waits does not ask twice", async () => {
  const manager = lockManager(false);

  const waiting = exclusively("turn", 1_000, () => Promise.resolve("ran"));
  dispatchEvent(new Event("pageshow"));

  expect(manager.asked).toHaveLength(1);
  manager.asked[0]?.grant();
  expect(await waiting).toBe("ran");
});

test("the wait does not run on while the document is hidden, and is whole again when it is shown", async () => {
  vi.useFakeTimers();
  const manager = lockManager(false);

  const came = outcome(
    exclusively("turn", 1_000, () => Promise.resolve("ran")),
  );
  await vi.advanceTimersByTimeAsync(900);
  dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(5_000);
  dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(999);
  expect(manager.asked[1]?.signal.aborted).toBe(false);
  expect(came.said).toBe("waiting");
  await vi.advanceTimersByTimeAsync(1);

  expect(came.said).toBe(abandoned);
  expect(manager.asked).toHaveLength(2);
});

test("a document hidden once its turn has come keeps it, and one whose turn is over asks nothing more", async () => {
  const manager = lockManager(false);
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
  manager.asked[0]?.grant();
  dispatchEvent(new Event("pagehide"));
  dispatchEvent(new Event("pageshow"));
  expect(manager.asked[0]?.signal.aborted).toBe(false);
  finish();

  expect(await running).toBe("ran");
  dispatchEvent(new Event("pagehide"));
  dispatchEvent(new Event("pageshow"));
  expect(manager.asked).toHaveLength(1);
});

test("a wait given up for good leaves nothing listening for the document to be shown", async () => {
  vi.useFakeTimers();
  const manager = lockManager(false);

  const came = outcome(
    exclusively("turn", 1_000, () => Promise.resolve("ran")),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(came.said).toBe(abandoned);
  dispatchEvent(new Event("pagehide"));
  dispatchEvent(new Event("pageshow"));

  expect(manager.asked).toHaveLength(1);
});
