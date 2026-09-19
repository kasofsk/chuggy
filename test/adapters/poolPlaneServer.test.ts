import assert from "node:assert/strict";
import { test } from "node:test";

import { createPoolPlaneApp } from "../../src/adapters/http/poolPlaneServer.ts";
import type { PoolPlaneService } from "../../src/adapters/http/poolPlaneServer.ts";
import type {
  WorkerPoolAssignments,
  WorkerPoolIdentity,
} from "../../src/interpreter/workerPool.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  ProjectAccessUnavailable,
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";

const partition = { tenant: "tenant", project: "project" } as Partition;
const identity: WorkerPoolIdentity = {
  partition,
  pool: "pool-one",
  capabilities: ["linux"],
};

const issuer = "https://issuer.invalid";
/** The one client the fake issuer knows, and the principal its subject resolves to. */
const poolToken = "pool-token";
const poolPrincipal = oidcPrincipal(issuer, "client-one");

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

/** An issuer that knows one token, refuses one and cannot answer for a third. */
const issuing = {
  authenticateBearer: (token: string) =>
    Promise.resolve(
      token === poolToken
        ? ({
            authenticated: "Bearer",
            bearer: { principal: poolPrincipal },
          } as const)
        : token === "issuer-down"
          ? ({ authenticated: "AuthorityUnavailable" } as const)
          : ({ authenticated: "InvalidToken" } as const),
    ),
};

/** An authority that permits the one principal, unless the case asks it to fail. */
function authority(answer: "Allow" | "Refuse" | "Outage"): ProjectAccess {
  return {
    authorize: (principal: Principal) => {
      if (answer === "Outage")
        throw new ProjectAccessUnavailable("the authority is unreachable");
      return Promise.resolve(
        answer === "Allow" ? memberAuthority(principal) : undefined,
      );
    },
    authorizeTenant: () => Promise.resolve(undefined),
  };
}

function plane(
  ports: WorkerPoolAssignments,
  access: ProjectAccess = authority("Allow"),
): PoolPlaneService {
  let minted = 0;
  return {
    authentication: issuing,
    access,
    registry: {
      register: () => Promise.resolve(true),
      deregister: () => Promise.resolve(undefined),
      identify: (principal) =>
        Promise.resolve(principal === poolPrincipal ? identity : undefined),
    },
    assignments: ports,
    mint: () => `minted-${String((minted += 1))}`,
    settings: {
      leaseSecs: 30,
      attemptsUnreportedMax: 3,
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
    headers: { authorization: "Bearer pool-token" },
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
    headers: { authorization: "Bearer pool-token" },
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
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 400);
  assert.deepEqual(answered.json(), { action: "stop", reason: "InvalidHeld" });
});

for (const [why, headers, status, body] of [
  ["no token at all", {}, 401, { action: "stop" }],
  [
    "a token the issuer does not vouch for",
    { authorization: "Bearer other" },
    401,
    { action: "stop" },
  ],
  [
    "an issuer that could not answer",
    { authorization: "Bearer issuer-down" },
    503,
    { action: "retry" },
  ],
] as const)
  test(`a poll carrying ${why} is answered ${String(status)}`, async () => {
    const answered = await createPoolPlaneApp(plane(calls().ports)).inject({
      method: "GET",
      url: "/v1/assignments",
      headers,
    });
    assert.equal(answered.statusCode, status);
    assert.deepEqual(answered.json(), body);
  });

test("a pool the authority refuses is told it is not there rather than told to retry", async () => {
  const answered = await createPoolPlaneApp(
    plane(calls().ports, authority("Refuse")),
  ).inject({
    method: "GET",
    url: "/v1/assignments",
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 404);
  assert.deepEqual(answered.json(), { action: "stop" });
});

test("a pool polling through an authority outage is told to retry", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(
    plane(recorded.ports, authority("Outage")),
  ).inject({
    method: "GET",
    url: "/v1/assignments",
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 503);
  assert.deepEqual(answered.json(), { action: "retry" });
  assert.deepEqual(
    recorded.made,
    [],
    "an undecided question claims no work at all",
  );
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
      headers: { authorization: "Bearer pool-token" },
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
    headers: { authorization: "Bearer pool-token" },
    payload: { retryAfterSecs: 30 },
  });
  assert.equal(answered.statusCode, 400);
  assert.deepEqual(answered.json(), {
    action: "stop",
    reason: "InvalidOutcome",
  });
  assert.deepEqual(recorded.made, []);
});
