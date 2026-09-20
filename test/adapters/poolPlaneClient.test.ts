import assert from "node:assert/strict";
import test from "node:test";

import { poolClientTokens } from "../../src/adapters/http/poolTokens.ts";
import {
  checkedPoolPlaneClientSettings,
  poolPlaneClient,
} from "../../src/adapters/http/poolPlaneClient.ts";

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

/** One answer as the plane would send it, with no server to send it. */
function answered(status: number, body: string): Response {
  return new Response(status === 204 ? null : body, { status });
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
      answered(200, JSON.stringify({ assignments: [assignment], stop: ["a"] })),
    );
  });
  const polled = await plane.poll("pool-token", ["one", "two"], 3);
  assert.equal(
    seen.url,
    "https://pool-plane.invalid/v1/assignments?held=one&held=two&wanted=3",
  );
  assert.equal(seen.authorization, "Bearer pool-token");
  assert.equal(polled.polled, "Reconciled");
  if (polled.polled !== "Reconciled") return;
  assert.deepEqual(polled.assignments, [assignment]);
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
    const polled = await plane.poll("pool-token", [], 1);
    assert.equal(polled.polled, expected, `status ${String(status)}`);
  }
});

test("an answer this pool cannot read is an outage rather than a refusal", async () => {
  for (const body of ["not json", JSON.stringify({ assignments: [{}] })]) {
    const plane = poolPlaneClient(planeSettings, () =>
      Promise.resolve(answered(200, body)),
    );
    const polled = await plane.poll("pool-token", [], 1);
    assert.equal(polled.polled, "Unavailable");
  }
});

test("a plane that could not be reached is an outage and raises nothing", async () => {
  const plane = poolPlaneClient(planeSettings, () =>
    Promise.reject(new Error("connection refused")),
  );
  const polled = await plane.poll("pool-token", [], 1);
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
  await plane.settle("pool-token", "three", {
    outcome: "Unavailable",
    retryAfterSecs: 9,
  });
  assert.deepEqual(
    sent.map((request) => request.url),
    [
      "https://pool-plane.invalid/v1/assignments/one/accepted",
      "https://pool-plane.invalid/v1/assignments/two/refused",
      "https://pool-plane.invalid/v1/assignments/three/unavailable",
    ],
  );
  assert.deepEqual(
    sent.map((request) => request.body),
    ["{}", '{"evidence":"refused"}', '{"retryAfterSecs":9}'],
  );
});

test("a settlement the plane will not take says which kind of no it was", async () => {
  for (const [status, expected] of [
    [204, "Settled"],
    [409, "Lost"],
    [401, "Stale"],
    [404, "Denied"],
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

test("a grant the issuer refused is a denial and everything else is an outage", async () => {
  for (const [status, expected] of [
    [400, "Denied"],
    [401, "Denied"],
    [403, "Denied"],
    [500, "Unavailable"],
    [503, "Unavailable"],
  ] as const) {
    const tokens = poolClientTokens(
      tokenSettings(() => Promise.resolve(answered(status, "{}"))),
    );
    assert.equal(
      (await tokens.acquire()).acquired,
      expected,
      `status ${String(status)}`,
    );
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
