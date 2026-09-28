import assert from "node:assert/strict";
import { test } from "node:test";

import { planeBodyBytesDefault } from "../../src/adapters/http/planeRoutes.ts";
import {
  createPoolPlaneApp,
  poolPlaneSettlementBytesMax,
} from "../../src/adapters/http/poolPlaneServer.ts";
import type { PoolPlaneService } from "../../src/adapters/http/poolPlaneServer.ts";
import {
  contractVersionRefusalSchema,
  contractVersionRefusalStatus,
  workerContractHeader,
  workerContractRelease,
  workerContractVersionText,
} from "../../src/contract/workerContract.ts";
import {
  workerPoolEvidenceCharsMax,
  workerPoolPollQuery,
  workerPoolPollRoute,
  workerPoolReconciliationSchema,
  workerPoolSettlementPath,
} from "../../src/contract/workerPool.ts";
import { workerContractAccepted } from "../../src/interpreter/workerPlane.ts";
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
import {
  planeJsonHeaviest,
  planeListening,
  planeTextHeaviest,
  planeUnendingAnswered,
} from "./planeBodies.ts";

const issuer = "https://issuer.invalid";

/** The one client the fake issuer knows, and the principal its subject resolves to. */
const poolToken = "pool-token";
const poolPrincipal = oidcPrincipal(issuer, "client-one");

const partition = { tenant: "tenant", project: "project" } as Partition;
const identity: WorkerPoolIdentity = {
  partition,
  pool: "pool-one",
  principal: poolPrincipal,
};

/** The image the one claimed execution pinned, and the name a pool is handed it by. */
const pinned = `registry.invalid/worker@sha256:${"a".repeat(64)}`;
const published = `registry.public.invalid/worker@sha256:${"a".repeat(64)}`;

/** A pool's token and the release it speaks, which is this plane's own. */
const speaking = {
  authorization: `Bearer ${poolToken}`,
  [workerContractHeader]: workerContractRelease,
};

/** The poll's address carrying one `held` per assignment and the room asked for. */
function polling(held: readonly string[], wanted = 1): string {
  const query = new URLSearchParams([
    ...held.map((assignment) => [workerPoolPollQuery.held, assignment]),
    [workerPoolPollQuery.wanted, String(wanted)],
  ]).toString();
  return `${workerPoolPollRoute}?${query}`;
}

/** Records every call a route made, so the route's mapping is what the case reads, the pool holding `pinning`. */
function calls(pinning: readonly string[] = []): {
  readonly made: unknown[];
  readonly ports: WorkerPoolAssignments;
} {
  const made: unknown[] = [];
  let claims = 0;
  return {
    made,
    ports: {
      claim: (_identity, _terms, assignment) => {
        made.push(["claim", assignment]);
        claims += 1;
        return Promise.resolve(
          claims === 1
            ? {
                requirement: {
                  mode: "Container",
                  operatingSystem: "Linux",
                  architecture: "Amd64",
                  image: pinned,
                },
              }
            : undefined,
        );
      },
      renew: (_identity, assignment) =>
        Promise.resolve(
          (made.push(["renew", assignment]), assignment === "live"),
        ),
      refuse: (_identity, assignment, evidence) =>
        Promise.resolve((made.push(["refuse", assignment, evidence]), true)),
      release: (_identity, assignment) =>
        Promise.resolve((made.push(["release", assignment]), true)),
      held: (_identity, assignment) =>
        Promise.resolve((made.push(["held", assignment]), true)),
      heldImages: (_identity, heldMax) =>
        Promise.resolve((made.push(["heldImages", heldMax]), pinning)),
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
      clientOf: () => Promise.resolve(undefined),
      deregister: () => Promise.resolve(false),
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
      imageHosts: new Map([["registry.invalid", "registry.public.invalid"]]),
    },
    ready: () => Promise.resolve(true),
  };
}

test("one poll renews what is held, says what must stop and hands over what it claimed", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "GET",
    url: polling(["live", "gone"]),
    headers: speaking,
  });
  assert.equal(answered.statusCode, 200);
  assert.deepEqual(answered.json(), {
    assignments: [
      {
        assignment: "minted-1",
        capabilities: ["Platform:Linux:Amd64"],
        image: published,
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
    headers: speaking,
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
    headers: speaking,
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
      headers: speaking,
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
    headers: speaking,
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
    headers: speaking,
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
      headers: { ...headers, [workerContractHeader]: workerContractRelease },
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
    headers: speaking,
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
    headers: speaking,
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
    ["Unavailable", {}],
  ] as const) {
    const url = workerPoolSettlementPath(outcome, "one");
    const answered = await app.inject({
      method: "POST",
      url,
      headers: speaking,
      payload,
    });
    assert.equal(answered.statusCode, 204, url);
  }
  assert.deepEqual(recorded.made, [
    ["held", "one"],
    ["refuse", "one", "no runner"],
    ["release", "one"],
  ]);
});

