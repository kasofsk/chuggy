import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";

import {
  personalRunnerProjectsMax,
  personalRunnersMax,
} from "../../src/contract/http.ts";
import {
  postgresPersonalRunnerRegistrationTokens,
  postgresPersonalRunnerRegistry,
} from "../../src/adapters/postgres/personalRunner.ts";
import {
  postgresWorkerPoolRoster,
  postgresWorkerPoolRunners,
} from "../../src/adapters/postgres/workerPool.ts";
import {
  apiRole,
  boundaryOwnerRole,
  poolPlaneRole,
  schedulerRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import {
  personalRunnerTokensLiveMax,
  type PersonalRunnerKey,
  type PersonalRunnerRegistration,
} from "../../src/interpreter/personalRunnerRegistration.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { sessionRunnerPolledSecsMax } from "../../src/interpreter/sessionPlacement.ts";
import {
  asTenantId,
  type Partition,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessAdvisoryWaiting,
  postgresHarnessDenial,
  postgresHarnessHeldAtCommit,
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessTokenDigest,
  type PostgresHarness,
} from "./harness.ts";

const member = asPrincipal("https://issuer.invalid#a-member");
const other = asPrincipal("https://issuer.invalid#another-member");

let harness: PostgresHarness;
let api: pg.Pool;
let plane: pg.Pool;
let scheduler: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  api = postgresHarnessRolePool(apiRole);
  plane = postgresHarnessRolePool(poolPlaneRole);
  scheduler = postgresHarnessRolePool(schedulerRole);
});
after(async () => {
  await Promise.all([api.end(), plane.end(), scheduler.end()]);
  await harness.close();
});

/** A project in a tenant of its own, which is what makes the tenant a row. */
async function project(label: string): Promise<Partition> {
  return postgresHarnessProject(harness.store, label);
}

/** One more project in `tenant`. */
async function projectIn(tenant: TenantId, label: string): Promise<Partition> {
  return postgresHarnessProject(harness.store, label, {
    tenant,
    project: postgresHarnessPartition(label).project,
  });
}

function registration(
  key: PersonalRunnerKey,
  clientId: string,
  capabilities: readonly string[] = ["linux"],
): PersonalRunnerRegistration {
  return {
    ...key,
    capabilities,
    clientId,
    principal: asPrincipal(`https://issuer.invalid#${clientId}`),
  };
}

/** The `count`th client a case registers in `tenant`, which sorts in the order it was registered. */
function clientNumbered(tenant: TenantId, count: number): string {
  return `client-${tenant}-${String(count).padStart(2, "0")}`;
}

test("a member registers runners in a tenant up to their bound, read oldest first, and another member's are counted apart", async () => {
  const { tenant } = await project("runner-many");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant, owner: member };
  const clients = Array.from({ length: personalRunnersMax }, (_, count) =>
    clientNumbered(tenant, count),
  );
  for (const client of clients)
    assert.equal(
      await runners.register(registration(key, client)),
      "Registered",
    );
  assert.equal(
    await runners.register(registration(key, `past-${tenant}`)),
    "LimitReached",
  );
  assert.deepEqual(await runners.clientsOf(key), clients);
  assert.equal(
    await runners.register(
      registration({ tenant, owner: other }, `other-${tenant}`),
    ),
    "Registered",
    "the bound is one member's, not the tenant's",
  );
});

/**
 * The first registration is held open at its commit, so the second is made
 * while the member's last room is taken and not yet committed: it waits on the
 * member's lock and then counts that runner, where without the lock it would
 * count one fewer and write past the bound.
 */
test("a registration made while another for the same member is still open waits for it and counts it", async () => {
  const { tenant } = await project("runner-race");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant, owner: member };
  for (let count = 1; count < personalRunnersMax; count += 1)
    await runners.register(registration(key, clientNumbered(tenant, count)));
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const first = postgresPersonalRunnerRegistry(
    postgresHarnessHeldAtCommit(api, reach, gate),
  ).register(registration(key, `racer-a-${tenant}`));
  await reached;
  let settled = false;
  const second = runners
    .register(registration(key, `racer-b-${tenant}`))
    .finally(() => (settled = true));
  while (!settled && !(await postgresHarnessAdvisoryWaiting(harness)))
    await delay(10);
  open();
  assert.deepEqual(await Promise.all([first, second]), [
    "Registered",
    "LimitReached",
  ]);
  assert.equal((await runners.clientsOf(key)).length, personalRunnersMax);
});

