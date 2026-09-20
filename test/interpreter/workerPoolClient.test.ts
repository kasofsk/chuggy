import assert from "node:assert/strict";
import test from "node:test";

import {
  workerPoolRetryAfterSecsMax,
  type WorkerPoolAssignment,
} from "../../src/contract/workerPool.ts";
import {
  checkedWorkerPoolClientSettings,
  workerPoolClientPass,
  workerPoolClientRun,
  type WorkerPoolBackend,
  type WorkerPoolClient,
  type WorkerPoolClientSettings,
  type WorkerPoolPlacement,
  type WorkerPoolPlane,
  type WorkerPoolPolled,
  type WorkerPoolStopped,
  type WorkerPoolSettled,
  type WorkerPoolTokenAcquired,
  type WorkerPoolTokens,
} from "../../src/interpreter/workerPoolClient.ts";

const settings: WorkerPoolClientSettings = {
  concurrencyMax: 1,
  retryAfterSecs: 7,
  outageBackoffMs: 1,
  passesMax: 1,
};

function assignment(named: string): WorkerPoolAssignment {
  return {
    assignment: named,
    capabilities: [],
    cpuMillis: 500,
    memoryMib: 512,
    deadlineSecs: 60,
    callbackUrl: "https://plane.invalid/v1/ticket-execution",
    bearer: `bearer-${named}`,
  };
}

/** A backend holding nothing and placing everything, which every case narrows from. */
const idle: WorkerPoolBackend = {
  place: () => Promise.resolve<WorkerPoolPlacement>({ placed: "Placed" }),
  stop: () => Promise.resolve<WorkerPoolStopped>({ stopped: "Stopped" }),
  held: () => Promise.resolve([]),
};

/** A plane with nothing to say, answered by the poll that says so. */
const quiet: WorkerPoolPlane = {
  poll: () =>
    Promise.resolve<WorkerPoolPolled>({
      polled: "Reconciled",
      assignments: [],
      stop: [],
    }),
  settle: () => Promise.resolve<WorkerPoolSettled>("Settled"),
};

function client(
  parts: Partial<WorkerPoolClient> & {
    readonly token?: WorkerPoolTokenAcquired;
  },
): WorkerPoolClient {
  return {
    tokens: {
      acquire: () =>
        Promise.resolve(
          parts.token ?? { acquired: "Token", token: "pool-token" },
        ),
      invalidate: () => undefined,
    },
    plane: quiet,
    backend: idle,
    settings,
    ...parts,
  };
}

/** A tokens port minting a fresh token per acquire and recording what it is told to discard. */
function counting(): {
  readonly tokens: WorkerPoolTokens;
  readonly minted: string[];
  readonly invalidated: string[];
} {
  const minted: string[] = [];
  const invalidated: string[] = [];
  return {
    minted,
    invalidated,
    tokens: {
      acquire: () => {
        const token = `pool-token-${String(minted.length + 1)}`;
        minted.push(token);
        return Promise.resolve<WorkerPoolTokenAcquired>({
          acquired: "Token",
          token,
        });
      },
      invalidate: (token) => {
        invalidated.push(token);
      },
    },
  };
}

test("what the pool holds is read from the backend rather than remembered", async () => {
  const sent: string[][] = [];
  const passed = await workerPoolClientPass(
    client({
      backend: { ...idle, held: () => Promise.resolve(["running-one"]) },
      plane: {
        ...quiet,
        poll: (_token, held) => {
          sent.push([...held]);
          return Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [],
            stop: [],
          });
        },
      },
    }),
  );
  assert.deepEqual(sent, [["running-one"]]);
  assert.equal(passed.passed, "Reconciled");
});

test("a poll asks for the room left under the ceiling, and none at it", async () => {
  const asked: number[] = [];
  const plane: WorkerPoolPlane = {
    ...quiet,
    poll: (_token, _held, wanted) => {
      asked.push(wanted);
      return Promise.resolve<WorkerPoolPolled>({
        polled: "Reconciled",
        assignments: [],
        stop: [],
      });
    },
  };
  await workerPoolClientPass(
    client({
      settings: { ...settings, concurrencyMax: 3 },
      backend: { ...idle, held: () => Promise.resolve(["one"]) },
      plane,
    }),
  );
  await workerPoolClientPass(
    client({
      settings: { ...settings, concurrencyMax: 3 },
      backend: {
        ...idle,
        held: () => Promise.resolve(["one", "two", "three"]),
      },
      plane,
    }),
  );
  await workerPoolClientPass(
    client({
      backend: { ...idle, held: () => Promise.resolve(["one", "two"]) },
      plane,
    }),
  );
  assert.deepEqual(asked, [2, 0, 0]);
});

