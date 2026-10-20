import assert from "node:assert/strict";
import { test } from "node:test";

import {
  personalRunnerService,
  type PersonalRunnerPorts,
  type PersonalRunnerRegistry,
  type PersonalRunnerTokenMinting,
  type PersonalRunnerTokenTerms,
  type PersonalRunnerView,
} from "../../src/interpreter/personalRunnerRegistration.ts";
import {
  oidcPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
  type TenantAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  workerRunnerReleasesRead,
  type WorkerRunnerReleases,
} from "../../src/interpreter/workerRunnerRelease.ts";
import type { WorkerRunner } from "../../src/contract/workerPool.ts";
import { projectAccessSiteRefused } from "./projectAccessFixture.ts";

const issuer = "https://issuer.invalid";
const site = {
  issuer,
  tokenUrl: "https://issuer.invalid/oauth2/token",
  audience: "https://api.invalid",
  planeUrl: "https://plane.invalid/",
};
const tenant = asTenantId("tenant");
const member = oidcPrincipal(issuer, "a-member");
const other = oidcPrincipal(issuer, "another-member");
const admin = oidcPrincipal(issuer, "an-admin");
const project = asProjectId("project");

/** Who holds what: tenant kinds per principal, and the projects each may read. */
interface Holdings {
  readonly tenant?: ReadonlyMap<Principal, readonly TenantAccessKind[]>;
  readonly reads?: ReadonlyMap<Principal, readonly Partition[]>;
}

function authority(holdings: Holdings, asked: unknown[] = []): ProjectAccess {
  return {
    authorize: (principal, partition, kind: ProjectAccessKind) => {
      asked.push(["project", principal, partition, kind]);
      const reads = holdings.reads?.get(principal) ?? [];
      return Promise.resolve(
        kind === "Read" &&
          reads.some(
            (held) =>
              held.tenant === partition.tenant &&
              held.project === partition.project,
          )
          ? memberAuthority(principal)
          : undefined,
      );
    },
    authorizeTenant: (principal, named, kind) => {
      asked.push(["tenant", principal, named, kind]);
      return Promise.resolve(
        named === tenant &&
          (holdings.tenant?.get(principal) ?? []).includes(kind)
          ? memberAuthority(principal)
          : undefined,
      );
    },
    authorizeSite: projectAccessSiteRefused,
  };
}

const permitted: Holdings = {
  tenant: new Map([
    [member, ["RegisterPersonalRunner"]],
    [admin, ["AdministerTenant"]],
  ]),
  reads: new Map([[member, [{ tenant, project }]]]),
};

interface Row {
  clientId: string;
  principal: Principal;
  capabilities: readonly string[];
  projects: Set<string>;
  runner?: WorkerRunner;
}

/** A registry keeping one row per tenant and owner, written only over the client it was read with. */
function registry(): PersonalRunnerRegistry & {
  readonly rows: Map<string, Row>;
  failNext?: Error;
} {
  const rows = new Map<string, Row>();
  const at = (named: TenantId, owner: Principal) => `${named}\n${owner}`;
  const fake: PersonalRunnerRegistry & {
    readonly rows: Map<string, Row>;
    failNext?: Error;
  } = {
    rows,
    clientOf: (key) =>
      Promise.resolve(rows.get(at(key.tenant, key.owner))?.clientId),
    register: (registration, replacing) => {
      if (fake.failNext !== undefined) {
        const failure = fake.failNext;
        delete fake.failNext;
        return Promise.reject(failure);
      }
      const held = rows.get(at(registration.tenant, registration.owner));
      if (held?.clientId !== replacing) return Promise.resolve("Moved");
      rows.set(at(registration.tenant, registration.owner), {
        clientId: registration.clientId,
        principal: registration.principal,
        capabilities: registration.capabilities,
        projects: held?.projects ?? new Set(),
      });
      return Promise.resolve("Registered");
    },
    deregister: (key, clientId) => {
      const held = rows.get(at(key.tenant, key.owner));
      if (held?.clientId !== clientId) return Promise.resolve(false);
      rows.delete(at(key.tenant, key.owner));
      return Promise.resolve(true);
    },
    runner: (key) => {
      const held = rows.get(at(key.tenant, key.owner));
      return Promise.resolve(
        held === undefined
          ? undefined
          : ({
              capabilities: held.capabilities,
              registeredAt: "2026-10-09T00:00:00.000Z",
              live: false,
              executionsLive: false,
              ...(held.runner === undefined ? {} : { runner: held.runner }),
              projects: [...held.projects].sort().map(asProjectId),
            } satisfies PersonalRunnerView),
      );
    },
    allow: (key, named) => {
      const held = rows.get(at(key.tenant, key.owner));
      if (held === undefined) return Promise.resolve("NotFound");
      held.projects.add(named);
      return Promise.resolve("Allowed");
    },
    disallow: (key, named) => {
      const held = rows.get(at(key.tenant, key.owner));
      held?.projects.delete(named);
      return Promise.resolve(held !== undefined);
    },
  };
  return fake;
}