test("a settlement whose body does not carry what its path needs is refused", async () => {
  const recorded = calls();
  const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
    method: "POST",
    url: workerPoolSettlementPath("Refused", "one"),
    headers: speaking,
    payload: {},
  });
  assert.equal(answered.statusCode, 400);
  assert.equal(answered.body, "");
  assert.deepEqual(recorded.made, []);
});

/** A later minor than the one this plane was built with, which it cannot serve. */
const unreleased = `${String(workerContractAccepted.max.major)}.${String(workerContractAccepted.max.minor + 1)}.0`;

test("a pool naming no release, one below the plane's floor or one later than the plane's is refused at the poll and at every settlement, before any port", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const offered of [undefined, "1.0.0", "1.1.0", unreleased]) {
    const headers = {
      authorization: `Bearer ${poolToken}`,
      ...(offered === undefined ? {} : { [workerContractHeader]: offered }),
    };
    for (const [method, url] of [
      ["GET", polling(["live"])],
      ["POST", workerPoolSettlementPath("Accepted", "one")],
      ["POST", workerPoolSettlementPath("Refused", "one")],
      ["POST", workerPoolSettlementPath("Unavailable", "one")],
    ] as const) {
      const refused = await app.inject({ method, url, headers, payload: {} });
      assert.equal(
        refused.statusCode,
        contractVersionRefusalStatus,
        `${String(offered)} ${url}`,
      );
      assert.deepEqual(contractVersionRefusalSchema.parse(refused.json()), {
        action: "stop",
        reason: "UnsupportedContractVersion",
        accepted: {
          min: "1.2",
          max: workerContractVersionText(workerContractAccepted.max),
        },
      });
    }
  }
  assert.deepEqual(recorded.made, []);
});

test("every answer names the plane's release, the probes' and the framework's own among them", async () => {
  const ports = calls().ports;
  const failing = {
    ...plane(ports),
    registry: {
      ...plane(ports).registry,
      identify: () => Promise.reject(new Error("down")),
    },
    ready: () => Promise.resolve(false),
  };
  const token = speaking;
  for (const [service, method, url, headers, status] of [
    [plane(ports), "GET", polling(["live"]), token, 200],
    [plane(ports), "GET", polling(["a", "b", "c", "d"]), token, 400],
    [
      plane(ports),
      "GET",
      polling([]),
      { [workerContractHeader]: workerContractRelease },
      401,
    ],
    [plane(ports), "GET", polling([]), {}, contractVersionRefusalStatus],
    [plane(ports, authority("Refuse")), "GET", polling([]), token, 404],
    [plane(ports, authority("Outage")), "GET", polling([]), token, 503],
    [failing, "GET", polling([]), token, 500],
    [
      plane(ports),
      "POST",
      workerPoolSettlementPath("Accepted", "one"),
      token,
      204,
    ],
    [
      plane(ports),
      "GET",
      "/health/live",
      { [workerContractHeader]: "2.0.0" },
      200,
    ],
    [failing, "GET", "/health/ready", {}, 503],
    [plane(ports), "GET", "/v1/nothing", {}, 404],
  ] as const) {
    const answered = await createPoolPlaneApp(service).inject({
      method,
      url,
      headers,
      ...(method === "POST" ? { payload: {} } : {}),
    });
    assert.equal(answered.statusCode, status, url);
    assert.equal(
      answered.headers[workerContractHeader],
      workerContractRelease,
      `${method} ${url} answered ${String(status)} naming no release`,
    );
  }
});

test("every settlement refuses a caller it does not serve before the body it sent ends", async () => {
  const recorded = calls();
  for (const [caller, service, token, status] of [
    ["no bearer", plane(recorded.ports), undefined, 401],
    ["a token the issuer rejects", plane(recorded.ports), "stranger", 401],
    [
      "a pool the authority refuses",
      plane(recorded.ports, authority("Refuse")),
      poolToken,
      404,
    ],
    ["an issuer that cannot answer", plane(recorded.ports), "issuer-down", 503],
  ] as const) {
    await using app = createPoolPlaneApp(service);
    const port = await planeListening(app);
    for (const outcome of ["Accepted", "Refused", "Unavailable"] as const) {
      const answered = await planeUnendingAnswered(
        port,
        "POST",
        workerPoolSettlementPath(outcome, "one"),
        {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          [workerContractHeader]: workerContractRelease,
          "content-type": "application/json",
        },
      );
      assert.equal(answered.status, status, `${caller} at ${outcome}`);
      assert.equal(answered.body, "");
    }
  }
  assert.deepEqual(recorded.made, []);
});

