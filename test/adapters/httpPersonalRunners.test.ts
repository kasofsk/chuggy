/**
 * A member's own runners as their routes answer them: what each outcome of the
 * service is sent as, which caller and which tenant, project, runner and
 * subject each route hands the service, and that the redemption is public and
 * answers a file of its own kind.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  personalRunnerCredentialsSchema,
  personalRunnerPermitResponseSchema,
  personalRunnerResponseSchema,
  workerPoolCredentialsSchema,
} from "../../src/contract/responses.ts";
import type {
  PersonalRunnerRead,
  PersonalRunnerRedemption,
  PersonalRunnerService,
  PersonalRunnerTokenRedeemed,
} from "../../src/interpreter/personalRunnerRegistration.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import { callerApp } from "./callerAppFixture.ts";

const caller = asPrincipal("issuer-subject");
const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };

/** A redemption answered by the token it offers. */
function fakeRunnersRedeemed(
  offered: PersonalRunnerRedemption,
): PersonalRunnerTokenRedeemed {
  switch (offered.token) {
    case "a-token":
      return {
        result: "Registered",
        value: {
          tenant: asTenantId("acme"),
          owner: caller,
          capabilities: offered.capabilities,
          tokenUrl: "https://issuer.invalid/oauth2/token",
          audience: "https://api.invalid",
          planeUrl: "https://plane.invalid/",
          clientId: "chuggy-personal-one",
          clientSecret: "a-secret",
        },
      };
    case "bounded":
      return { result: "LimitReached" };
    default:
      return { result: "NotFound" };
  }
}

/** The caller's runners as the tenant a case names answers them: two in one, none elsewhere. */
function fakeRunnersRead(tenant: TenantId): PersonalRunnerRead {
  return tenant === "acme"
    ? {
        result: "Found",
        value: {
          runners: [
            {
              id: "chuggy-personal-one",
              capabilities: ["linux"],
              registeredAt: "2026-10-09T12:00:00.000Z",
              polledAt: "2026-10-09T12:01:00.000Z",
              live: true,
              executionsLive: false,
              runner: { package: "chuggy-linux", version: "0.14.0" },
            },
            {
              id: "chuggy-personal-two",
              capabilities: ["macos"],
              registeredAt: "2026-10-09T12:02:00.000Z",
              live: false,
              executionsLive: false,
            },
          ],
          projects: [asProjectId("atlas")],
        },
      }
    : { result: "NotFound" };
}

/** A service answering by the tenant, project or token a case names, and recording what it was asked. */
function fakeRunners(calls: string[]): PersonalRunnerService {
  return {
    mint: (principal, tenant, request) => {
      calls.push(`mint:${principal}:${tenant}:${JSON.stringify(request)}`);
      if (tenant === "full") return Promise.resolve({ result: "LimitReached" });
      return Promise.resolve(
        tenant === "acme"
          ? {
              result: "Minted",
              value: { token: "a-token", expiresAtMs: 5_000 },
            }
          : { result: "NotFound" },
      );
    },
    redeem: (offered) => {
      calls.push(`redeem:${offered.token}`);
      return Promise.resolve(fakeRunnersRedeemed(offered));
    },
    runners: (principal, tenant) => {
      calls.push(`runners:${principal}:${tenant}`);
      return Promise.resolve(fakeRunnersRead(tenant));
    },
    permitted: (principal, tenant) => {
      calls.push(`permitted:${principal}:${tenant}`);
      return Promise.resolve(tenant === "acme");
    },
    allow: (principal, tenant, project) => {
      calls.push(`allow:${principal}:${tenant}:${project}`);
      if (project === "full") return Promise.resolve("LimitReached");
      return Promise.resolve(project === "atlas" ? "Allowed" : "NotFound");
    },
    disallow: (principal, tenant, project) => {
      calls.push(`disallow:${principal}:${tenant}:${project}`);
      return Promise.resolve(tenant === "acme" ? "Removed" : "NotFound");
    },
    deregister: (principal, tenant) => {
      calls.push(`deregister:${principal}:${tenant}`);
      return Promise.resolve(tenant === "acme" ? "Deregistered" : "NotFound");
    },
    deregisterRunner: (principal, tenant, runner) => {
      calls.push(`deregister-runner:${principal}:${tenant}:${runner}`);
      return Promise.resolve(
        runner === "chuggy-personal-one" ? "Deregistered" : "NotFound",
      );
    },
    deregisterMember: (principal, tenant, subject) => {
      calls.push(`deregister-member:${principal}:${tenant}:${subject}`);
      return Promise.resolve(
        subject === "a-member" ? "Deregistered" : "NotFound",
      );
    },
  };
}