/** The issuer's clients, recording each made and each removed. */
function ports(store = registry()): PersonalRunnerPorts & {
  readonly store: ReturnType<typeof registry>;
  readonly live: Set<string>;
} {
  const live = new Set<string>();
  let drawn = 0;
  return {
    store,
    live,
    registry: store,
    clients: {
      create: (clientId) => {
        live.add(clientId);
        return Promise.resolve({
          clientId,
          clientSecret: `secret-${clientId}`,
        });
      },
      remove: (clientId) => {
        live.delete(clientId);
        return Promise.resolve();
      },
    },
    clientId: () => `chuggy-personal-${String((drawn += 1))}`,
  };
}

/** Tokens by digest, each spent once and given back where asked. */
function minting(): PersonalRunnerTokenMinting & {
  readonly held: Map<string, PersonalRunnerTokenTerms & { spent: boolean }>;
} {
  const held = new Map<string, PersonalRunnerTokenTerms & { spent: boolean }>();
  let drawn = 0;
  return {
    held,
    draw: () => `token-${String((drawn += 1))}`,
    digest: (token) => `digest-of-${token}`,
    nowMs: () => 1_000,
    tokens: {
      mint: (named, digest, capabilities, _expiresAtMs, mintedBy) => {
        held.set(digest, {
          tenant: named,
          capabilities,
          mintedBy,
          spent: false,
        });
        return Promise.resolve("Minted");
      },
      permitted: (digest) => {
        const found = held.get(digest);
        return Promise.resolve(found?.spent === false ? found : undefined);
      },
      consume: (digest) => {
        const found = held.get(digest);
        if (found?.spent !== false) return Promise.resolve(undefined);
        found.spent = true;
        return Promise.resolve(found);
      },
      restore: (digest) => {
        const found = held.get(digest);
        if (found === undefined) return Promise.resolve(false);
        found.spent = false;
        return Promise.resolve(true);
      },
    },
  };
}

function service(
  holdings: Holdings = permitted,
  input: {
    readonly ports?: ReturnType<typeof ports>;
    readonly minting?: ReturnType<typeof minting>;
    readonly asked?: unknown[];
    readonly releases?: WorkerRunnerReleases;
  } = {},
) {
  const used = {
    ports: input.ports ?? ports(),
    minting: input.minting ?? minting(),
  };
  return {
    ...used,
    runners: personalRunnerService({
      access: authority(holdings, input.asked),
      minting: used.minting,
      ports: used.ports,
      site,
      releases: input.releases ?? new Map(),
    }),
  };
}

/** A member's token minted and redeemed, answering the redemption. */
async function registered(
  composed: ReturnType<typeof service>,
  capabilities: readonly string[] = ["linux"],
) {
  const minted = await composed.runners.mint(member, tenant, {
    capabilities: ["linux", "macos"],
    lifetimeSecs: 60,
  });
  assert.equal(minted.result, "Minted");
  if (minted.result !== "Minted") throw new Error("unreachable");
  return composed.runners.redeem({ token: minted.value.token, capabilities });
}

test("a member the tenant does not permit mints nothing", async () => {
  const composed = service({});
  assert.deepEqual(
    await composed.runners.mint(member, tenant, {
      capabilities: [],
      lifetimeSecs: 60,
    }),
    { result: "NotFound" },
  );
  assert.equal(composed.minting.held.size, 0);
});

