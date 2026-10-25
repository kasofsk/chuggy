import assert from "node:assert/strict";
import { test } from "node:test";

import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { RegisterPoolPorts } from "../../src/interpreter/workerPoolRegistration.ts";
import {
  workerPoolTokenLifetimeSecsMax,
  workerPoolTokenMint,
  workerPoolTokenRedeem,
  type WorkerPoolRegistrationTokenTerms,
  type WorkerPoolTokenMinting,
  type WorkerPoolTokenWritten,
} from "../../src/interpreter/workerPoolRegistrationToken.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const issuer = "https://issuer.invalid";
const site = {
  issuer,
  tokenUrl: "https://issuer.invalid/oauth2/token",
  audience: "https://api.invalid",
  planeUrl: "https://plane.invalid/",
};
const partition = { tenant: "tenant", project: "project" } as Partition;
const principal = oidcPrincipal(issuer, "an-owner");

/** An authority that permits everyone, or nobody, and nothing between. */
function authority(allowed: boolean): ProjectAccess {
  return {
    authorize: (asked) =>
      Promise.resolve(allowed ? memberAuthority(asked) : undefined),
    authorizeTenant: () => Promise.resolve(undefined),
    authorizeSite: projectAccessSiteRefused,
  };
}

/** A token store holding at most one token, the one it holds or last minted, so single use is what a case reads. */
function minting(input?: {
  readonly held?: WorkerPoolRegistrationTokenTerms;
  readonly answers?: WorkerPoolTokenWritten;
}): WorkerPoolTokenMinting & { readonly made: unknown[] } {
  const made: unknown[] = [];
  let held = input?.held;
  let spent: WorkerPoolRegistrationTokenTerms | undefined;
  return {
    made,
    draw: () => "a-drawn-token",
    digest: (token) => `digest-of-${token}`,
    nowMs: () => 1_000,
    tokens: {
      mint: (named, digest, expiresAtMs, mintedBy) => {
        made.push(["mint", named, digest, expiresAtMs, mintedBy]);
        const answers = input?.answers ?? "Minted";
        if (answers === "Minted") held = { partition: named, mintedBy };
        return Promise.resolve(answers);
      },
      consume: (digest) => {
        made.push(["consume", digest]);
        spent = held;
        held = undefined;
        return Promise.resolve(spent);
      },
      restore: (digest) => {
        made.push(["restore", digest]);
        held = spent;
        return Promise.resolve(held !== undefined);
      },
    },
  };
}

/** Registration ports that always succeed, so the token's decision is what a case reads. */
function ports(): RegisterPoolPorts & { readonly made: unknown[] } {
  const made: unknown[] = [];
  return {
    made,
    registry: {
      register: (registration) =>
        Promise.resolve((made.push(["register", registration]), true)),
      clientOf: () => Promise.resolve(undefined),
      deregister: () => Promise.resolve(false),
      identify: () => Promise.resolve(undefined),
    },
    clients: {
      create: (clientId) =>
        Promise.resolve({ clientId, clientSecret: "a-secret" }),
      remove: () => Promise.resolve(undefined),
    },
    grants: {
      write: () => Promise.resolve(undefined),
      writeAll: () => Promise.reject(new Error("registration writes no list")),
      remove: () => Promise.resolve(undefined),
    },
    clientId: () => "chuggy-pool-fixed",
  };
}

test("an owner's mint stores only the digest, its scope, its minter and its expiry, and answers the token once", async () => {
  const store = minting();
  assert.deepEqual(
    await workerPoolTokenMint(authority(true), store, principal, partition, {
      lifetimeSecs: 60,
    }),
    {
      result: "Minted",
      value: { token: "a-drawn-token", expiresAtMs: 61_000 },
    },
  );
  assert.deepEqual(store.made, [
    ["mint", partition, "digest-of-a-drawn-token", 61_000, principal],
  ]);
});