test("each call a pool makes is authenticated once", async () => {
  const asked = { tokens: 0, pools: 0 };
  const served = plane(calls().ports);
  const app = createPoolPlaneApp({
    ...served,
    authentication: {
      authenticateBearer: (token) => {
        asked.tokens += 1;
        return served.authentication.authenticateBearer(token);
      },
    },
    registry: {
      ...served.registry,
      identify: (principal) => {
        asked.pools += 1;
        return served.registry.identify(principal);
      },
    },
  });
  const made = [
    ["GET", polling(["live"]), undefined],
    ["POST", workerPoolSettlementPath("Accepted", "one"), {}],
    [
      "POST",
      workerPoolSettlementPath("Refused", "one"),
      { evidence: "no runner" },
    ],
    ["POST", workerPoolSettlementPath("Unavailable", "one"), {}],
  ] as const;
  for (const [method, url, payload] of made) {
    const answered = await app.inject({
      method,
      url,
      headers: speaking,
      ...(payload === undefined ? {} : { payload }),
    });
    assert.ok(answered.statusCode < 300, `${url} ${answered.body}`);
  }
  assert.deepEqual(asked, { tokens: made.length, pools: made.length });
});

test("a refusal carrying the heaviest evidence a pool may send is taken, and a byte past the bound is refused", async () => {
  const recorded = calls();
  const app = createPoolPlaneApp(plane(recorded.ports));
  const url = workerPoolSettlementPath("Refused", "one");
  const headers = { ...speaking, "content-type": "application/json" };
  const evidence = planeTextHeaviest(workerPoolEvidenceCharsMax);
  const taken = await app.inject({
    method: "POST",
    url,
    headers,
    payload: planeJsonHeaviest({ evidence }),
  });
  assert.equal(taken.statusCode, 204);
  const past = await app.inject({
    method: "POST",
    url,
    headers,
    payload: Buffer.alloc(poolPlaneSettlementBytesMax + 1, " "),
  });
  assert.equal(past.statusCode, 413);
  assert.deepEqual(recorded.made, [["refuse", "one", evidence]]);
});

test("a request no route names is read no further than the plane's own bound", async () => {
  const app = createPoolPlaneApp(plane(calls().ports));
  for (const [bytes, status] of [
    [planeBodyBytesDefault, 404],
    [planeBodyBytesDefault + 1, 413],
  ] as const) {
    const answered = await app.inject({
      method: "POST",
      url: "/v1/nothing",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("x".repeat(bytes - '""'.length)),
    });
    assert.equal(answered.statusCode, status, String(bytes));
  }
});

/** The address the registry's front asks at, which the fabric names exactly. */
const authorizing = "/registry/authorize";

/** A Basic credential whose password is `token`, under any user. */
function basic(token: string, user = "anyone"): string {
  return `Basic ${Buffer.from(`${user}:${token}`, "utf8").toString("base64")}`;
}

/** What the front forwards of one registry request, under the pool's own token unless the case names another credential or none. */
function forwarded(
  method: string,
  address: string,
  authorization: string | null = basic(poolToken),
): Record<string, string> {
  return {
    ...(authorization === null ? {} : { authorization }),
    "x-forwarded-method": method,
    "x-forwarded-uri": address,
  };
}

const heldDigest = `sha256:${"a".repeat(64)}`;

test("a pool is allowed the base, the manifest it holds by digest and that repository's blobs, naming no release", async () => {
  const recorded = calls([pinned]);
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [method, address] of [
    ["GET", "/v2/"],
    ["GET", `/v2/worker/manifests/${heldDigest}`],
    ["HEAD", `/v2/worker/manifests/${heldDigest}`],
    ["GET", `/v2/worker/blobs/sha256:${"b".repeat(64)}`],
  ] as const) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded(method, address),
    });
    assert.equal(answered.statusCode, 200, `${method} ${address}`);
    assert.equal(answered.body, "");
    assert.equal(answered.headers["www-authenticate"], undefined);
  }
  assert.deepEqual(recorded.made, Array(4).fill(["heldImages", 3]));
});

test("a Basic credential names any user, and only its password is the pool's token", async () => {
  const app = createPoolPlaneApp(plane(calls([pinned]).ports));
  for (const user of ["", "pool-one", "someone else"]) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", "/v2/", basic(poolToken, user)),
    });
    assert.equal(answered.statusCode, 200, JSON.stringify(user));
  }
});