test("a member is told whether the tenant permits them, asked of the permit minting asks and in that tenant", async () => {
  const asked: unknown[] = [];
  const runners = service(permitted, { asked }).runners;
  assert.equal(await runners.permitted(member, tenant), true);
  assert.equal(await runners.permitted(admin, tenant), false);
  assert.equal(await runners.permitted(member, asTenantId("elsewhere")), false);
  assert.deepEqual(asked, [
    ["tenant", member, tenant, "RegisterPersonalRunner"],
    ["tenant", admin, tenant, "RegisterPersonalRunner"],
    ["tenant", member, "elsewhere", "RegisterPersonalRunner"],
  ]);
});

test("a mint past the lifetime bound is refused before any authority is asked", async () => {
  const asked: unknown[] = [];
  await assert.rejects(
    service(permitted, { asked }).runners.mint(member, tenant, {
      capabilities: [],
      lifetimeSecs: 3_601,
    }),
    RangeError,
  );
  assert.deepEqual(asked, []);
});

test("a redemption registers the minter's runner in the tenant, naming no project", async () => {
  const composed = service();
  const redeemed = await registered(composed);
  assert.deepEqual(redeemed, {
    result: "Registered",
    value: {
      tenant,
      owner: member,
      capabilities: ["linux"],
      tokenUrl: site.tokenUrl,
      audience: site.audience,
      planeUrl: site.planeUrl,
      clientId: "chuggy-personal-1",
      clientSecret: "secret-chuggy-personal-1",
    },
  });
  const row = composed.ports.store.rows.get(`${tenant}\n${member}`);
  assert.equal(row?.principal, oidcPrincipal(issuer, "chuggy-personal-1"));
  assert.deepEqual(
    [...(row?.projects ?? [])],
    [],
    "a new runner serves no project",
  );
});

test("registering again replaces the member's one runner and removes its old client", async () => {
  const composed = service();
  await registered(composed);
  await composed.runners.allow(member, tenant, project);
  const again = await registered(composed, ["macos"]);
  assert.equal(again.result, "Registered");
  assert.equal(
    composed.ports.store.rows.size,
    1,
    "one runner per member per tenant",
  );
  assert.deepEqual([...composed.ports.live], ["chuggy-personal-2"]);
  assert.deepEqual(await composed.runners.runner(member, tenant), {
    result: "Found",
    value: {
      capabilities: ["macos"],
      registeredAt: "2026-10-09T00:00:00.000Z",
      live: false,
      executionsLive: false,
      projects: [project],
    },
  });
});

test("a member's runner is read with the runner its poll named and the version pinned for that package", async () => {
  const composed = service(permitted, {
    releases: workerRunnerReleasesRead({
      "chuggy-linux": {
        version: "0.14.1",
        url: "https://github.com/kasofsk/chuggy-linux/releases/download/v0.14.1/chuggy-linux-0.14.1.tgz",
        integrity: `sha512-${"A".repeat(85)}g==`,
      },
    }),
  });
  await registered(composed);
  const [row] = composed.ports.store.rows.values();
  for (const [named, shown] of [
    [
      { package: "chuggy-linux", version: "0.14.0" },
      { package: "chuggy-linux", version: "0.14.0", pinned: "0.14.1" },
    ],
    [
      { package: "chuggy-darwin", version: "0.2.0" },
      { package: "chuggy-darwin", version: "0.2.0" },
    ],
  ] as const) {
    if (row !== undefined) row.runner = named;
    const read = await composed.runners.runner(member, tenant);
    assert.deepEqual(
      read.result === "Found" ? read.value.runner : undefined,
      shown,
    );
  }
});

test("a redemption whose minter has lost the permit registers nothing and leaves the token unspent", async () => {
  const shared = minting();
  const minted = await service(permitted, { minting: shared }).runners.mint(
    member,
    tenant,
    { capabilities: [], lifetimeSecs: 60 },
  );
  if (minted.result !== "Minted") throw new Error("the mint was refused");
  const revoked = service({}, { minting: shared });
  assert.deepEqual(
    await revoked.runners.redeem({
      token: minted.value.token,
      capabilities: [],
    }),
    { result: "NotFound" },
  );
  assert.equal(revoked.ports.store.rows.size, 0);
  assert.equal(revoked.ports.live.size, 0);
  assert.equal(
    shared.held.get(`digest-of-${minted.value.token}`)?.spent,
    false,
  );
});