test("the scheduler reads every runner of a member's in the tenant, each with every project their allowlist names, and none of another member's", async () => {
  const partition = await project("runner-roster");
  const runners = postgresPersonalRunnerRegistry(api);
  const roster = postgresWorkerPoolRoster(scheduler);
  const key = { tenant: partition.tenant, owner: member };
  assert.deepEqual(await roster.personal(partition, member), []);
  const first = registration(key, clientNumbered(partition.tenant, 1));
  const second = registration(key, clientNumbered(partition.tenant, 2), [
    "macos",
  ]);
  await runners.register(first);
  await runners.register(second);
  await runners.register(
    registration({ ...key, owner: other }, `other-${partition.tenant}`),
  );
  await runners.allow(key, partition.project);
  assert.deepEqual(
    await roster.personal(partition, member),
    [first, second].map((registered) => ({
      owner: member,
      principal: registered.principal,
      capabilities: registered.capabilities,
      allowlist: [partition],
    })),
  );
});

test("a runner is registered only in a tenant that is a row", async () => {
  const runners = postgresPersonalRunnerRegistry(api);
  assert.equal(
    await runners.register(
      registration(
        { tenant: asTenantId("tenant-never-made"), owner: member },
        "client-nowhere",
      ),
    ),
    "NotFound",
  );
});

test("a second registration stands beside the first, each read by its client, and both serve the one allowlist", async () => {
  const partition = await project("runner-second");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  const first = clientNumbered(partition.tenant, 1);
  await runners.register(registration(key, first));
  assert.equal(await runners.allow(key, partition.project), "Allowed");
  const second = clientNumbered(partition.tenant, 2);
  assert.equal(
    await runners.register(registration(key, second, ["macos"])),
    "Registered",
  );
  const read = await runners.runners(key);
  assert.deepEqual(
    read?.runners.map((runner) => [runner.id, runner.capabilities]),
    [
      [first, ["linux"]],
      [second, ["macos"]],
    ],
  );
  assert.deepEqual(read?.projects, [partition.project]);
});

test("a runner is read with its newest poll of either kind, live only while that poll is inside the window, and live for executions only by its poll for them", async () => {
  const partition = await project("runner-polled");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  await runners.register(registration(key, `client-${partition.tenant}`));
  const unpolled = (await runners.runners(key))?.runners[0];
  assert.equal(unpolled?.polledAt, undefined);
  assert.equal(unpolled?.live, false);
  assert.equal(unpolled?.executionsLive, false);
  const stamp = (column: string, secsAgo: number) =>
    harness.query(
      `UPDATE personal_runner
          SET ${column}=now()-make_interval(secs=>$2::double precision)
        WHERE tenant=$1`,
      [partition.tenant, secsAgo],
    );
  await stamp("last_polled_at", sessionRunnerPolledSecsMax * 3);
  await stamp("executions_polled_at", sessionRunnerPolledSecsMax * 2);
  const stale = (await runners.runners(key))?.runners[0];
  assert.equal(stale?.live, false);
  assert.equal(stale?.executionsLive, false);
  assert.deepEqual(
    await harness.query(
      `SELECT abs(extract(epoch FROM executions_polled_at-$2::timestamptz))<0.001
                AS newest
         FROM personal_runner WHERE tenant=$1`,
      [partition.tenant, stale?.polledAt],
    ),
    [{ newest: true }],
    "the newer of the two polls is the one read",
  );
  await stamp("last_polled_at", 1);
  const sessionPolled = (await runners.runners(key))?.runners[0];
  assert.equal(sessionPolled?.live, true);
  assert.equal(sessionPolled?.executionsLive, false);
  await stamp("executions_polled_at", 1);
  assert.equal((await runners.runners(key))?.runners[0]?.executionsLive, true);
});

