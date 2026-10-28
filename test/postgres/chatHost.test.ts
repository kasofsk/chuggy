import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresChatHostPlaneRegistry,
  postgresChatHostRegistry,
} from "../../src/adapters/postgres/chatHost.ts";
import { postgresWorkerPoolRunners } from "../../src/adapters/postgres/workerPool.ts";
import {
  apiRole,
  boundaryOwnerRole,
  poolPlaneRole,
  schedulerRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import type {
  ChatHostKey,
  ChatHostRegistration,
} from "../../src/interpreter/chatHostRegistration.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import { sessionRunnerPolledSecsMax } from "../../src/interpreter/sessionPlacement.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

const member = asPrincipal("https://issuer.invalid#a-member");
const other = asPrincipal("https://issuer.invalid#another-member");

let harness: PostgresHarness;
let api: pg.Pool;
let plane: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  api = postgresHarnessRolePool(apiRole);
  plane = postgresHarnessRolePool(poolPlaneRole);
});
after(async () => {
  await Promise.all([api.end(), plane.end()]);
  await harness.close();
});

/** A tenant of its own, made a row by the project made in it. */
async function tenantOf(label: string): Promise<TenantId> {
  return (await postgresHarnessProject(harness.store, label)).tenant;
}

function registration(
  key: ChatHostKey,
  clientId: string,
): ChatHostRegistration {
  return {
    ...key,
    clientId,
    principal: asPrincipal(`https://issuer.invalid#${clientId}`),
  };
}

test("registering a member's chat host again replaces the one they held, naming the client it replaced, and another member's stands apart", async () => {
  const tenant = await tenantOf("host-replace");
  const hosts = postgresChatHostRegistry(api);
  const key = { tenant, owner: member };
  assert.equal(await hosts.host(key), undefined);
  assert.deepEqual(await hosts.register(registration(key, `${tenant}-1`)), {
    written: "Registered",
  });
  await hosts.register(registration({ tenant, owner: other }, `${tenant}-o`));
  assert.deepEqual(await hosts.register(registration(key, `${tenant}-2`)), {
    written: "Registered",
    replaced: `${tenant}-1`,
  });
  assert.equal(await hosts.clientOf(key), `${tenant}-2`);
  assert.equal(await hosts.clientOf({ tenant, owner: other }), `${tenant}-o`);
  const read = await hosts.host(key);
  assert.deepEqual(
    [read?.id, read?.polledAt, read?.live, read?.runner],
    [`${tenant}-2`, undefined, false, undefined],
  );
});

test("a chat host is registered only in a tenant that is a row", async () => {
  assert.deepEqual(
    await postgresChatHostRegistry(api).register(
      registration(
        { tenant: asTenantId("tenant-never-made"), owner: member },
        "host-nowhere",
      ),
    ),
    { written: "NotFound" },
  );
});

test("removing a member's chat host takes the client it names alone, and the member's key alone", async () => {
  const tenant = await tenantOf("host-remove");
  const hosts = postgresChatHostRegistry(api);
  const key = { tenant, owner: member };
  await hosts.register(registration(key, `${tenant}-1`));
  assert.equal(await hosts.deregister(key, "a-client-never-made"), false);
  assert.equal(
    await hosts.deregister({ tenant, owner: other }, `${tenant}-1`),
    false,
    "another member's key removed this member's host",
  );
  assert.equal(await hosts.deregister(key, `${tenant}-1`), true);
  assert.equal(await hosts.host(key), undefined);
});

