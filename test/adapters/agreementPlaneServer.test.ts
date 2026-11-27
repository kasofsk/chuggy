/**
 * The agreement plane's two servers over a store in memory: the policies
 * served to anyone, a caller's standing and agreement served about them alone,
 * the evidence an agreement keeps, and one person's standing served on the
 * service listener alone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAgreementPlaneApp,
  createAgreementPlaneServiceApp,
} from "../../src/adapters/http/agreementPlaneServer.ts";
import type { BearerAuthentication } from "../../src/adapters/http/server.ts";
import {
  agreementPlanePersonStandingPath,
  agreementPlaneRoutes,
  agreementPoliciesChangedResponseSchema,
  agreementPoliciesSchema,
  agreementStandingSchema,
  agreementUserAgentCharsMax,
} from "../../src/contract/agreementPlane.ts";
import {
  errorEnvelopeSchema,
  nativeHttpMediaType,
} from "../../src/contract/http.ts";
import { agreementPlane } from "../../src/interpreter/agreementPlane.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  agreementFixtureEntry,
  agreementFixtureIssuer,
  agreementFixturePrincipal,
  agreementMemory,
} from "../interpreter/agreementPlaneFixture.ts";

const terms = agreementFixtureEntry("terms", "2026-11");
const privacy = agreementFixtureEntry("privacy", "v3");

/** The tokens the fake issuer knows, each the principal it names. */
const tokens: Readonly<Record<string, Principal>> = {
  "alice-token": agreementFixturePrincipal("alice"),
  "bob-token": agreementFixturePrincipal("bob"),
  "stranger-token": oidcPrincipal("https://other.example", "alice"),
};

const authentication = {
  authenticateBearer: (token: string): Promise<BearerAuthentication> => {
    const principal = tokens[token];
    return Promise.resolve(
      principal === undefined
        ? { authenticated: "InvalidToken" }
        : {
            authenticated: "Bearer",
            bearer: { principal },
          },
    );
  },
};

function served(clientAddressHeader?: string) {
  const memory = agreementMemory();
  const plane = agreementPlane(memory.store, {
    issuer: agreementFixtureIssuer,
    policies: [terms, privacy],
  });
  const callers = createAgreementPlaneApp({
    authentication,
    plane,
    clientAddressHeader,
    ready: () => Promise.resolve(true),
  });
  const service = createAgreementPlaneServiceApp(plane);
  return { memory, callers, service };
}

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const typed = { "content-type": nativeHttpMediaType };
const named = (entry: typeof terms) => ({
  policy: entry.policy,
  version: entry.version,
  digest: entry.digest,
});

function agreeing(
  token: string,
  agreements: readonly unknown[],
  headers: Readonly<Record<string, string>> = {},
) {
  return {
    method: "POST" as const,
    url: agreementPlaneRoutes.agreements.path,
    headers: { ...as(token), ...typed, ...headers },
    payload: JSON.stringify({ agreements }),
  };
}

test("the policies are served to anyone, a bearer sent with them not read", async () => {
  const { callers } = served();
  for (const headers of [{}, as("forged"), as("alice-token")]) {
    const reply = await callers.inject({
      url: agreementPlaneRoutes.policies.path,
      headers,
    });
    assert.equal(reply.statusCode, 200);
    assert.match(
      String(reply.headers["content-type"]),
      new RegExp(`^${nativeHttpMediaType.replace(/[.+]/gu, "\\$&")}`, "u"),
    );
    assert.deepEqual(agreementPoliciesSchema.parse(reply.json()), {
      policies: [terms, privacy],
    });
  }
});

test("a caller's standing names every current policy, agreedAt only where they agreed", async () => {
  const { callers } = served();
  const agreed = await callers.inject(agreeing("alice-token", [named(terms)]));
  assert.equal(agreed.statusCode, 200);
  const standing = agreementStandingSchema.parse(agreed.json());
  assert.equal(typeof standing.policies[0]?.agreedAt, "string");
  assert.equal("agreedAt" in (standing.policies[1] ?? {}), false);
  const read = await callers.inject({
    url: agreementPlaneRoutes.standing.path,
    headers: as("alice-token"),
  });
  assert.deepEqual(read.json(), agreed.json());
});

test("one caller's standing is unchanged by another caller's agreement", async () => {
  const { callers } = served();
  await callers.inject(agreeing("alice-token", [named(terms), named(privacy)]));
  const bob = await callers.inject({
    url: agreementPlaneRoutes.standing.path,
    headers: as("bob-token"),
  });
  assert.deepEqual(bob.json(), { policies: [terms, privacy] });
});

test("a caller under another issuer is answered NotFound on both signed-in routes", async () => {
  const { callers, memory } = served();
  for (const reply of [
    await callers.inject({
      url: agreementPlaneRoutes.standing.path,
      headers: as("stranger-token"),
    }),
    await callers.inject(agreeing("stranger-token", [named(terms)])),
  ]) {
    assert.equal(reply.statusCode, 404);
    assert.equal(
      errorEnvelopeSchema.parse(reply.json()).error.code,
      "NotFound",
    );
  }
  assert.deepEqual(memory.rows, []);
});