test("each runner is read with the runner its own registration's newest poll named, and a poll of one names nothing of another's", async () => {
  const partition = await project("runner-named");
  const runners = postgresPersonalRunnerRegistry(api);
  const stamps = postgresWorkerPoolRunners(plane);
  const key = { tenant: partition.tenant, owner: member };
  const first = registration(key, clientNumbered(partition.tenant, 1));
  await runners.register(first);
  const linux = { package: "chuggy-linux", version: "0.14.0" };
  const polled = (principal = first.principal) =>
    ({ kind: "Personal", ...key, principal }) as const;
  const named = async () =>
    (await runners.runners(key))?.runners.map((runner) => runner.runner);
  assert.deepEqual(await named(), [undefined]);
  await stamps.named(polled(), linux);
  assert.deepEqual(await named(), [linux]);
  const [written] = await harness.query(
    `SELECT xmin::text AS written FROM personal_runner WHERE tenant=$1`,
    [partition.tenant],
  );
  await stamps.named(polled(), linux);
  assert.deepEqual(
    await harness.query(
      `SELECT xmin::text AS written FROM personal_runner WHERE tenant=$1`,
      [partition.tenant],
    ),
    [written],
    "the same runner again writes nothing",
  );
  await stamps.named(polled(), undefined);
  assert.deepEqual(await named(), [undefined], "a poll naming none keeps none");
  await stamps.named(polled(), linux);
  const second = registration(key, clientNumbered(partition.tenant, 2));
  await runners.register(second);
  assert.deepEqual(
    await named(),
    [linux, undefined],
    "a new registration names no runner",
  );
  const darwin = { package: "chuggy-darwin", version: "0.2.0" };
  await stamps.named(polled(second.principal), darwin);
  assert.deepEqual(await named(), [linux, darwin]);
  await assert.rejects(
    harness.query(
      `UPDATE personal_runner SET runner_version=NULL WHERE tenant=$1`,
      [partition.tenant],
    ),
    /personal_runner_runner_is_named_whole/u,
  );
});

test("deregistering deletes the member's runner naming the client alone, and the allowlist with the last of them", async () => {
  const partition = await project("runner-deregister");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  const first = clientNumbered(partition.tenant, 1);
  const second = clientNumbered(partition.tenant, 2);
  await runners.register(registration(key, first));
  await runners.register(registration(key, second));
  await runners.allow(key, partition.project);
  const allowed = () =>
    harness.query(
      `SELECT count(*)::int AS held FROM personal_runner_project WHERE tenant=$1`,
      [partition.tenant],
    );
  assert.equal(await runners.deregister(key, "a-client-never-made"), false);
  assert.equal(
    await runners.deregister({ ...key, owner: other }, first),
    false,
    "another member's key deletes nothing of this member's",
  );
  assert.equal(await runners.deregister(key, first), true);
  assert.deepEqual(await runners.clientsOf(key), [second]);
  assert.deepEqual(await allowed(), [{ held: 1 }]);
  assert.equal(await runners.deregister(key, second), true);
  assert.equal(await runners.runners(key), undefined);
  assert.deepEqual(await allowed(), [{ held: 0 }]);
});

test("a project joins an allowlist only for a registered runner, while it is active, and in the runner's tenant", async () => {
  const partition = await project("runner-allow");
  const elsewhere = await project("runner-allow-elsewhere");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  assert.equal(await runners.allow(key, partition.project), "NotFound");
  await runners.register(registration(key, `client-${partition.tenant}`));
  assert.equal(
    await runners.allow(key, elsewhere.project),
    "NotFound",
    "another tenant's project is not one this tenant holds",
  );
  const suspended = await projectIn(partition.tenant, "runner-allow-suspended");
  await harness.store.fence(suspended, "Suspended");
  assert.equal(await runners.allow(key, suspended.project), "NotFound");
  assert.equal(await runners.allow(key, partition.project), "Allowed");
  assert.equal(await runners.allow(key, partition.project), "Allowed");
  assert.deepEqual((await runners.runners(key))?.projects, [partition.project]);
  assert.equal(await runners.disallow(key, partition.project), true);
  assert.deepEqual((await runners.runners(key))?.projects, []);
  assert.equal(
    await runners.disallow(
      { tenant: partition.tenant, owner: other },
      partition.project,
    ),
    false,
  );
});