test("a pool at its own ceiling polls for none, and places nothing it is offered anyway", async () => {
  let placed = 0;
  const posted: string[] = [];
  const asked: number[] = [];
  const passed = await workerPoolClientPass(
    client({
      backend: {
        ...idle,
        held: () => Promise.resolve(["running-one"]),
        place: () => {
          placed += 1;
          return Promise.resolve<WorkerPoolPlacement>({ placed: "Placed" });
        },
      },
      plane: {
        poll: (_token, _held, wanted) => {
          asked.push(wanted);
          return Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [assignment("offered")],
            stop: [],
          });
        },
        settle: (_token, _assignment, outcome) => {
          posted.push(
            outcome.outcome === "Unavailable"
              ? `Unavailable:${String(outcome.retryAfterSecs)}`
              : outcome.outcome,
          );
          return Promise.resolve<WorkerPoolSettled>("Settled");
        },
      },
    }),
  );
  assert.deepEqual(asked, [0]);
  assert.equal(placed, 0);
  assert.deepEqual(posted, ["Unavailable:7"]);
  assert.deepEqual(passed, {
    passed: "Reconciled",
    placed: 0,
    stopped: 0,
    refused: 0,
  });
});

test("a stopped assignment frees the room the same pass places into", async () => {
  const stopped: string[] = [];
  const passed = await workerPoolClientPass(
    client({
      backend: {
        ...idle,
        held: () => Promise.resolve(["going"]),
        stop: (named) => {
          stopped.push(named);
          return Promise.resolve<WorkerPoolStopped>({ stopped: "Stopped" });
        },
      },
      plane: {
        ...quiet,
        poll: () =>
          Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [assignment("offered")],
            stop: ["going"],
          }),
      },
    }),
  );
  assert.deepEqual(stopped, ["going"]);
  assert.deepEqual(passed, {
    passed: "Reconciled",
    placed: 1,
    stopped: 1,
    refused: 0,
  });
});

test("a fabric that could not take a stop places nothing further this pass", async () => {
  let placed = 0;
  const passed = await workerPoolClientPass(
    client({
      backend: {
        ...idle,
        held: () => Promise.resolve(["going"]),
        stop: () =>
          Promise.resolve<WorkerPoolStopped>({
            stopped: "Unavailable",
            evidence: "the fabric could not be reached",
          }),
        place: () => {
          placed += 1;
          return Promise.resolve<WorkerPoolPlacement>({ placed: "Placed" });
        },
      },
      plane: {
        ...quiet,
        poll: () =>
          Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [assignment("offered")],
            stop: ["going"],
          }),
      },
    }),
  );
  assert.equal(placed, 0);
  assert.deepEqual(passed, {
    passed: "Unavailable",
    evidence: "the fabric could not be reached",
  });
});

test("a fabric that refused a stop ends the run rather than renewing that lease", async () => {
  let polled = 0;
  const passed = await workerPoolClientRun(
    client({
      settings: { ...settings, passesMax: 5 },
      backend: {
        ...idle,
        held: () => Promise.resolve(["going"]),
        stop: () =>
          Promise.resolve<WorkerPoolStopped>({
            stopped: "Refused",
            evidence: "the fabric refused to stop this workload",
          }),
      },
      plane: {
        ...quiet,
        poll: () => {
          polled += 1;
          return Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [],
            stop: ["going"],
          });
        },
      },
    }),
    () => Promise.resolve(),
  );
  assert.equal(polled, 1);
  assert.deepEqual(passed, {
    passed: "Denied",
    evidence: "the fabric refused to stop this workload",
  });
});

test("a placement the plane never acknowledged is still placed", async () => {
  let placed = 0;
  const passed = await workerPoolClientPass(
    client({
      backend: {
        ...idle,
        place: () => {
          placed += 1;
          return Promise.resolve<WorkerPoolPlacement>({ placed: "Placed" });
        },
      },
      plane: {
        poll: () =>
          Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [assignment("offered")],
            stop: [],
          }),
        settle: () => Promise.resolve<WorkerPoolSettled>("Unavailable"),
      },
    }),
  );
  assert.equal(placed, 1);
  assert.deepEqual(passed, {
    passed: "Reconciled",
    placed: 1,
    stopped: 0,
    refused: 0,
  });
});

