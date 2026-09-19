import assert from "node:assert/strict";
import { test } from "node:test";

import { createPoolPlaneApp } from "../../src/adapters/http/poolPlaneServer.ts";
import type { PoolPlaneService } from "../../src/adapters/http/poolPlaneServer.ts";
import type {
  WorkerPoolAssignments,
  WorkerPoolIdentity,
} from "../../src/interpreter/workerPool.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

const partition = { tenant: "tenant", project: "project" } as Partition;
const identity: WorkerPoolIdentity = {
  partition,
  pool: "pool-one",
  capabilities: ["linux"],
};

const view = { workload: { execution_profile: { cpu: 500, memory_mb: 256 } } };

/** Records every call a route made, so the route's mapping is what the case reads. */
function calls(): {
  readonly made: unknown[];
  readonly ports: WorkerPoolAssignments;
} {
  const made: unknown[] = [];
  let claims = 0;
  return {
    made,
    ports: {
      claim: (_identity, _leaseSecs, assignment) => {
        made.push(["claim", assignment]);
        claims += 1;
        return Promise.resolve(
          claims === 1 ? { view, capabilities: ["linux"] } : undefined,
        );
      },
      renew: (_identity, assignment) =>
        Promise.resolve(
          (made.push(["renew", assignment]), assignment === "live"),
        ),
      refuse: (_identity, assignment, evidence) =>
        Promise.resolve((made.push(["refuse", assignment, evidence]), true)),
      release: (_identity, assignment, retryAfterSecs) =>
        Promise.resolve(
          (made.push(["release", assignment, retryAfterSecs]), true),
        ),
      held: (_identity, assignment) =>
        Promise.resolve((made.push(["held", assignment]), true)),
    },
  };
}

function plane(ports: WorkerPoolAssignments): PoolPlaneService {
  let minted = 0;
  return {
    registry: {
      register: () => Promise.resolve(true),
      deregister: () => Promise.resolve(true),
      authenticate: (credential) =>
        Promise.resolve(
          credential === "pool-credential" ? identity : undefined,
        ),
    },
    assignments: ports,
    mint: () => `minted-${String((minted += 1))}`,
    settings: {
      leaseSecs: 30,
      assignmentsPerPollMax: 1,
      heldMax: 3,
      deadlineSecs: 600,
      callbackUrl: "https://plane.invalid/v1/ticket-execution",
      pollIntervalMs: 1,
      pollsMax: 1,
    },
    ready: () => Promise.resolve(true),
  };
}

test("one poll renews what is held, says what must stop and hands over what it claimed", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: "/v1/assignments?held=live&held=gone",
    headers: { authorization: "Bearer pool-credential" },
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [
      {
        assignment: "minted-1",
        capabilities: ["linux"],
        cpuMillis: 500,
        memoryMib: 256,
        deadlineSecs: 600,
        callbackUrl: "https://plane.invalid/v1/ticket-execution",
        bearer: "minted-2",
      },
    ],
    stop: ["gone"],
  });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "gone"],
    ["claim", "minted-1"],
  ]);
});

test("a pool already at its bound still polls and is answered with control alone", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: "/v1/assignments?held=live&held=live&held=live",
    headers: { authorization: "Bearer pool-credential" },
  });
  assert.deepEqual(answered.json(), { assignments: [], stop: [] });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "live"],
    ["renew", "live"],
  ]);
});

test("a list longer than the bound is refused rather than cut", async () => {
  const answered = await createPoolPlaneApp(plane(calls().ports)).inject({
    method: "GET",
    url: "/v1/assignments?held=one&held=two&held=three&held=four",
    headers: { authorization: "Bearer pool-credential" },
  });
  assert.equal(answered.statusCode, 400);
  assert.deepEqual(answered.json(), { action: "stop", reason: "InvalidHeld" });
});

for (const [why, headers] of [
  ["no credential at all", {}],
  ["a credential no registration names", { authorization: "Bearer other" }],
] as const)
  test(`a poll is refused to ${why}`, async () => {
    const answered = await createPoolPlaneApp(plane(calls().ports)).inject({
      method: "GET",
      url: "/v1/assignments",
      headers,
    });
    assert.equal(answered.statusCode, 401);
    assert.deepEqual(answered.json(), { action: "stop" });
  });

test("each settlement route reaches the one port its own path names", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [url, payload] of [
    ["/v1/assignments/one/accepted", {}],
    ["/v1/assignments/one/refused", { evidence: "no runner" }],
    ["/v1/assignments/one/unavailable", { retryAfterSecs: 30 }],
  ] as const) {
    const answered = await app.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer pool-credential" },
      payload,
    });
    assert.equal(answered.statusCode, 204, url);
  }
  assert.deepEqual(recorded.made, [
    ["held", "one"],
    ["refuse", "one", "no runner"],
    ["release", "one", 30],
  ]);
});

test("a settlement whose body does not carry what its path needs is refused", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "POST",
    url: "/v1/assignments/one/refused",
    headers: { authorization: "Bearer pool-credential" },
    payload: { retryAfterSecs: 30 },
  });
  assert.equal(answered.statusCode, 400);
  assert.deepEqual(answered.json(), {
    action: "stop",
    reason: "InvalidOutcome",
  });
  assert.deepEqual(recorded.made, []);
});
