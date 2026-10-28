import assert from "node:assert/strict";
import { test } from "node:test";

import { personalRunnersMax } from "../../src/contract/http.ts";
import type {
  ChatHostRegistry,
  ChatHostView,
} from "../../src/interpreter/chatHostRegistration.ts";
import {
  personalRunnerService,
  type PersonalRunnerPorts,
  type PersonalRunnerRegistry,
  type PersonalRunnerTokenMinting,
  type PersonalRunnerTokenTerms,
  type PersonalRunnerKey,
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
  runner?: WorkerRunner;
}

/** One row as its owner reads it, never polled. */
function rowViewed(row: Row): PersonalRunnerView {
  return {
    id: row.clientId,
    capabilities: row.capabilities,
    registeredAt: "2026-10-09T00:00:00.000Z",
    live: false,
    executionsLive: false,
    ...(row.runner === undefined ? {} : { runner: row.runner }),
  };
}

/** Where a member's runners and allowlist are kept. */
function memberAt(key: PersonalRunnerKey): string {
  return `${key.tenant}\n${key.owner}`;
}

/** The registry a case drives, its rows and allowlists in sight, failing its next registration where `failNext` is set. */
type FakeRegistry = PersonalRunnerRegistry & {
  readonly rows: Map<string, Row[]>;
  readonly allowed: Map<string, Set<string>>;
  failNext?: Error;
};

/**
 * A registry keeping each member's runners oldest first, as many as the
 * contract bounds, and one allowlist per member that goes with their last
 * runner.
 */
function registry(): FakeRegistry {
  const rows = new Map<string, Row[]>();
  const allowed = new Map<string, Set<string>>();
  const fake: FakeRegistry = {
    rows,
    allowed,
    clientsOf: (key) =>
      Promise.resolve(
        (rows.get(memberAt(key)) ?? []).map((row) => row.clientId),
      ),
    register: (registration) => {
      if (fake.failNext !== undefined) {
        const failure = fake.failNext;
        delete fake.failNext;
        return Promise.reject(failure);
      }
      const held = rows.get(memberAt(registration)) ?? [];
      if (held.length >= personalRunnersMax)
        return Promise.resolve("LimitReached");
      rows.set(memberAt(registration), [
        ...held,
        {
          clientId: registration.clientId,
          principal: registration.principal,
          capabilities: registration.capabilities,
        },
      ]);
      return Promise.resolve("Registered");
    },
    deregister: (key, clientId) => {
      const held = rows.get(memberAt(key)) ?? [];
      const kept = held.filter((row) => row.clientId !== clientId);
      if (kept.length === held.length) return Promise.resolve(false);
      if (kept.length > 0) rows.set(memberAt(key), kept);
      else {
        rows.delete(memberAt(key));
        allowed.delete(memberAt(key));
      }
      return Promise.resolve(true);
    },
    runners: (key) =>
      Promise.resolve(
        rows.has(memberAt(key))
          ? {
              runners: (rows.get(memberAt(key)) ?? []).map(rowViewed),
              projects: [...(allowed.get(memberAt(key)) ?? [])]
                .sort()
                .map(asProjectId),
            }
          : undefined,
      ),
    allow: (key, named) => {
      if (!rows.has(memberAt(key))) return Promise.resolve("NotFound");
      allowed.set(
        memberAt(key),
        (allowed.get(memberAt(key)) ?? new Set()).add(named),
      );
      return Promise.resolve("Allowed");
    },
    disallow: (key, named) => {
      allowed.get(memberAt(key))?.delete(named);
      return Promise.resolve(rows.has(memberAt(key)));
    },
  };
  return fake;
}

/** The chat host registry a case drives, one host per member, recording what each write replaced. */
type FakeChatHosts = ChatHostRegistry & {
  readonly hosts: Map<string, ChatHostView & { principal: Principal }>;
};

