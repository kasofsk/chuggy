import assert from "node:assert/strict";
import test from "node:test";

import { poolClientTokens } from "../../src/adapters/http/poolTokens.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import {
  checkedPoolPlaneClientSettings,
  poolPlaneClient,
} from "../../src/adapters/http/poolPlaneClient.ts";
import {
  workerPoolClientPass,
  workerPoolClientRun,
  type WorkerPoolBackend,
  type WorkerPoolClient,
  type WorkerPoolPass,
  type WorkerPoolPlane,
} from "../../src/interpreter/workerPoolClient.ts";

const planeSettings = {
  baseUrl: "https://pool-plane.invalid",
  pollTimeoutMs: 1_000,
  settleTimeoutMs: 1_000,
};

/** One pool's credential as the client spends it, the transport supplied per test. */
function tokenSettings(fetcher: typeof fetch) {
  return {
    tokenUrl: "https://issuer.invalid/oauth2/token",
    clientId: "chuggy-pool-one",
    clientSecret: "secret",
    audience: ["https://api.invalid"],
    scope: [],
    requestTimeoutMs: 1_000,
    responseBytesMax: 64 * 1024,
    responseReadsMax: 64,
    refreshMarginMs: 10_000,
    mintCooldownMs: 1_000,
    refusalConfirmMs: 60_000,
    fetch: fetcher,
  };
}

const assignment = {
  assignment: "assignment-one",
  capabilities: ["linux-containers"],
  cpuMillis: 500,
  memoryMib: 512,
  deadlineSecs: 60,
  callbackUrl: "https://worker-plane.invalid/v1/ticket-execution",
  bearer: "attempt-bearer",
};

const sessionAssignment = {
  ...assignment,
  assignment: "session-one",
  capabilities: [],
  image: "registry.invalid/session:1",
  bearer: "chgs_session",
};

/** The address one request was made to, whichever way the caller spelled it. */
function sentUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The body one request carried, which is text in every call this adapter makes. */
function sentBody(init: Parameters<typeof fetch>[1]): string {
  return typeof init?.body === "string" ? init.body : "";
}

/** One header one request carried, read off the plain record every call passes. */
function sentHeader(init: Parameters<typeof fetch>[1], name: string): string {
  return (init?.headers as Record<string, string> | undefined)?.[name] ?? "";
}

/** One answer as the plane would send it, naming its release as every one does, with no server to send it. */
function answered(status: number, body: string): Response {
  return new Response(status === 204 ? null : body, {
    status,
    headers: { [workerContractHeader]: workerContractRelease },
  });
}

/** A refusal as Hydra words one. */
function refusal(status: number, error: string): Response {
  return new Response(
    JSON.stringify({
      error,
      error_description: "Client authentication failed.",
    }),
    { status, headers: { "content-type": "application/json;charset=UTF-8" } },
  );
}