test("a caller the authority does not admit mints nothing and is told nothing", async () => {
  const store = minting();
  assert.deepEqual(
    await workerPoolTokenMint(authority(false), store, principal, partition, {
      lifetimeSecs: 60,
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(store.made, []);
});

for (const [answers, result] of [
  ["NotFound", "NotFound"],
  ["LimitReached", "LimitReached"],
] as const)
  test(`a store answering ${answers} mints nothing and says so`, async () => {
    assert.deepEqual(
      await workerPoolTokenMint(
        authority(true),
        minting({ answers }),
        principal,
        partition,
        { lifetimeSecs: 60 },
      ),
      { result },
    );
  });

for (const lifetimeSecs of [0, -1, 1.5, workerPoolTokenLifetimeSecsMax + 1])
  test(`a lifetime of ${String(lifetimeSecs)} is refused before anything is asked`, async () => {
    await assert.rejects(
      workerPoolTokenMint(authority(true), minting(), principal, partition, {
        lifetimeSecs,
      }),
      RangeError,
    );
  });

test("redeeming registers the pool for the partition the token named, by the member who minted it", async () => {
  const store = minting({ held: { partition, mintedBy: principal } });
  const made = ports();
  assert.deepEqual(
    await workerPoolTokenRedeem(store, made, site, {
      token: "a-drawn-token",
      pool: "pool-one",
      capabilities: ["amd64"],
    }),
    {
      result: "Registered",
      value: {
        partition,
        pool: "pool-one",
        capabilities: ["amd64"],
        tokenUrl: site.tokenUrl,
        audience: site.audience,
        planeUrl: site.planeUrl,
        clientId: "chuggy-pool-fixed",
        clientSecret: "a-secret",
      },
    },
  );
  assert.deepEqual(made.made, [
    [
      "register",
      {
        partition,
        pool: "pool-one",
        capabilities: ["amd64"],
        class: "Dedicated",
        clientId: "chuggy-pool-fixed",
        principal: oidcPrincipal(issuer, "chuggy-pool-fixed"),
        registeredBy: principal,
      },
    ],
  ]);
});

test("a redemption carries the registry a runner pulls from only where the deployment names one", async () => {
  const offered = {
    token: "a-drawn-token",
    pool: "pool-one",
    capabilities: ["linux"],
  };
  const named = await workerPoolTokenRedeem(
    minting({ held: { partition } }),
    ports(),
    { ...site, registryHost: "registry.invalid" },
    offered,
  );
  assert.equal(
    named.result === "Registered" ? named.value.registryHost : undefined,
    "registry.invalid",
  );
  const unnamed = await workerPoolTokenRedeem(
    minting({ held: { partition } }),
    ports(),
    site,
    offered,
  );
  assert.equal(
    unnamed.result === "Registered" && "registryHost" in unnamed.value,
    false,
  );
});

test("a minted token registers whatever its pool declares, nothing having been named for it at the mint", async () => {
  const store = minting();
  await workerPoolTokenMint(authority(true), store, principal, partition, {
    lifetimeSecs: 60,
  });
  const made = ports();
  const redeemed = await workerPoolTokenRedeem(store, made, site, {
    token: "a-drawn-token",
    pool: "pool-one",
    capabilities: ["Platform:MacOS:Arm64", "Agent:Codex"],
  });
  assert.deepEqual(
    redeemed.result === "Registered" ? redeemed.value.capabilities : redeemed,
    ["Platform:MacOS:Arm64", "Agent:Codex"],
  );
  assert.deepEqual(made.made, [
    [
      "register",
      {
        partition,
        pool: "pool-one",
        capabilities: ["Platform:MacOS:Arm64", "Agent:Codex"],
        class: "Dedicated",
        clientId: "chuggy-pool-fixed",
        principal: oidcPrincipal(issuer, "chuggy-pool-fixed"),
        registeredBy: principal,
      },
    ],
  ]);
});

test("a token is spent once, and the second redemption is told nothing", async () => {
  const store = minting({ held: { partition } });
  const offered = {
    token: "a-drawn-token",
    pool: "pool-one",
    capabilities: ["linux"],
  };
  assert.equal(
    (await workerPoolTokenRedeem(store, ports(), site, offered)).result,
    "Registered",
  );
  assert.deepEqual(await workerPoolTokenRedeem(store, ports(), site, offered), {
    result: "NotFound",
  });
});

test("a token no store holds registers nothing", async () => {
  const made = ports();
  assert.deepEqual(
    await workerPoolTokenRedeem(minting(), made, site, {
      token: "a-drawn-token",
      pool: "pool-one",
      capabilities: [],
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(made.made, []);
});

test("a registration that faulted after the spend gives the token back for the retry", async () => {
  const store = minting({ held: { partition } });
  const made = ports();
  const outage = new Error("the issuer is unreachable");
  made.clients.create = () => Promise.reject(outage);
  const offered = {
    token: "a-drawn-token",
    pool: "pool-one",
    capabilities: ["linux"],
  };
  await assert.rejects(
    workerPoolTokenRedeem(store, made, site, offered),
    outage,
  );
  assert.deepEqual(store.made.slice(-2), [
    ["consume", "digest-of-a-drawn-token"],
    ["restore", "digest-of-a-drawn-token"],
  ]);
  made.clients.create = (clientId) =>
    Promise.resolve({ clientId, clientSecret: "a-secret" });
  assert.equal(
    (await workerPoolTokenRedeem(store, made, site, offered)).result,
    "Registered",
  );
});