function chatHosts(): FakeChatHosts {
  const hosts = new Map<string, ChatHostView & { principal: Principal }>();
  return {
    hosts,
    clientOf: (key) => Promise.resolve(hosts.get(memberAt(key))?.id),
    register: (registration) => {
      const replaced = hosts.get(memberAt(registration))?.id;
      hosts.set(memberAt(registration), {
        id: registration.clientId,
        principal: registration.principal,
        registeredAt: "2026-10-09T00:00:00.000Z",
        live: false,
      });
      return Promise.resolve(
        replaced === undefined
          ? { written: "Registered" }
          : { written: "Registered", replaced },
      );
    },
    deregister: (key, clientId) => {
      if (hosts.get(memberAt(key))?.id !== clientId)
        return Promise.resolve(false);
      hosts.delete(memberAt(key));
      return Promise.resolve(true);
    },
    host: (key) => {
      const found = hosts.get(memberAt(key));
      return Promise.resolve(
        found === undefined
          ? undefined
          : {
              id: found.id,
              registeredAt: found.registeredAt,
              live: found.live,
            },
      );
    },
  };
}

/** The member's runners as the registry holds them. */
function held(composed: { readonly ports: ReturnType<typeof ports> }): Row[] {
  return (
    composed.ports.store.rows.get(memberAt({ tenant, owner: member })) ?? []
  );
}

/** The issuer's clients, recording each made and each removed. */
function ports(store = registry()): PersonalRunnerPorts & {
  readonly store: ReturnType<typeof registry>;
  readonly hosts: FakeChatHosts;
  readonly live: Set<string>;
} {
  const live = new Set<string>();
  const hosts = chatHosts();
  let drawn = 0;
  return {
    store,
    hosts,
    live,
    registry: store,
    chatHosts: hosts,
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
      mint: (named, digest, _expiresAtMs, mintedBy, kind) => {
        held.set(digest, { tenant: named, mintedBy, kind, spent: false });
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
    lifetimeSecs: 60,
  });
  assert.equal(minted.result, "Minted");
  if (minted.result !== "Minted") throw new Error("unreachable");
  return composed.runners.redeem({ token: minted.value.token, capabilities });
}

/** A member's chat host token minted and redeemed, answering the redemption. */
async function hostRegistered(composed: ReturnType<typeof service>) {
  const minted = await composed.runners.mintChatHost(member, tenant, {
    lifetimeSecs: 60,
  });
  assert.equal(minted.result, "Minted");
  if (minted.result !== "Minted") throw new Error("unreachable");
  return composed.runners.redeem({
    token: minted.value.token,
    capabilities: ["linux"],
  });
}

test("a chat host's token registers the member's chat host and no runner, whatever its redemption declares, answering a host's file", async () => {
  const composed = service();
  assert.deepEqual(await hostRegistered(composed), {
    result: "HostRegistered",
    value: {
      tenant,
      owner: member,
      tokenUrl: site.tokenUrl,
      audience: site.audience,
      planeUrl: site.planeUrl,
      clientId: "chuggy-personal-1",
      clientSecret: "secret-chuggy-personal-1",
    },
  });
  assert.deepEqual(held(composed), []);
  assert.deepEqual(
    [...composed.ports.hosts.hosts.values()].map((host) => host.principal),
    [oidcPrincipal(issuer, "chuggy-personal-1")],
  );
  assert.deepEqual(
    [...composed.minting.held.values()].map((token) => token.kind),
    ["ChatHost"],
  );
});

test("registering a chat host again replaces it and removes the replaced client, and a runner's token still registers a runner beside it", async () => {
  const composed = service();
  await hostRegistered(composed);
  const again = await hostRegistered(composed);
  assert.equal(again.result, "HostRegistered");
  assert.deepEqual([...composed.ports.live], ["chuggy-personal-2"]);
  assert.deepEqual(await composed.runners.chatHost(member, tenant), {
    result: "Found",
    value: {
      id: "chuggy-personal-2",
      registeredAt: "2026-10-09T00:00:00.000Z",
      live: false,
    },
  });
  assert.equal((await registered(composed)).result, "Registered");
  assert.deepEqual(
    held(composed).map((row) => row.clientId),
    ["chuggy-personal-3"],
  );
  assert.equal(composed.ports.hosts.hosts.size, 1);
});