test("an allowlist holds at most its bound of projects", async () => {
  const first = await project("runner-bound");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: first.tenant, owner: member };
  await runners.register(registration(key, `client-${first.tenant}`));
  assert.equal(await runners.allow(key, first.project), "Allowed");
  for (let held = 1; held < personalRunnerProjectsMax; held += 1) {
    const next = await projectIn(first.tenant, `runner-bound-${String(held)}`);
    assert.equal(await runners.allow(key, next.project), "Allowed");
  }
  const past = await projectIn(first.tenant, "runner-bound-past");
  assert.equal(await runners.allow(key, past.project), "LimitReached");
  assert.equal(
    (await runners.runners(key))?.projects.length,
    personalRunnerProjectsMax,
  );
});

test("the schema itself refuses an allowlist row naming another tenant's project", async () => {
  const partition = await project("runner-foreign");
  const elsewhere = await project("runner-foreign-elsewhere");
  const runners = postgresPersonalRunnerRegistry(api);
  await runners.register(
    registration(
      { tenant: partition.tenant, owner: member },
      `client-${partition.tenant}`,
    ),
  );
  await assert.rejects(
    harness.query(
      `INSERT INTO personal_runner_project(tenant,owner,project) VALUES($1,$2,$3)`,
      [partition.tenant, member, elsewhere.project],
    ),
    /personal_runner_project_tenant_project_fkey/u,
  );
});

test("a personal token is spent once, by whichever of two racing redemptions the statement admits", async () => {
  const { tenant } = await project("token-race");
  const tokens = postgresPersonalRunnerRegistrationTokens(api);
  const digest = postgresHarnessTokenDigest("a1");
  assert.equal(
    await tokens.mint(tenant, digest, Date.now() + 60_000, member),
    "Minted",
  );
  assert.deepEqual(await tokens.permitted(digest), {
    tenant,
    mintedBy: member,
  });
  const spent = await Promise.all([
    tokens.consume(digest),
    tokens.consume(digest),
  ]);
  assert.equal(spent.filter((terms) => terms !== undefined).length, 1);
  assert.equal(await tokens.permitted(digest), undefined);
  assert.equal(await tokens.restore(digest), true);
  assert.notEqual(await tokens.consume(digest), undefined);
});

test("a personal token past its expiry is neither readable, spendable nor restorable", async () => {
  const { tenant } = await project("token-lapsed");
  const tokens = postgresPersonalRunnerRegistrationTokens(api);
  const digest = postgresHarnessTokenDigest("b2");
  assert.equal(
    await tokens.mint(tenant, digest, Date.now() - 1_000, member),
    "Minted",
  );
  assert.equal(await tokens.permitted(digest), undefined);
  assert.equal(await tokens.consume(digest), undefined);
  assert.equal(await tokens.restore(digest), false);
});

test("a personal token names a tenant that is a row", async () => {
  const tokens = postgresPersonalRunnerRegistrationTokens(api);
  assert.equal(
    await tokens.mint(
      asTenantId("tenant-never-made"),
      postgresHarnessTokenDigest("c3"),
      Date.now() + 60_000,
      member,
    ),
    "NotFound",
  );
});