for (const [why, authorization] of [
  ["no credential", null],
  ["the pool's token as a bearer", `Bearer ${poolToken}`],
  ["a scheme and nothing else", "Basic "],
  ["a credential that is not base64", "Basic !!!!"],
  [
    "base64 cut short of its padding",
    `Basic ${Buffer.from(`anyone:${poolToken}`).toString("base64").replace(/=+$/u, "")}`,
  ],
  [
    "a credential with no password",
    `Basic ${Buffer.from("anyone").toString("base64")}`,
  ],
  ["an empty password", basic("")],
  ["a token the issuer does not vouch for", basic("stranger")],
] as const)
  test(`a registry request carrying ${why} is challenged for a Basic credential`, async () => {
    const recorded = calls([pinned]);
    const answered = await createPoolPlaneApp(plane(recorded.ports)).inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", "/v2/", authorization),
    });
    assert.equal(answered.statusCode, 401);
    assert.equal(
      answered.headers["www-authenticate"],
      'Basic realm="chuggy-registry"',
    );
    assert.equal(answered.body, "");
    assert.deepEqual(recorded.made, []);
  });

test("a request the grammar refuses is 403 before anything held is read", async () => {
  const recorded = calls([pinned]);
  const app = createPoolPlaneApp(plane(recorded.ports));
  for (const [method, address] of [
    ["GET", "/v2/_catalog"],
    ["GET", "/v2/worker/tags/list"],
    ["GET", "/v2/worker/manifests/latest"],
    ["PUT", `/v2/worker/manifests/${heldDigest}`],
    ["POST", "/v2/worker/blobs/uploads/"],
    ["DELETE", `/v2/worker/blobs/${heldDigest}`],
    ["GET", `/v2/worker/manifests/${heldDigest}?digest=x`],
    ["GET", `/v2/%2e%2e/worker/blobs/${heldDigest}`],
  ] as const) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded(method, address),
    });
    assert.equal(answered.statusCode, 403, `${method} ${address}`);
    assert.equal(answered.body, "");
    assert.equal(answered.headers["www-authenticate"], undefined);
  }
  const unforwarded = await app.inject({
    method: "GET",
    url: authorizing,
    headers: { authorization: basic(poolToken) },
  });
  assert.equal(unforwarded.statusCode, 403);
  assert.deepEqual(recorded.made, []);
});

test("a pull of an image the pool holds no assignment for is 403", async () => {
  const app = createPoolPlaneApp(plane(calls([pinned]).ports));
  for (const address of [
    `/v2/worker/manifests/sha256:${"b".repeat(64)}`,
    `/v2/api/manifests/${heldDigest}`,
    `/v2/api/blobs/${heldDigest}`,
  ]) {
    const answered = await app.inject({
      method: "GET",
      url: authorizing,
      headers: forwarded("GET", address),
    });
    assert.equal(answered.statusCode, 403, address);
  }
  const holdingNothing = await createPoolPlaneApp(plane(calls().ports)).inject({
    method: "GET",
    url: authorizing,
    headers: forwarded("GET", `/v2/worker/manifests/${heldDigest}`),
  });
  assert.equal(holdingNothing.statusCode, 403);
});

test("a caller that is no admitted pool is 403, and an outage of the issuer, the authority or the store is 503", async () => {
  const ports = calls([pinned]).ports;
  const served = plane(ports);
  for (const [why, service, token, status] of [
    [
      "a pool the authority refuses",
      plane(ports, authority("Refuse")),
      poolToken,
      403,
    ],
    [
      "a principal no registration names",
      {
        ...served,
        registry: {
          ...served.registry,
          identify: () => Promise.resolve(undefined),
        },
      },
      poolToken,
      403,
    ],
    ["an issuer that cannot answer", served, "issuer-down", 503],
    ["an authority outage", plane(ports, authority("Outage")), poolToken, 503],
    [
      "a registry that cannot be read",
      {
        ...served,
        registry: {
          ...served.registry,
          identify: () => Promise.reject(new Error("down")),
        },
      },
      poolToken,
      503,
    ],
    [
      "held assignments that cannot be read",
      {
        ...served,
        assignments: {
          ...ports,
          heldImages: () => Promise.reject(new Error("down")),
        },
      },
      poolToken,
      503,
    ],
  ] as const) {
    const answered = await createPoolPlaneApp(service).inject({
      method: "GET",
      url: authorizing,
      headers: forwarded(
        "GET",
        `/v2/worker/manifests/${heldDigest}`,
        basic(token),
      ),
    });
    assert.equal(answered.statusCode, status, why);
    assert.equal(answered.body, "");
    assert.equal(answered.headers["www-authenticate"], undefined, why);
  }
});
