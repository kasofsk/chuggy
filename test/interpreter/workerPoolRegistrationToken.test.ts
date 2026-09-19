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
} from "../../src/interpreter/workerPoolRegistrationToken.ts";

const issuer = "https://issuer.invalid";
const partition = { tenant: "tenant", project: "project" } as Partition;
const principal = oidcPrincipal(issuer, "an-owner");

/** An authority that permits everyone, or nobody, and nothing between. */
function authority(allowed: boolean): ProjectAccess {
  return {
    authorize: (asked) =>
      Promise.resolve(allowed ? memberAuthority(asked) : undefined),
    authorizeTenant: () => Promise.resolve(undefined),
  };
}

/** A token store holding at most one token, so single use is what a case reads. */
function minting(input?: {
  readonly held?: WorkerPoolRegistrationTokenTerms;
  readonly accepts?: boolean;
}): WorkerPoolTokenMinting & { readonly made: unknown[] } {
  const made: unknown[] = [];
  let held = input?.held;
  return {
    made,
    draw: () => "a-drawn-token",
    digest: (token) => `digest-of-${token}`,
    nowMs: () => 1_000,
    tokens: {
      mint: (named, digest, capabilities, expiresAtMs) =>
        Promise.resolve(
          (made.push(["mint", named, digest, capabilities, expiresAtMs]),
          input?.accepts ?? true),
        ),
      permitted: (digest) =>
        Promise.resolve((made.push(["permitted", digest]), held)),
      consume: (digest) => {
        made.push(["consume", digest]);
        const spent = held;
        held = undefined;
        return Promise.resolve(spent);
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
      deregister: () => Promise.resolve(undefined),
      identify: () => Promise.resolve(undefined),
    },
    clients: {
      create: (clientId) =>
        Promise.resolve({ clientId, clientSecret: "a-secret" }),
      remove: () => Promise.resolve(undefined),
    },
    grants: {
      write: () => Promise.resolve(undefined),
      remove: () => Promise.resolve(undefined),
    },
    clientId: () => "chuggy-pool-fixed",
  };
}

test("an owner's mint stores only the digest and answers the token once", async () => {
  const store = minting();
  assert.deepEqual(
    await workerPoolTokenMint(authority(true), store, principal, partition, {
      capabilities: ["linux-containers"],
      lifetimeSecs: 60,
    }),
    {
      result: "Minted",
      value: { token: "a-drawn-token", expiresAtMs: 61_000 },
    },
  );
  assert.deepEqual(store.made, [
    [
      "mint",
      partition,
      "digest-of-a-drawn-token",
      ["linux-containers"],
      61_000,
    ],
  ]);
});

test("a caller the authority does not admit mints nothing and is told nothing", async () => {
  const store = minting();
  assert.deepEqual(
    await workerPoolTokenMint(authority(false), store, principal, partition, {
      capabilities: [],
      lifetimeSecs: 60,
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(store.made, []);
});

for (const lifetimeSecs of [0, -1, 1.5, workerPoolTokenLifetimeSecsMax + 1])
  test(`a lifetime of ${String(lifetimeSecs)} is refused before anything is asked`, async () => {
    await assert.rejects(
      workerPoolTokenMint(authority(true), minting(), principal, partition, {
        capabilities: [],
        lifetimeSecs,
      }),
      RangeError,
    );
  });

test("redeeming registers the pool for the partition the token named", async () => {
  const store = minting({
    held: { partition, capabilities: ["linux-containers", "amd64"] },
  });
  const made = ports();
  assert.deepEqual(
    await workerPoolTokenRedeem(store, made, issuer, {
      token: "a-drawn-token",
      pool: "pool-one",
      capabilities: ["amd64"],
    }),
    {
      result: "Registered",
      value: { clientId: "chuggy-pool-fixed", clientSecret: "a-secret" },
    },
  );
  assert.deepEqual(made.made, [
    [
      "register",
      {
        partition,
        pool: "pool-one",
        capabilities: ["amd64"],
        clientId: "chuggy-pool-fixed",
        principal: oidcPrincipal(issuer, "chuggy-pool-fixed"),
      },
    ],
  ]);
});

test("a capability the token does not permit registers nothing and spends nothing", async () => {
  const store = minting({
    held: { partition, capabilities: ["linux-containers"] },
  });
  const made = ports();
  assert.deepEqual(
    await workerPoolTokenRedeem(store, made, issuer, {
      token: "a-drawn-token",
      pool: "pool-one",
      capabilities: ["macos"],
    }),
    { result: "CapabilityNotPermitted" },
  );
  assert.deepEqual(made.made, []);
  assert.deepEqual(store.made, [["permitted", "digest-of-a-drawn-token"]]);
});

test("a token is spent once, and the second redemption is told nothing", async () => {
  const store = minting({ held: { partition, capabilities: ["linux"] } });
  const offered = {
    token: "a-drawn-token",
    pool: "pool-one",
    capabilities: ["linux"],
  };
  assert.equal(
    (await workerPoolTokenRedeem(store, ports(), issuer, offered)).result,
    "Registered",
  );
  assert.deepEqual(
    await workerPoolTokenRedeem(store, ports(), issuer, offered),
    { result: "NotFound" },
  );
});

test("a token no store holds registers nothing", async () => {
  const made = ports();
  assert.deepEqual(
    await workerPoolTokenRedeem(minting(), made, issuer, {
      token: "a-drawn-token",
      pool: "pool-one",
      capabilities: [],
    }),
    { result: "NotFound" },
  );
  assert.deepEqual(made.made, []);
});