test("a member holds at most their bound of live tokens in a tenant, and a mint sweeps their expired ones", async () => {
  const { tenant } = await project("token-bound");
  const tokens = postgresPersonalRunnerRegistrationTokens(api);
  assert.equal(
    await tokens.mint(
      tenant,
      postgresHarnessTokenDigest("d0"),
      Date.now() - 1_000,
      member,
    ),
    "Minted",
  );
  for (let minted = 1; minted <= personalRunnerTokensLiveMax; minted += 1)
    assert.equal(
      await tokens.mint(
        tenant,
        postgresHarnessTokenDigest(`d${String(minted)}`),
        Date.now() + 60_000,
        member,
      ),
      "Minted",
    );
  assert.equal(
    await tokens.mint(
      tenant,
      postgresHarnessTokenDigest("dff"),
      Date.now() + 60_000,
      member,
    ),
    "LimitReached",
  );
  assert.equal(
    await tokens.mint(
      tenant,
      postgresHarnessTokenDigest("e0"),
      Date.now() + 60_000,
      other,
    ),
    "Minted",
    "the bound is one member's, not the tenant's",
  );
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::int AS held FROM personal_runner_registration_token
        WHERE tenant=$1 AND minted_by=$2`,
      [tenant, member],
    ),
    [{ held: personalRunnerTokensLiveMax }],
    "the expired token was swept",
  );
});

test("the pool plane reads a runner and its allowlist and stamps its poll, and changes nothing else", async () => {
  for (const [relation, column] of [
    ["personal_runner", "tenant"],
    ["personal_runner", "owner"],
    ["personal_runner", "capabilities"],
    ["personal_runner", "principal"],
    ["personal_runner", "executions_polled_at"],
    ["personal_runner", "runner_package"],
    ["personal_runner", "runner_version"],
    ["personal_runner_project", "project"],
  ] as const)
    assert.equal(
      await harness.attemptAs(
        poolPlaneRole,
        `SELECT ${column} FROM ${relation}`,
      ),
      undefined,
      `${relation}.${column}`,
    );
  assert.equal(
    await harness.attemptAs(
      poolPlaneRole,
      `UPDATE personal_runner SET last_polled_at=now(),runner_package=NULL,runner_version=NULL
        WHERE principal='none'`,
    ),
    undefined,
  );
  for (const statement of [
    `UPDATE personal_runner SET principal='p' WHERE principal='none'`,
    `DELETE FROM personal_runner_project`,
    `INSERT INTO personal_runner_project(tenant,owner,project) VALUES('t','o','p')`,
    `SELECT client_id FROM personal_runner`,
  ])
    assert.match(
      (await harness.attemptAs(poolPlaneRole, statement)) ?? "",
      /permission denied/u,
      statement,
    );
  assert.match(
    (await harness.attemptAs(
      poolPlaneRole,
      `SELECT token_digest FROM personal_runner_registration_token`,
    )) ?? "",
    postgresHarnessDenial("personal_runner_registration_token"),
  );
});

test("the API writes a runner whole or not at all, never a column of one in place", async () => {
  for (const column of [
    "capabilities",
    "principal",
    "client_id",
    "registered_at",
    "last_polled_at",
    "executions_polled_at",
    "runner_package",
    "runner_version",
  ])
    assert.match(
      (await harness.attemptAs(
        apiRole,
        `UPDATE personal_runner SET ${column}=${column} WHERE false`,
      )) ?? "",
      /permission denied/u,
      column,
    );
});

test("the boundary reads a runner's owner, principal and poll and its allowlist, and the scheduler its owner, principal, capabilities and allowlist alone", async () => {
  assert.equal(
    await harness.attemptAs(
      boundaryOwnerRole,
      `SELECT tenant,owner,principal,last_polled_at FROM personal_runner`,
    ),
    undefined,
  );
  assert.equal(
    await harness.attemptAs(
      boundaryOwnerRole,
      `SELECT tenant,owner,project FROM personal_runner_project`,
    ),
    undefined,
  );
  for (const statement of [
    `SELECT tenant,owner,principal,capabilities FROM personal_runner`,
    `SELECT tenant,owner,project FROM personal_runner_project`,
  ])
    assert.equal(
      await harness.attemptAs(schedulerRole, statement),
      undefined,
      statement,
    );
  for (const statement of [
    `SELECT client_id FROM personal_runner`,
    `SELECT last_polled_at FROM personal_runner`,
  ])
    assert.match(
      (await harness.attemptAs(schedulerRole, statement)) ?? "",
      /permission denied/u,
      statement,
    );
  assert.match(
    (await harness.attemptAs(
      schedulerRole,
      `SELECT 1 FROM personal_runner_registration_token`,
    )) ?? "",
    postgresHarnessDenial("personal_runner_registration_token"),
  );
});

test("a runner's owner, principal and client are bounded, and a principal or client is one runner's", async () => {
  const { tenant } = await project("runner-bounds");
  await assert.rejects(
    harness.query(
      `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
       VALUES($1,$2,'{}','p-long','c-long')`,
      [tenant, "o".repeat(257)],
    ),
    /personal_runner_owner_is_bounded/u,
  );
  await harness.query(
    `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
     VALUES($1,'owner-a','{}',$2,$3)`,
    [tenant, `principal-${tenant}`, `client-${tenant}`],
  );
  await assert.rejects(
    harness.query(
      `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
       VALUES($1,'owner-b','{}',$2,'another-client')`,
      [tenant, `principal-${tenant}`],
    ),
    /personal_runner_principal_key/u,
  );
  await assert.rejects(
    harness.query(
      `INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
       VALUES($1,'owner-b','{}','another-principal',$2)`,
      [tenant, `client-${tenant}`],
    ),
    /personal_runner_client_id_key/u,
  );
});