test("an unsigned caller is refused both signed-in routes", async () => {
  const { callers } = served();
  for (const reply of [
    await callers.inject({ url: agreementPlaneRoutes.standing.path }),
    await callers.inject(agreeing("forged", [named(terms)])),
  ])
    assert.equal(reply.statusCode, 401);
});

test("an agreement naming one stale policy among current ones writes nothing and is answered PoliciesChanged", async () => {
  const { callers, memory } = served();
  const reply = await callers.inject(
    agreeing("alice-token", [
      named(terms),
      { ...named(privacy), version: "v2" },
    ]),
  );
  assert.equal(reply.statusCode, 409);
  const refused = agreementPoliciesChangedResponseSchema.parse(reply.json());
  assert.equal(refused.error.code, "PoliciesChanged");
  assert.deepEqual(refused.policies, [terms, privacy]);
  assert.deepEqual(memory.rows, []);
});

test("an agreement naming no policy, or one twice, is refused as malformed", async () => {
  const { callers, memory } = served();
  for (const agreements of [[], [named(terms), named(terms)]]) {
    const reply = await callers.inject(agreeing("alice-token", agreements));
    assert.equal(reply.statusCode, 400);
  }
  assert.deepEqual(memory.rows, []);
});

test("the client address is the socket's peer unless the deployment named a header, and only that header", async () => {
  const forwarded = { "x-forwarded-for": "198.51.100.9" };
  const unnamed = served();
  await unnamed.callers.inject({
    ...agreeing("alice-token", [named(terms)], forwarded),
    remoteAddress: "192.0.2.1",
  });
  assert.equal(unnamed.memory.rows[0]?.evidence.clientAddress, "192.0.2.1");
  const headerNamed = served("x-forwarded-for");
  await headerNamed.callers.inject({
    ...agreeing("alice-token", [named(terms)], forwarded),
    remoteAddress: "192.0.2.1",
  });
  assert.equal(
    headerNamed.memory.rows[0]?.evidence.clientAddress,
    "198.51.100.9",
  );
  const other = served("x-real-ip");
  await other.callers.inject({
    ...agreeing("alice-token", [named(terms)], forwarded),
    remoteAddress: "192.0.2.1",
  });
  assert.equal(other.memory.rows[0]?.evidence.clientAddress, undefined);
});

test("a named header holding anything but one IP address records none and the agreement stands", async () => {
  for (const value of ["198.51.100.9, 203.0.113.4", "not-an-address", ""]) {
    const { callers, memory } = served("x-forwarded-for");
    const reply = await callers.inject(
      agreeing("alice-token", [named(terms)], { "x-forwarded-for": value }),
    );
    assert.equal(reply.statusCode, 200, value);
    assert.equal(memory.rows.length, 1);
    assert.equal(memory.rows[0]?.evidence.clientAddress, undefined, value);
  }
});

test("a user agent past its bound is recorded cut to it", async () => {
  const { callers, memory } = served();
  await callers.inject(
    agreeing("alice-token", [named(terms)], {
      "user-agent": "u".repeat(agreementUserAgentCharsMax + 5),
    }),
  );
  assert.equal(
    memory.rows[0]?.evidence.userAgent,
    "u".repeat(agreementUserAgentCharsMax),
  );
});

test("a person's standing is served on the service listener and not on the callers'", async () => {
  const { callers, service } = served();
  const principal = agreementFixturePrincipal("alice");
  await callers.inject(agreeing("alice-token", [named(privacy)]));
  const path = agreementPlanePersonStandingPath(principal);
  const answered = await service.inject({ url: path });
  assert.equal(answered.statusCode, 200);
  const standing = agreementStandingSchema.parse(answered.json());
  assert.equal(standing.policies[0]?.agreedAt, undefined);
  assert.equal(typeof standing.policies[1]?.agreedAt, "string");
  for (const headers of [{}, as("alice-token")]) {
    const unserved = await callers.inject({ url: path, headers });
    assert.equal(unserved.statusCode, 404);
    assert.equal(
      errorEnvelopeSchema.parse(unserved.json()).error.code,
      "NotFound",
    );
  }
});

test("a principal with no row is answered every current policy with no agreedAt", async () => {
  const { service } = served();
  const reply = await service.inject({
    url: agreementPlanePersonStandingPath("https://x.example/never seen/♥"),
  });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json(), { policies: [terms, privacy] });
});

test("the service listener serves none of the callers' routes", async () => {
  const { service, memory } = served();
  for (const reply of [
    await service.inject({ url: agreementPlaneRoutes.policies.path }),
    await service.inject({
      url: agreementPlaneRoutes.standing.path,
      headers: as("alice-token"),
    }),
    await service.inject(agreeing("alice-token", [named(terms)])),
  ]) {
    assert.equal(reply.statusCode, 404);
    assert.equal(
      errorEnvelopeSchema.parse(reply.json()).error.code,
      "NotFound",
    );
  }
  assert.deepEqual(memory.rows, []);
});