test("a chat host is taken off by its owner, its client first, and a member with none is not found", async () => {
  const composed = service();
  assert.equal(
    await composed.runners.deregisterChatHost(member, tenant),
    "NotFound",
  );
  await hostRegistered(composed);
  await registered(composed);
  assert.equal(
    await composed.runners.deregisterChatHost(member, tenant),
    "Deregistered",
  );
  assert.deepEqual([...composed.ports.live], ["chuggy-personal-2"]);
  assert.deepEqual(await composed.runners.chatHost(member, tenant), {
    result: "NotFound",
  });
  assert.equal(held(composed).length, 1, "the member's runner stands");
});

test("a member the tenant does not permit mints no chat host token", async () => {
  const composed = service({});
  assert.deepEqual(
    await composed.runners.mintChatHost(member, tenant, { lifetimeSecs: 60 }),
    { result: "NotFound" },
  );
  assert.equal(composed.minting.held.size, 0);
});

test("a member the tenant does not permit mints nothing", async () => {
  const composed = service({});
  assert.deepEqual(
    await composed.runners.mint(member, tenant, { lifetimeSecs: 60 }),
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
  assert.equal(
    held(composed)[0]?.principal,
    oidcPrincipal(issuer, "chuggy-personal-1"),
  );
  assert.deepEqual(
    await composed.runners.runners(member, tenant),
    {
      result: "Found",
      value: {
        runners: [
          {
            id: "chuggy-personal-1",
            capabilities: ["linux"],
            registeredAt: "2026-10-09T00:00:00.000Z",
            live: false,
            executionsLive: false,
          },
        ],
        projects: [],
      },
    },
    "a new runner serves no project",
  );
});

test("registering again adds a runner beside the member's first, which keeps its client, and both serve the one allowlist", async () => {
  const composed = service();
  await registered(composed);
  await composed.runners.allow(member, tenant, project);
  const again = await registered(composed, ["macos"]);
  assert.equal(again.result, "Registered");
  assert.deepEqual(
    [...composed.ports.live],
    ["chuggy-personal-1", "chuggy-personal-2"],
  );
  const read = await composed.runners.runners(member, tenant);
  assert.deepEqual(
    read.result === "Found"
      ? read.value.runners.map((runner) => [runner.id, runner.capabilities])
      : undefined,
    [
      ["chuggy-personal-1", ["linux"]],
      ["chuggy-personal-2", ["macos"]],
    ],
  );
  assert.deepEqual(read.result === "Found" ? read.value.projects : undefined, [
    project,
  ]);
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
  const [row] = held(composed);
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
    const read = await composed.runners.runners(member, tenant);
    assert.deepEqual(
      read.result === "Found" ? read.value.runners[0]?.runner : undefined,
      shown,
    );
  }
});