test("a chat host is read live only while its newest poll is inside the window, with the runner that poll named, and the pool plane resolves it by its principal alone", async () => {
  const tenant = await tenantOf("host-polled");
  const hosts = postgresChatHostRegistry(api);
  const key = { tenant, owner: member };
  const registered = registration(key, `${tenant}-1`);
  await hosts.register(registered);
  const stamp = (secsAgo: number) =>
    harness.query(
      `UPDATE chat_host
          SET last_polled_at=now()-make_interval(secs=>$2::double precision)
        WHERE tenant=$1`,
      [tenant, secsAgo],
    );
  await stamp(sessionRunnerPolledSecsMax * 2);
  assert.equal((await hosts.host(key))?.live, false);
  await stamp(1);
  assert.equal((await hosts.host(key))?.live, true);

  const linux = { package: "chuggy-linux", version: "0.14.0" };
  const identity = {
    kind: "ChatHost",
    ...key,
    principal: registered.principal,
  } as const;
  await postgresWorkerPoolRunners(plane).named(identity, linux, undefined);
  assert.deepEqual((await hosts.host(key))?.runner, linux);
  await postgresWorkerPoolRunners(plane).named(
    { ...identity, principal: asPrincipal("https://issuer.invalid#stale") },
    undefined,
    undefined,
  );
  assert.deepEqual(
    (await hosts.host(key))?.runner,
    linux,
    "a poll under a replaced principal named this host's runner",
  );

  const resolved = postgresChatHostPlaneRegistry(plane);
  assert.deepEqual(await resolved.identify(registered.principal), {
    tenant,
    owner: member,
    principal: registered.principal,
  });
  assert.equal(
    await resolved.identify(asPrincipal("https://issuer.invalid#nobody")),
    undefined,
  );
});

test("the pool plane reads a chat host and stamps its poll and runner, and changes nothing else", async () => {
  assert.equal(
    await harness.attemptAs(
      poolPlaneRole,
      `SELECT tenant,owner,principal,runner_package,runner_version FROM chat_host`,
    ),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(
      poolPlaneRole,
      `UPDATE chat_host
          SET last_polled_at=now(),runner_package=NULL,runner_version=NULL
        WHERE principal='none'`,
    ),
    undefined,
  );
  for (const statement of [
    `SELECT client_id FROM chat_host`,
    `UPDATE chat_host SET principal='p' WHERE principal='none'`,
    `INSERT INTO chat_host(tenant,owner,principal,client_id) VALUES('t','o','p','c')`,
    `DELETE FROM chat_host`,
  ])
    assert.match(
      (await harness.attemptAs(poolPlaneRole, statement)) ?? "",
      /permission denied/u,
      statement,
    );
});

test("the API writes a chat host whole or not at all, the boundary reads its owner, principal and poll, and the scheduler reads none of it", async () => {
  for (const column of [
    "principal",
    "client_id",
    "registered_at",
    "last_polled_at",
    "runner_package",
    "runner_version",
  ])
    assert.match(
      (await harness.attemptAs(
        apiRole,
        `UPDATE chat_host SET ${column}=${column} WHERE false`,
      )) ?? "",
      /permission denied/u,
      column,
    );
  assert.equal(
    await harness.attemptAs(
      boundaryOwnerRole,
      `SELECT tenant,owner,principal,last_polled_at FROM chat_host`,
    ),
    undefined,
  );
  for (const [role, statement] of [
    [boundaryOwnerRole, `SELECT client_id FROM chat_host`],
    [schedulerRole, `SELECT tenant,owner,principal FROM chat_host`],
  ] as const)
    assert.match(
      (await harness.attemptAs(role, statement)) ?? "",
      /permission denied/u,
      `${role}: ${statement}`,
    );
});

test("a chat host's owner, principal and client are bounded, and a principal or client is one host's", async () => {
  const tenant = await tenantOf("host-bounds");
  const insert = (owner: string, principal: string, client: string) =>
    harness.query(
      `INSERT INTO chat_host(tenant,owner,principal,client_id)
       VALUES($1,$2,$3,$4)`,
      [tenant, owner, principal, client],
    );
  await assert.rejects(
    insert("o".repeat(257), "p-long", "c-long"),
    /chat_host_owner_is_bounded/u,
  );
  await insert("owner-a", `principal-${tenant}`, `client-${tenant}`);
  await assert.rejects(
    insert("owner-b", `principal-${tenant}`, "another-client"),
    /chat_host_principal_key/u,
  );
  await assert.rejects(
    insert("owner-b", "another-principal", `client-${tenant}`),
    /chat_host_client_id_key/u,
  );
  await assert.rejects(
    insert("owner-a", "a-third-principal", "a-third-client"),
    /chat_host_pkey/u,
  );
});