function runnersApp(calls: string[]) {
  return callerApp(caller, { personalRunners: fakeRunners(calls) });
}

const tokens = (tenant: string) =>
  nativeHttpRoutes.personalRunnerRegistrationTokens.replace(":tenant", tenant);
const runner = (tenant: string) =>
  nativeHttpRoutes.personalRunner.replace(":tenant", tenant);
const one = (tenant: string, id: string) =>
  nativeHttpRoutes.personalRunnerRunner
    .replace(":tenant", tenant)
    .replace(":runner", id);
const allowed = (tenant: string, project: string) =>
  nativeHttpRoutes.personalRunnerProject
    .replace(":tenant", tenant)
    .replace(":project", project);

test("a member mints a token for their tenant as themselves, and a tenant that does not permit them is not found", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  const mint = (tenant: string, payload: object = {}) =>
    app.inject({
      method: "POST",
      url: tokens(tenant),
      headers: { ...bearer, ...json },
      payload: JSON.stringify({ lifetimeSecs: 60, ...payload }),
    });
  const minted = await mint("acme");
  assert.equal(minted.statusCode, 201);
  assert.deepEqual(minted.json(), { token: "a-token", expiresAtMs: 5_000 });
  assert.equal(
    (await mint("acme", { capabilities: ["Platform:Linux:Amd64"] })).statusCode,
    201,
    "a mint still naming capabilities mints, and they reach nothing",
  );
  assert.equal((await mint("other")).statusCode, 404);
  const full = await mint("full");
  assert.equal(full.statusCode, 409);
  assert.equal(
    full.json<{ error: { code: string } }>().error.code,
    "TokenLimitReached",
  );
  const unauthenticated = await app.inject({
    method: "POST",
    url: tokens("acme"),
    headers: json,
    payload: JSON.stringify({ lifetimeSecs: 60 }),
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(calls, [
    `mint:${caller}:acme:{"lifetimeSecs":60}`,
    `mint:${caller}:acme:{"lifetimeSecs":60}`,
    `mint:${caller}:other:{"lifetimeSecs":60}`,
    `mint:${caller}:full:{"lifetimeSecs":60}`,
  ]);
});

test("a redemption needs no bearer and answers a file of kind Personal naming the tenant and the owner and no project", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  const redeem = (token: string, payload: object = {}) =>
    app.inject({
      method: "POST",
      url: nativeHttpRoutes.personalRunnerRegistrations,
      headers: json,
      payload: JSON.stringify({ token, capabilities: ["linux"], ...payload }),
    });
  const redeemed = await redeem("a-token");
  assert.equal(redeemed.statusCode, 201);
  assert.deepEqual(personalRunnerCredentialsSchema.parse(redeemed.json()), {
    kind: "Personal",
    tenant: "acme",
    owner: caller,
    capabilities: ["linux"],
    tokenUrl: "https://issuer.invalid/oauth2/token",
    audience: "https://api.invalid",
    planeUrl: "https://plane.invalid/",
    clientId: "chuggy-personal-one",
    clientSecret: "a-secret",
  });
  assert.equal(
    workerPoolCredentialsSchema.safeParse(redeemed.json()).success,
    false,
    "a pool's runner reading this file refuses it rather than inventing a project",
  );
  assert.equal((await redeem("spent")).statusCode, 404);
  const bounded = await redeem("bounded");
  assert.equal(bounded.statusCode, 409);
  assert.equal(
    bounded.json<{ error: { code: string } }>().error.code,
    "RunnerLimitReached",
  );
  assert.equal(
    (await redeem("a-token", { pool: "a-pool" })).statusCode,
    400,
    "a personal redemption names no pool",
  );
});

test("a member reads their own runners, each by its id, beside the projects they serve, and a tenant they have none in is not found", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  const found = await app.inject({ url: runner("acme"), headers: bearer });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(personalRunnerResponseSchema.parse(found.json()), {
    runners: [
      {
        id: "chuggy-personal-one",
        capabilities: ["linux"],
        registeredAt: "2026-10-09T12:00:00.000Z",
        polledAt: "2026-10-09T12:01:00.000Z",
        live: true,
        executionsLive: false,
        runner: { package: "chuggy-linux", version: "0.14.0" },
      },
      {
        id: "chuggy-personal-two",
        capabilities: ["macos"],
        registeredAt: "2026-10-09T12:02:00.000Z",
        live: false,
        executionsLive: false,
      },
    ],
    projects: ["atlas"],
  });
  assert.equal(
    (await app.inject({ url: runner("other"), headers: bearer })).statusCode,
    404,
  );
  assert.deepEqual(calls, [
    `runners:${caller}:acme`,
    `runners:${caller}:other`,
  ]);
});