test("a capability the token does not permit is refused by name", async () => {
  const composed = service();
  assert.deepEqual(await registered(composed, ["windows"]), {
    result: "CapabilityNotPermitted",
  });
  assert.equal(composed.ports.live.size, 0);
});

test("a registration that lost the race for the member removes its client and gives its token back", async () => {
  const composed = service();
  const minted = await composed.runners.mint(member, tenant, {
    capabilities: [],
    lifetimeSecs: 60,
  });
  if (minted.result !== "Minted") throw new Error("the mint was refused");
  const racing = composed.ports.store.register.bind(composed.ports.store);
  composed.ports.store.register = async (registration, replacing) => {
    await racing(
      { ...registration, clientId: "a-racer", principal: other },
      replacing,
    );
    return racing(registration, replacing);
  };
  assert.deepEqual(
    await composed.runners.redeem({
      token: minted.value.token,
      capabilities: [],
    }),
    { result: "Conflict" },
  );
  assert.deepEqual([...composed.ports.live], []);
  assert.equal(
    composed.minting.held.get(`digest-of-${minted.value.token}`)?.spent,
    false,
  );
});

test("a row that could not be written takes the new client with it and gives the token back", async () => {
  const composed = service();
  composed.ports.store.failNext = new Error("the database went away");
  await assert.rejects(registered(composed), /went away/u);
  assert.equal(composed.ports.live.size, 0);
  assert.equal(
    [...composed.minting.held.values()].every((token) => !token.spent),
    true,
  );
});

test("a project joins the allowlist only where its owner may read it, asked in the runner's own tenant", async () => {
  const asked: unknown[] = [];
  const composed = service(permitted, { asked });
  await registered(composed);
  const elsewhere = asProjectId("unreadable");
  assert.equal(
    await composed.runners.allow(member, tenant, elsewhere),
    "NotFound",
  );
  assert.deepEqual(asked.at(-1), [
    "project",
    member,
    { tenant, project: elsewhere },
    "Read",
  ]);
  assert.equal(
    await composed.runners.allow(member, tenant, project),
    "Allowed",
  );
  assert.equal(
    await composed.runners.allow(member, asTenantId("another-tenant"), project),
    "NotFound",
    "a project of another tenant is asked about there, where the member reads nothing",
  );
  assert.deepEqual(await composed.runners.runner(member, tenant), {
    result: "Found",
    value: {
      capabilities: ["linux"],
      registeredAt: "2026-10-09T00:00:00.000Z",
      live: false,
      executionsLive: false,
      projects: [project],
    },
  });
  assert.equal(
    await composed.runners.disallow(member, tenant, project),
    "Removed",
  );
  assert.equal(
    await composed.runners.disallow(other, tenant, project),
    "NotFound",
  );
});

test("an owner takes their runner off, its client first", async () => {
  const composed = service();
  await registered(composed);
  assert.equal(
    await composed.runners.deregister(member, tenant),
    "Deregistered",
  );
  assert.equal(composed.ports.store.rows.size, 0);
  assert.equal(composed.ports.live.size, 0);
  assert.equal(await composed.runners.deregister(member, tenant), "NotFound");
  assert.deepEqual(await composed.runners.runner(member, tenant), {
    result: "NotFound",
  });
});

test("a member's runner is taken off by its subject by the tenant's administrator or the member, and nobody else", async () => {
  const composed = service();
  await registered(composed);
  assert.equal(
    await composed.runners.deregisterMember(other, tenant, "a-member"),
    "NotFound",
  );
  assert.equal(composed.ports.store.rows.size, 1);
  assert.equal(
    await composed.runners.deregisterMember(admin, tenant, "a-member"),
    "Deregistered",
  );
  await registered(composed);
  assert.equal(
    await composed.runners.deregisterMember(member, tenant, "a-member"),
    "Deregistered",
  );
});