/** What traefik answers in place of a service with no endpoint ready. */
function proxyNotFound(): Response {
  return new Response("404 page not found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** A grant of `token` for `expiresInSeconds`, as the issuer answers one. */
function granted(token: string, expiresInSeconds: number): Response {
  return new Response(
    JSON.stringify({
      access_token: token,
      token_type: "bearer",
      expires_in: expiresInSeconds,
    }),
    { status: 200 },
  );
}

test("a poll names what the pool holds and wants, and carries its own token", async () => {
  const seen: { url: string; authorization: string } = {
    url: "",
    authorization: "",
  };
  const plane = poolPlaneClient(planeSettings, (input, init) => {
    seen.url = sentUrl(input);
    seen.authorization = sentHeader(init, "authorization");
    return Promise.resolve(
      answered(
        200,
        JSON.stringify({
          assignments: [assignment],
          sessions: [sessionAssignment],
          stop: ["a"],
        }),
      ),
    );
  });
  const polled = await plane.poll("pool-token", ["one", "two"], 3, 2);
  assert.equal(
    seen.url,
    "https://pool-plane.invalid/v1/assignments?held=one&held=two&wanted=3&wantedSessions=2",
  );
  assert.equal(seen.authorization, "Bearer pool-token");
  assert.equal(polled.polled, "Reconciled");
  if (polled.polled !== "Reconciled") return;
  assert.deepEqual(polled.assignments, [assignment]);
  assert.deepEqual(polled.sessions, [sessionAssignment]);
  assert.deepEqual(polled.stop, ["a"]);
});

test("each refusing status is the arm the plane means by it", async () => {
  for (const [status, expected] of [
    [401, "Stale"],
    [404, "Denied"],
    [400, "Denied"],
    [503, "Unavailable"],
    [500, "Unavailable"],
  ] as const) {
    const plane = poolPlaneClient(planeSettings, () =>
      Promise.resolve(answered(status, "{}")),
    );
    const polled = await plane.poll("pool-token", [], 1, 0);
    assert.equal(polled.polled, expected, `status ${String(status)}`);
  }
});

test("an answer this pool cannot read is an outage rather than a refusal", async () => {
  for (const body of ["not json", JSON.stringify({ assignments: [{}] })]) {
    const plane = poolPlaneClient(planeSettings, () =>
      Promise.resolve(answered(200, body)),
    );
    const polled = await plane.poll("pool-token", [], 1, 0);
    assert.equal(polled.polled, "Unavailable");
  }
});

test("a plane that could not be reached is an outage and raises nothing", async () => {
  const plane = poolPlaneClient(planeSettings, () =>
    Promise.reject(new Error("connection refused")),
  );
  const polled = await plane.poll("pool-token", [], 1, 0);
  assert.equal(polled.polled, "Unavailable");
});

test("each settlement is the path it is said on and the body it needs", async () => {
  const sent: { url: string; body: string }[] = [];
  const plane = poolPlaneClient(planeSettings, (input, init) => {
    sent.push({ url: sentUrl(input), body: sentBody(init) });
    return Promise.resolve(answered(204, ""));
  });
  assert.equal(
    await plane.settle("pool-token", "one", { outcome: "Accepted" }),
    "Settled",
  );
  await plane.settle("pool-token", "two", {
    outcome: "Refused",
    evidence: "refused",
  });
  await plane.settle("pool-token", "three", { outcome: "Unavailable" });
  await plane.settle("pool-token", "four", {
    outcome: "Refused",
    evidence: "no git",
    fault: "ImageLacksGit",
  });
  assert.deepEqual(
    sent.map((request) => request.url),
    [
      "https://pool-plane.invalid/v1/assignments/one/accepted",
      "https://pool-plane.invalid/v1/assignments/two/refused",
      "https://pool-plane.invalid/v1/assignments/three/unavailable",
      "https://pool-plane.invalid/v1/assignments/four/refused",
    ],
  );
  assert.deepEqual(
    sent.map((request) => request.body),
    [
      "{}",
      '{"evidence":"refused"}',
      "{}",
      '{"evidence":"no git","fault":"ImageLacksGit"}',
    ],
  );
});

test("the plane's own 404, empty as it sends one, denies the pool from a poll and from a settlement", async () => {
  const refusing = poolPlaneClient(planeSettings, () =>
    Promise.resolve(answered(404, "")),
  );
  assert.deepEqual(await refusing.poll("pool-token", [], 1, 0), {
    polled: "Denied",
    evidence: "the plane serves no such pool",
  });
  assert.equal(
    await refusing.settle("pool-token", "one", { outcome: "Accepted" }),
    "Denied",
  );
});

test("a 404 or a 400 naming no release of the plane's is an outage, from a poll and from a settlement", async () => {
  for (const [status, body, headers] of [
    [404, "404 page not found\n", { "content-type": "text/plain" }],
    [400, "400 Bad Request", { "content-type": "text/plain" }],
    [404, "", { [workerContractHeader]: "not a release" }],
  ] as const) {
    const proxy = poolPlaneClient(planeSettings, () =>
      Promise.resolve(new Response(body, { status, headers })),
    );
    assert.deepEqual(await proxy.poll("pool-token", [], 1, 0), {
      polled: "Unavailable",
      evidence: `the plane's address answered ${String(status)}, naming no release`,
    });
    assert.equal(
      await proxy.settle("pool-token", "one", { outcome: "Accepted" }),
      "Unavailable",
      `status ${String(status)}`,
    );
  }
});

test("a settlement the plane will not take says which kind of no it was", async () => {
  for (const [status, expected] of [
    [204, "Settled"],
    [409, "Lost"],
    [401, "Stale"],
    [404, "Denied"],
    [400, "Denied"],
    [503, "Unavailable"],
  ] as const) {
    const plane = poolPlaneClient(planeSettings, () =>
      Promise.resolve(answered(status, "{}")),
    );
    assert.equal(
      await plane.settle("pool-token", "one", { outcome: "Accepted" }),
      expected,
      `status ${String(status)}`,
    );
  }
});

test("a plane address that carries a credential or no scheme is refused", () => {
  assert.throws(
    () =>
      checkedPoolPlaneClientSettings({
        ...planeSettings,
        baseUrl: "https://pool:secret@plane.invalid",
      }),
    RangeError,
  );
  assert.throws(
    () =>
      checkedPoolPlaneClientSettings({
        ...planeSettings,
        baseUrl: "ftp://plane.invalid",
      }),
    RangeError,
  );
});

test("a proxy's plain-text 404 from the token URL is an outage", async () => {
  assert.deepEqual(
    await poolClientTokens(
      tokenSettings(() => Promise.resolve(proxyNotFound())),
    ).acquire(),
    {
      acquired: "Unavailable",
      evidence: "client credentials grant returned 404",
    },
  );
});

test("Hydra's 401 invalid_client is an outage while it is confirmed, naming its code", async () => {
  assert.deepEqual(
    await poolClientTokens(
      tokenSettings(() => Promise.resolve(refusal(401, "invalid_client"))),
    ).acquire(),
    {
      acquired: "Unavailable",
      evidence:
        "client credentials grant returned 401 invalid_client, a refusal being confirmed: 0s of 60s",
    },
  );
});

/**
 * Each status, code and body is varied apart from the others, with a code no
 * failed lookup also gives, so that only the row naming `invalid_client` is an
 * outage by being confirmed.
 */
test("a grant the issuer refused is a denial, one a failed lookup also gives is confirmed first, and everything else is an outage, neither naming the secret", async () => {
  const secret = "s3cret-that-never-reaches-a-message";
  const oversized = JSON.stringify({
    error: "invalid_grant",
    error_description: "x".repeat(70_000),
  });
  for (const [answer, expected] of [
    ...[
      "invalid_request",
      "invalid_grant",
      "unauthorized_client",
      "unsupported_grant_type",
      "invalid_scope",
    ].map((code) => [() => refusal(400, code), "Denied"] as const),
    [() => refusal(401, "invalid_grant"), "Denied"],
    [() => refusal(400, "invalid_client"), "Unavailable"],
    [() => refusal(403, "invalid_grant"), "Unavailable"],
    [() => refusal(404, "invalid_request"), "Unavailable"],
    [() => refusal(401, "server_error"), "Unavailable"],
    [() => refusal(400, "temporarily_unavailable"), "Unavailable"],
    [() => new Response("{}", { status: 400 }), "Unavailable"],
    [() => new Response("{}", { status: 401 }), "Unavailable"],
    [
      () => new Response(JSON.stringify("invalid_grant"), { status: 401 }),
      "Unavailable",
    ],
    [() => new Response(oversized, { status: 401 }), "Unavailable"],
    [() => new Response("{}", { status: 500 }), "Unavailable"],
    [() => new Response("{}", { status: 503 }), "Unavailable"],
  ] as const) {
    const acquired = await poolClientTokens({
      ...tokenSettings(() => Promise.resolve(answer())),
      clientSecret: secret,
    }).acquire();
    assert.equal(acquired.acquired, expected, String(answer));
    assert.ok(!acquired.evidence.includes(secret), acquired.evidence);
  }
});

test("a granted answer with no token and an issuer that did not answer are both outages", async () => {
  const empty = poolClientTokens(
    tokenSettings(() =>
      Promise.resolve(answered(200, JSON.stringify({ expires_in: 60 }))),
    ),
  );
  assert.equal((await empty.acquire()).acquired, "Unavailable");
  const unreachable = poolClientTokens(
    tokenSettings(() => Promise.reject(new Error("connection refused"))),
  );
  assert.equal((await unreachable.acquire()).acquired, "Unavailable");
});

test("a granted token is handed over with the audience the pool was registered for", async () => {
  const sent: { body: string; authorization: string } = {
    body: "",
    authorization: "",
  };
  const tokens = poolClientTokens(
    tokenSettings((_input, init) => {
      sent.body = sentBody(init);
      sent.authorization = sentHeader(init, "authorization");
      return Promise.resolve(
        answered(
          200,
          JSON.stringify({
            access_token: "minted",
            token_type: "bearer",
            expires_in: 3_600,
          }),
        ),
      );
    }),
  );
  const acquired = await tokens.acquire();
  assert.equal(
    new URLSearchParams(sent.body).get("audience"),
    "https://api.invalid",
  );
  assert.equal(
    new URLSearchParams(sent.body).get("grant_type"),
    "client_credentials",
  );
  assert.equal(
    sent.authorization,
    `Basic ${Buffer.from("chuggy-pool-one:secret").toString("base64")}`,
  );
  assert.equal(acquired.acquired, "Token");
  assert.equal(acquired.acquired === "Token" ? acquired.token : "", "minted");
});

test("a token the plane refused is minted again on the next acquire", async () => {
  let granted = 0;
  let elapsedMs = 0;
  const tokens = poolClientTokens({
    ...tokenSettings(() => {
      granted += 1;
      return Promise.resolve(
        answered(
          200,
          JSON.stringify({
            access_token: `minted-${String(granted)}`,
            token_type: "bearer",
            expires_in: 3_600,
          }),
        ),
      );
    }),
    monotonicMs: () => (elapsedMs += 5_000),
  });
  const first = await tokens.acquire();
  assert.equal(first.acquired === "Token" ? first.token : "", "minted-1");
  const again = await tokens.acquire();
  assert.equal(again.acquired === "Token" ? again.token : "", "minted-1");
  tokens.invalidate("minted-1");
  const replaced = await tokens.acquire();
  assert.equal(replaced.acquired === "Token" ? replaced.token : "", "minted-2");
  assert.equal(granted, 2);
});

test("a poll and every settlement name the release this client was built with", async () => {
  const named: string[] = [];
  const plane = poolPlaneClient(planeSettings, (_input, init) => {
    named.push(sentHeader(init, workerContractHeader));
    return Promise.resolve(
      answered(
        200,
        JSON.stringify({ assignments: [], sessions: [], stop: [] }),
      ),
    );
  });
  await plane.poll("pool-token", [], 1, 0);
  await plane.settle("pool-token", "one", { outcome: "Accepted" });
  assert.deepEqual(named, [workerContractRelease, workerContractRelease]);
});

test("a plane refusing this client's release ends the pool rather than losing an assignment", async () => {
  const refusal = JSON.stringify({
    action: "stop",
    reason: "UnsupportedContractVersion",
    accepted: { min: "1.0", max: "1.0" },
  });
  const refusing = poolPlaneClient(planeSettings, () =>
    Promise.resolve(answered(409, refusal)),
  );
  const polled = await refusing.poll("pool-token", [], 1, 0);
  assert.equal(polled.polled, "Denied");
  assert.ok(
    polled.polled === "Denied" &&
      polled.evidence.includes(workerContractRelease),
  );
  assert.equal(
    await refusing.settle("pool-token", "one", { outcome: "Accepted" }),
    "Denied",
  );
  const losing = poolPlaneClient(planeSettings, () =>
    Promise.resolve(answered(409, "")),
  );
  assert.equal(
    await losing.settle("pool-token", "one", { outcome: "Accepted" }),
    "Lost",
  );
  assert.equal(
    (await losing.poll("pool-token", [], 1, 0)).polled,
    "Unavailable",
  );
});

/** A plane with nothing to offer, answering every poll as the plane does. */
const quietPlane = poolPlaneClient(planeSettings, () =>
  Promise.resolve(
    answered(200, JSON.stringify({ assignments: [], sessions: [], stop: [] })),
  ),
);

/** A backend holding nothing and placing everything. */
const idleBackend: WorkerPoolBackend = {
  place: () => Promise.resolve({ placed: "Placed" }),
  stop: () => Promise.resolve({ stopped: "Stopped" }),
  held: () => Promise.resolve([]),
  ended: () => Promise.resolve([]),
};

interface IssuedPool {
  readonly running: WorkerPoolClient;
  readonly minted: { count: number };
  sleep(milliseconds: number): () => Promise<void>;
}

/**
 * A pool over an issuer answering each grant from `issued` in turn, the last
 * from then on, on clocks that move only by what `sleep` moves them.
 */
function issuedPool(
  issued: readonly (() => Response)[],
  plane: WorkerPoolPlane = quietPlane,
): IssuedPool {
  const minted = { count: 0 };
  const clock = { nowEpochMs: 1_000_000, elapsedMs: 0 };
  const tokens = poolClientTokens({
    ...tokenSettings(() => {
      minted.count += 1;
      const answer = issued[Math.min(minted.count, issued.length) - 1];
      assert.ok(answer !== undefined);
      return Promise.resolve(answer());
    }),
    refreshMarginMs: 60_000,
    mintCooldownMs: 5_000,
    currentTimeEpochMs: () => clock.nowEpochMs,
    monotonicMs: () => clock.elapsedMs,
  });
  return {
    running: {
      tokens,
      plane,
      jobs: {
        end: () => Promise.reject(new Error("no job was killed in this case")),
      },
      backend: idleBackend,
      settings: { concurrencyMax: 1, outageBackoffMs: 1, passesMax: 10 },
    },
    minted,
    sleep: (milliseconds) => () => {
      clock.nowEpochMs += milliseconds;
      clock.elapsedMs += milliseconds;
      return Promise.resolve();
    },
  };
}

test("a run backs off through a proxy's 404 in front of the issuer and of the plane, and ends on the issuer refusing its client", async () => {
  let polled = 0;
  const plane = poolPlaneClient(planeSettings, () => {
    polled += 1;
    return Promise.resolve(proxyNotFound());
  });
  const issuer = issuedPool(
    [
      proxyNotFound,
      () => granted("token-1", 900),
      () => refusal(401, "invalid_client"),
    ],
    plane,
  );
  let slept = 0;
  const passed = await workerPoolClientRun(issuer.running, async () => {
    slept += 1;
    await issuer.sleep(841_000)();
  });
  assert.deepEqual(passed, {
    passed: "Denied",
    evidence: "client credentials grant returned 401 invalid_client",
  });
  assert.equal(slept, 3);
  assert.equal(issuer.minted.count, 4);
  assert.equal(polled, 1);
});

test("an invalid_client the issuer gives once and then grants past keeps the run going", async () => {
  const issuer = issuedPool([
    () => refusal(401, "invalid_client"),
    () => granted("token-1", 900),
  ]);
  const passed = await workerPoolClientRun(issuer.running, issuer.sleep(5_000));
  assert.equal(passed.passed, "Reconciled");
  assert.equal(issuer.minted.count, 2);
});

/**
 * Each grant is a pass and a back-off apart. The refusal is confirmed by the
 * first grant at least the interval after the first refused, and by no
 * earlier one.
 */
test("an invalid_client the issuer gives every grant across the interval ends the run, said to be confirmed until then", async () => {
  const issuer = issuedPool([() => refusal(401, "invalid_client")]);
  const passes: WorkerPoolPass[] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    passes.push(await workerPoolClientPass(issuer.running));
    await issuer.sleep(30_000)();
  }
  const confirming = "client credentials grant returned 401 invalid_client";
  assert.deepEqual(passes, [
    {
      passed: "Unavailable",
      evidence: `${confirming}, a refusal being confirmed: 0s of 60s`,
    },
    {
      passed: "Unavailable",
      evidence: `${confirming}, a refusal being confirmed: 30s of 60s`,
    },
    { passed: "Denied", evidence: confirming },
  ]);
  assert.equal(issuer.minted.count, 3);
});

/**
 * Each pass is longer apart than the interval, so a refusal carried across
 * the answer between would be final at the third pass rather than the fourth.
 */
test("a refusal any other answer breaks is confirmed afresh from the next", async () => {
  for (const [broken, between] of [
    [() => granted("token-1", 61), "Reconciled"],
    [proxyNotFound, "Unavailable"],
    [() => refusal(400, "invalid_client"), "Unavailable"],
  ] as const) {
    const issuer = issuedPool([
      () => refusal(401, "invalid_client"),
      broken,
      () => refusal(401, "invalid_client"),
    ]);
    const passes: string[] = [];
    for (let pass = 0; pass < 4; pass += 1) {
      passes.push((await workerPoolClientPass(issuer.running)).passed);
      await issuer.sleep(70_000)();
    }
    assert.deepEqual(
      passes,
      ["Unavailable", between, "Unavailable", "Denied"],
      String(broken),
    );
    assert.equal(issuer.minted.count, 4);
  }
});
