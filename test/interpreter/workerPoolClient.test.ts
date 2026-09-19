import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerPoolAssignment } from "../../src/contract/workerPool.ts";
import {
  workerPoolClientPass,
  workerPoolClientRun,
  type WorkerPoolBackend,
  type WorkerPoolClient,
  type WorkerPoolClientSettings,
  type WorkerPoolPlacement,
  type WorkerPoolPlane,
  type WorkerPoolPolled,
  type WorkerPoolSettled,
  type WorkerPoolTokenAcquired,
} from "../../src/interpreter/workerPoolClient.ts";

const settings: WorkerPoolClientSettings = {
  concurrencyMax: 1,
  retryAfterSecs: 7,
  tokenRefreshBeforeSecs: 5,
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
  stop: () => Promise.resolve(),
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
          parts.token ?? {
            acquired: "Token",
            token: "pool-token",
            expiresInSecs: 3_600,
          },
        ),
    },
    plane: quiet,
    backend: idle,
    settings,
    now: () => 0,
    held: undefined,
    ...parts,
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

test("a pool at its own ceiling answers backpressure and places nothing", async () => {
  let placed = 0;
  const posted: string[] = [];
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
        poll: () =>
          Promise.resolve<WorkerPoolPolled>({
            polled: "Reconciled",
            assignments: [assignment("offered")],
            stop: [],
          }),
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
          return Promise.resolve();
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

test("a token is minted once and reused until its refresh window", async () => {
  let minted = 0;
  const running = client({
    settings: { ...settings, passesMax: 3 },
    token: { acquired: "Token", token: "pool-token", expiresInSecs: 3_600 },
  });
  const counted: WorkerPoolClient = {
    ...running,
    tokens: {
      acquire: () => {
        minted += 1;
        return running.tokens.acquire();
      },
    },
  };
  await workerPoolClientRun(counted, () => Promise.resolve());
  assert.equal(minted, 1);
});

test("a token inside its refresh window is replaced before the poll", async () => {
  let minted = 0;
  const running: WorkerPoolClient = {
    ...client({ settings: { ...settings, passesMax: 2 } }),
    tokens: {
      acquire: () => {
        minted += 1;
        return Promise.resolve<WorkerPoolTokenAcquired>({
          acquired: "Token",
          token: `pool-token-${String(minted)}`,
          expiresInSecs: 1,
        });
      },
    },
    now: () => minted * 10_000,
  };
  await workerPoolClientRun(running, () => Promise.resolve());
  assert.equal(minted, 2);
});

test("a rejected token is dropped and the pass reports an outage rather than a denial", async () => {
  const running = client({
    plane: { ...quiet, poll: () => Promise.resolve({ polled: "Stale" }) },
  });
  const passed = await workerPoolClientPass(running);
  assert.equal(passed.passed, "Unavailable");
  assert.equal(running.held, undefined);
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