test("a refused placement is reported as evidence rather than as backpressure", async () => {
  const posted: string[] = [];
  const passed = await workerPoolClientPass(
    client({
      backend: {
        ...idle,
        place: () =>
          Promise.resolve<WorkerPoolPlacement>({
            placed: "Refused",
            evidence: "the cluster refused this workload",
          }),
      },
      plane: {
        poll: () =>
          Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [assignment("offered")],
            stop: [],
          }),
        settle: (_token, _assignment, outcome) => {
          posted.push(outcome.outcome);
          return Promise.resolve<WorkerPoolSettled>("Settled");
        },
      },
    }),
  );
  assert.deepEqual(posted, ["Refused"]);
  assert.equal(passed.passed, "Reconciled");
});

test("a token is acquired every pass and nothing is discarded unasked", async () => {
  const source = counting();
  await workerPoolClientRun(
    client({ settings: { ...settings, passesMax: 3 }, tokens: source.tokens }),
    () => Promise.resolve(),
  );
  assert.equal(source.minted.length, 3);
  assert.deepEqual(source.invalidated, []);
});

test("a token the poll was refused with is invalidated, and the next pass acquires again", async () => {
  const source = counting();
  const polledWith: string[] = [];
  const running = client({
    tokens: source.tokens,
    plane: {
      ...quiet,
      poll: (token) => {
        polledWith.push(token);
        return Promise.resolve<WorkerPoolPolled>(
          polledWith.length === 1
            ? { polled: "Stale" }
            : { polled: "Reconciled", assignments: [], stop: [] },
        );
      },
    },
  });
  const first = await workerPoolClientPass(running);
  assert.equal(first.passed, "Unavailable");
  assert.deepEqual(source.invalidated, ["pool-token-1"]);
  const second = await workerPoolClientPass(running);
  assert.equal(second.passed, "Reconciled");
  assert.deepEqual(polledWith, ["pool-token-1", "pool-token-2"]);
});

test("a token a settlement was refused with is invalidated, and the next pass acquires again", async () => {
  const source = counting();
  const polledWith: string[] = [];
  const running = client({
    tokens: source.tokens,
    plane: {
      poll: (token) => {
        polledWith.push(token);
        return Promise.resolve<WorkerPoolPolled>({
          polled: "Reconciled",
          assignments: [assignment("offered")],
          stop: [],
        });
      },
      settle: () => Promise.resolve<WorkerPoolSettled>("Stale"),
    },
  });
  const passed = await workerPoolClientPass(running);
  assert.equal(passed.passed, "Reconciled");
  assert.deepEqual(source.invalidated, ["pool-token-1"]);
  await workerPoolClientPass(running);
  assert.deepEqual(polledWith, ["pool-token-1", "pool-token-2"]);
});

test("a pool the plane serves no registration for stops rather than retrying", async () => {
  let polled = 0;
  const passed = await workerPoolClientRun(
    client({
      settings: { ...settings, passesMax: 5 },
      plane: {
        ...quiet,
        poll: () => {
          polled += 1;
          return Promise.resolve<WorkerPoolPolled>({
            polled: "Denied",
            evidence: "the plane serves no such pool",
          });
        },
      },
    }),
    () => Promise.resolve(),
  );
  assert.equal(polled, 1);
  assert.equal(passed.passed, "Denied");
});

test("an issuer that refused the grant stops the run and one that faltered does not", async () => {
  const denied = await workerPoolClientRun(
    client({
      token: { acquired: "Denied", evidence: "the issuer refused this pool" },
    }),
    () => Promise.resolve(),
  );
  assert.equal(denied.passed, "Denied");
  let waited = 0;
  const outage = await workerPoolClientRun(
    client({
      settings: { ...settings, passesMax: 2 },
      token: { acquired: "Unavailable", evidence: "the issuer is unreachable" },
    }),
    () => {
      waited += 1;
      return Promise.resolve();
    },
  );
  assert.equal(outage.passed, "Unavailable");
  assert.equal(waited, 2);
});

test("the retry-after a client answers with is bounded as the wire bounds it", () => {
  assert.equal(
    checkedWorkerPoolClientSettings({
      ...settings,
      retryAfterSecs: workerPoolRetryAfterSecsMax,
    }).retryAfterSecs,
    workerPoolRetryAfterSecsMax,
  );
  assert.throws(
    () =>
      checkedWorkerPoolClientSettings({
        ...settings,
        retryAfterSecs: workerPoolRetryAfterSecsMax + 1,
      }),
    RangeError,
  );
});

test("a run refuses a bound that is not a positive whole number", async () => {
  await assert.rejects(
    () =>
      workerPoolClientRun(
        client({ settings: { ...settings, concurrencyMax: 0 } }),
        () => Promise.resolve(),
      ),
    RangeError,
  );
});
