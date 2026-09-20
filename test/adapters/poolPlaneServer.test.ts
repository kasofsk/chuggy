import assert from "node:assert/strict";
import { test } from "node:test";

import { createPoolPlaneApp } from "../../src/adapters/http/poolPlaneServer.ts";
import type { PoolPlaneService } from "../../src/adapters/http/poolPlaneServer.ts";
import {
  workerPoolPollQuery,
  workerPoolPollRoute,
  workerPoolReconciliationSchema,
  workerPoolSettlementPath,
} from "../../src/contract/workerPool.ts";
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

/** The poll's address carrying one `held` per assignment and the room asked for. */
function polling(held: readonly string[], wanted = 1): string {
  const query = new URLSearchParams([
    ...held.map((assignment) => [workerPoolPollQuery.held, assignment]),
    [workerPoolPollQuery.wanted, String(wanted)],
  ]).toString();
  return `${workerPoolPollRoute}?${query}`;
}
/** The one client the fake issuer knows, and the principal its subject resolves to. */
const poolToken = "pool-token";
const poolPrincipal = oidcPrincipal(issuer, "client-one");

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
          claims === 1 ? { capabilities: ["linux"] } : undefined,
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
      cpuMillis: 500,
      memoryMib: 256,
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
    url: polling(["live", "gone"]),
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

test("a pool wanting none is renewed, told what to stop and claimed nothing", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling(["live", "gone"], 0),
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), { assignments: [], stop: ["gone"] });
  assert.deepEqual(recorded.made, [
    ["renew", "live"],
    ["renew", "gone"],
  ]);
});

test("a pool wanting more than the plane hands out per poll is claimed the plane's bound", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling([], 5),
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 200);
  assert.equal(
    workerPoolReconciliationSchema.parse(answered.json()).assignments.length,
    1,
  );
  assert.deepEqual(recorded.made, [["claim", "minted-1"]]);
});

test("a poll that does not say its room, or says it as no count, is refused", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const query of ["", "?wanted=-1", "?wanted=two", "?wanted=1&wanted=2"]) {
    const answered = await app.inject({
      method: "GET",
      url: `${workerPoolPollRoute}${query}`,
      headers: { authorization: "Bearer pool-token" },
    });
    assert.equal(answered.statusCode, 400, query);
    assert.equal(answered.body, "");
  }
  assert.deepEqual(recorded.made, []);
});

test("a pool already at its bound still polls and is answered with control alone", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling(["live", "live", "live"]),
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
    url: polling(["one", "two", "three", "four"]),
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 400);
  assert.equal(answered.body, "");
});

for (const [why, headers, status] of [
  ["no token at all", {}, 401],
  [
    "a token the issuer does not vouch for",
    { authorization: "Bearer other" },
    401,
  ],
  [
    "an issuer that could not answer",
    { authorization: "Bearer issuer-down" },
    503,
  ],
] as const)
  test(`a poll carrying ${why} is answered ${String(status)} and nothing else`, async () => {
    const answered = await createPoolPlaneApp(plane(calls().ports)).inject({
      method: "GET",
      url: polling([]),
      headers,
    });
    assert.equal(answered.statusCode, status);
    assert.equal(answered.body, "");
  });

test("a pool the authority refuses is told it is not there rather than told to retry", async () => {
  const answered = await createPoolPlaneApp(
    plane(calls().ports, authority("Refuse")),
  ).inject({
    method: "GET",
    url: polling([]),
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 404);
  assert.equal(answered.body, "");
});

test("a pool polling through an authority outage is told to retry", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(
    plane(recorded.ports, authority("Outage")),
  ).inject({
    method: "GET",
    url: polling([]),
    headers: { authorization: "Bearer pool-token" },
  });
  assert.equal(answered.statusCode, 503);
  assert.equal(answered.body, "");
  assert.deepEqual(
    recorded.made,
    [],
    "an undecided question claims no work at all",
  );
});

test("each settlement route reaches the one port its own path names", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [outcome, payload] of [
    ["Accepted", {}],
    ["Refused", { evidence: "no runner" }],
    ["Unavailable", { retryAfterSecs: 30 }],
  ] as const) {
    const url = workerPoolSettlementPath(outcome, "one");
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
    url: workerPoolSettlementPath("Refused", "one"),
    headers: { authorization: "Bearer pool-token" },
    payload: { retryAfterSecs: 30 },
  });
  assert.equal(answered.statusCode, 400);
  assert.equal(answered.body, "");
  assert.deepEqual(recorded.made, []);
});