test("a member is told whether their tenant permits them a runner, as themselves", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  const permit = (tenant: string) =>
    app.inject({
      url: nativeHttpRoutes.personalRunnerPermit.replace(":tenant", tenant),
      headers: bearer,
    });
  const granted = await permit("acme");
  assert.equal(granted.statusCode, 200);
  assert.deepEqual(personalRunnerPermitResponseSchema.parse(granted.json()), {
    granted: true,
  });
  assert.deepEqual((await permit("other")).json(), { granted: false });
  assert.equal(
    (
      await app.inject({
        url: nativeHttpRoutes.personalRunnerPermit.replace(":tenant", "acme"),
      })
    ).statusCode,
    401,
  );
  assert.deepEqual(calls, [
    `permitted:${caller}:acme`,
    `permitted:${caller}:other`,
  ]);
});

test("a project is added to and removed from the caller's own allowlist", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  const put = (project: string) =>
    app.inject({
      method: "PUT",
      url: allowed("acme", project),
      headers: bearer,
    });
  assert.equal((await put("atlas")).statusCode, 204);
  assert.equal((await put("unreadable")).statusCode, 404);
  const full = await put("full");
  assert.equal(full.statusCode, 409);
  assert.equal(
    full.json<{ error: { code: string } }>().error.code,
    "AllowlistLimitReached",
  );
  const removed = await app.inject({
    method: "DELETE",
    url: allowed("acme", "atlas"),
    headers: bearer,
  });
  assert.equal(removed.statusCode, 204);
  const none = await app.inject({
    method: "DELETE",
    url: allowed("other", "atlas"),
    headers: bearer,
  });
  assert.equal(none.statusCode, 404);
  assert.deepEqual(calls, [
    `allow:${caller}:acme:atlas`,
    `allow:${caller}:acme:unreadable`,
    `allow:${caller}:acme:full`,
    `disallow:${caller}:acme:atlas`,
    `disallow:${caller}:other:atlas`,
  ]);
});

test("an allowlist write reaches the service however a bodyless request is framed on its way in", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  for (const method of ["PUT", "DELETE"] as const)
    for (const framing of [
      { "transfer-encoding": "chunked" },
      { "content-type": "application/octet-stream" },
      { "content-type": nativeHttpMediaType },
    ]) {
      const answered = await app.inject({
        method,
        url: allowed("acme", "atlas"),
        headers: { ...bearer, ...framing },
        payload: "",
      });
      assert.equal(
        answered.statusCode,
        204,
        `${method} ${JSON.stringify(framing)}`,
      );
    }
  assert.equal(calls.length, 6);
});

test("runners are taken off by their owner, one by its id or all at once, or by their member's subject", async () => {
  const calls: string[] = [];
  await using app = runnersApp(calls);
  const remove = (url: string) =>
    app.inject({ method: "DELETE", url, headers: bearer });
  assert.equal(
    (await remove(one("acme", "chuggy-personal-one"))).statusCode,
    204,
  );
  assert.equal((await remove(one("acme", "unknown"))).statusCode, 404);
  assert.equal((await remove(runner("acme"))).statusCode, 204);
  assert.equal((await remove(runner("other"))).statusCode, 404);
  const member = (subject: string) =>
    nativeHttpRoutes.personalRunnerMember
      .replace(":tenant", "acme")
      .replace(":subject", subject);
  assert.equal((await remove(member("a-member"))).statusCode, 204);
  assert.equal((await remove(member("nobody"))).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: one("acme", "chuggy-personal-one"),
      })
    ).statusCode,
    401,
  );
  assert.deepEqual(calls, [
    `deregister-runner:${caller}:acme:chuggy-personal-one`,
    `deregister-runner:${caller}:acme:unknown`,
    `deregister:${caller}:acme`,
    `deregister:${caller}:other`,
    `deregister-member:${caller}:acme:a-member`,
    `deregister-member:${caller}:acme:nobody`,
  ]);
});