test("a redemption whose minter has lost the permit registers nothing and leaves the token unspent", async () => {
  const shared = minting();
  const minted = await service(permitted, { minting: shared }).runners.mint(
    member,
    tenant,
    { lifetimeSecs: 60 },
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

test("a runner declaring capabilities nobody named at the mint is registered with them", async () => {
  const composed = service();
  const declared = ["Platform:Windows:Amd64", "Agent:Codex"];
  const redeemed = await registered(composed, declared);
  assert.deepEqual(
    redeemed.result === "Registered" ? redeemed.value.capabilities : redeemed,
    declared,
  );
  assert.deepEqual(
    held(composed).map((row) => row.capabilities),
    [declared],
  );
});

test("a member holding their bound of runners registers none more, the client minted removed and the token given back to redeem once one is off", async () => {
  const composed = service();
  for (let count = 0; count < personalRunnersMax; count += 1)
    assert.equal((await registered(composed)).result, "Registered");
  const minted = await composed.runners.mint(member, tenant, {
    lifetimeSecs: 60,
  });
  if (minted.result !== "Minted") throw new Error("the mint was refused");
  const live = [...composed.ports.live];
  assert.deepEqual(
    await composed.runners.redeem({
      token: minted.value.token,
      capabilities: [],
    }),
    { result: "LimitReached" },
  );
  assert.deepEqual([...composed.ports.live], live);
  assert.equal(held(composed).length, personalRunnersMax);
  assert.equal(
    composed.minting.held.get(`digest-of-${minted.value.token}`)?.spent,
    false,
  );
  assert.equal(
    await composed.runners.deregisterRunner(
      member,
      tenant,
      "chuggy-personal-1",
    ),
    "Deregistered",
  );
  assert.equal(
    (
      await composed.runners.redeem({
        token: minted.value.token,
        capabilities: [],
      })
    ).result,
    "Registered",
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
  const read = await composed.runners.runners(member, tenant);
  assert.deepEqual(read.result === "Found" ? read.value.projects : undefined, [
    project,
  ]);
  assert.equal(
    await composed.runners.disallow(member, tenant, project),
    "Removed",
  );
  assert.equal(
    await composed.runners.disallow(other, tenant, project),
    "NotFound",
  );
});

/** Each client removal and row deletion, in the order they were made. */
function recorded(composed: ReturnType<typeof service>): string[] {
  const made: string[] = [];
  const { clients, store } = composed.ports;
  const remove = clients.remove.bind(clients);
  const deregister = store.deregister.bind(store);
  clients.remove = (clientId) => {
    made.push(`client ${clientId}`);
    return remove(clientId);
  };
  store.deregister = (key, clientId) => {
    made.push(`row ${clientId}`);
    return deregister(key, clientId);
  };
  return made;
}

test("an owner takes one runner off by its client, the client first, and the others and their allowlist stay", async () => {
  const composed = service();
  await registered(composed);
  await registered(composed);
  await composed.runners.allow(member, tenant, project);
  const made = recorded(composed);
  assert.equal(
    await composed.runners.deregisterRunner(
      member,
      tenant,
      "chuggy-personal-1",
    ),
    "Deregistered",
  );
  assert.deepEqual(made, ["client chuggy-personal-1", "row chuggy-personal-1"]);
  assert.deepEqual([...composed.ports.live], ["chuggy-personal-2"]);
  const read = await composed.runners.runners(member, tenant);
  assert.deepEqual(
    read.result === "Found"
      ? [read.value.runners.map((runner) => runner.id), read.value.projects]
      : undefined,
    [["chuggy-personal-2"], [project]],
  );
  assert.equal(
    await composed.runners.deregisterRunner(
      member,
      tenant,
      "chuggy-personal-1",
    ),
    "NotFound",
  );
});

test("a client that is none of the caller's runners is taken off nowhere", async () => {
  const composed = service();
  await registered(composed);
  const made = recorded(composed);
  assert.equal(
    await composed.runners.deregisterRunner(other, tenant, "chuggy-personal-1"),
    "NotFound",
  );
  assert.equal(
    await composed.runners.deregisterRunner(
      member,
      asTenantId("another-tenant"),
      "chuggy-personal-1",
    ),
    "NotFound",
  );
  assert.deepEqual(made, []);
  assert.deepEqual([...composed.ports.live], ["chuggy-personal-1"]);
});

test("an owner takes every runner off at once, each client before its row, and the allowlist goes with the last", async () => {
  const composed = service();
  await registered(composed);
  await registered(composed);
  await composed.runners.allow(member, tenant, project);
  const made = recorded(composed);
  assert.equal(
    await composed.runners.deregister(member, tenant),
    "Deregistered",
  );
  assert.deepEqual(made, [
    "client chuggy-personal-1",
    "row chuggy-personal-1",
    "client chuggy-personal-2",
    "row chuggy-personal-2",
  ]);
  assert.equal(composed.ports.live.size, 0);
  assert.equal(composed.ports.store.allowed.size, 0);
  assert.equal(await composed.runners.deregister(member, tenant), "NotFound");
  assert.deepEqual(await composed.runners.runners(member, tenant), {
    result: "NotFound",
  });
});

test("a member's runners are taken off by their subject by the tenant's administrator or the member, and nobody else", async () => {
  const composed = service();
  await registered(composed);
  await registered(composed);
  assert.equal(
    await composed.runners.deregisterMember(other, tenant, "a-member"),
    "NotFound",
  );
  assert.equal(held(composed).length, 2);
  assert.equal(
    await composed.runners.deregisterMember(admin, tenant, "a-member"),
    "Deregistered",
  );
  assert.deepEqual([held(composed).length, composed.ports.live.size], [0, 0]);
  await registered(composed);
  assert.equal(
    await composed.runners.deregisterMember(member, tenant, "a-member"),
    "Deregistered",
  );
});
