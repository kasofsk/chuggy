import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { personalRunnerProjectsMax } from "../../src/contract/http.ts";
import {
  postgresPersonalRunnerRegistrationTokens,
  postgresPersonalRunnerRegistry,
} from "../../src/adapters/postgres/personalRunner.ts";
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
  postgresHarnessDenial,
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
before(async () => {
  harness = await postgresHarnessOpen();
  api = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await api.end();
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

test("a member's first registration writes their one runner in the tenant, and a second over nothing is moved", async () => {
  const { tenant } = await project("runner-first");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant, owner: member };
  assert.equal(
    await runners.register(registration(key, `first-${tenant}`), undefined),
    "Registered",
  );
  assert.equal(await runners.clientOf(key), `first-${tenant}`);
  assert.equal(
    await runners.register(registration(key, `racer-${tenant}`), undefined),
    "Moved",
    "a member has at most one runner in a tenant",
  );
  assert.equal(await runners.clientOf(key), `first-${tenant}`);
  assert.equal(
    await runners.register(
      registration({ tenant, owner: other }, `other-${tenant}`),
      undefined,
    ),
    "Registered",
    "the bound is one member's, not the tenant's",
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
      undefined,
    ),
    "NotFound",
  );
});

test("replacing a runner writes over the client it was read with, keeps its allowlist, and is moved otherwise", async () => {
  const partition = await project("runner-replace");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  const first = `first-${partition.tenant}`;
  await runners.register(registration(key, first), undefined);
  assert.equal(await runners.allow(key, partition.project), "Allowed");
  const second = `second-${partition.tenant}`;
  assert.equal(
    await runners.register(registration(key, second, ["macos"]), first),
    "Registered",
  );
  assert.equal(
    await runners.register(
      registration(key, `third-${partition.tenant}`),
      first,
    ),
    "Moved",
    "a row no longer naming the client read is not written",
  );
  const read = await runners.runner(key);
  assert.deepEqual(read?.capabilities, ["macos"]);
  assert.deepEqual(read?.projects, [partition.project]);
  assert.equal(await runners.clientOf(key), second);
});

test("a runner is read with its newest poll of either kind, live only while that poll is inside the window", async () => {
  const partition = await project("runner-polled");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  await runners.register(
    registration(key, `client-${partition.tenant}`),
    undefined,
  );
  const unpolled = await runners.runner(key);
  assert.equal(unpolled?.polledAt, undefined);
  assert.equal(unpolled?.live, false);
  const stamp = (column: string, secsAgo: number) =>
    harness.query(
      `UPDATE personal_runner
          SET ${column}=now()-make_interval(secs=>$2::double precision)
        WHERE tenant=$1`,
      [partition.tenant, secsAgo],
    );
  await stamp("last_polled_at", sessionRunnerPolledSecsMax * 3);
  await stamp("executions_polled_at", sessionRunnerPolledSecsMax * 2);
  const stale = await runners.runner(key);
  assert.equal(stale?.live, false);
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
  assert.equal((await runners.runner(key))?.live, true);
});

test("deregistering deletes the row only where it names the client, and takes the allowlist with it", async () => {
  const partition = await project("runner-deregister");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  const client = `client-${partition.tenant}`;
  await runners.register(registration(key, client), undefined);
  await runners.allow(key, partition.project);
  assert.equal(await runners.deregister(key, "a-newer-client"), false);
  assert.equal(await runners.deregister(key, client), true);
  assert.equal(await runners.runner(key), undefined);
  assert.deepEqual(
    await harness.query(
      `SELECT count(*)::int AS held FROM personal_runner_project WHERE tenant=$1`,
      [partition.tenant],
    ),
    [{ held: 0 }],
  );
});

test("a project joins an allowlist only for a registered runner, while it is active, and in the runner's tenant", async () => {
  const partition = await project("runner-allow");
  const elsewhere = await project("runner-allow-elsewhere");
  const runners = postgresPersonalRunnerRegistry(api);
  const key = { tenant: partition.tenant, owner: member };
  assert.equal(await runners.allow(key, partition.project), "NotFound");
  await runners.register(
    registration(key, `client-${partition.tenant}`),
    undefined,
  );
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
  assert.deepEqual((await runners.runner(key))?.projects, [partition.project]);
  assert.equal(await runners.disallow(key, partition.project), true);
  assert.deepEqual((await runners.runner(key))?.projects, []);
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
  await runners.register(
    registration(key, `client-${first.tenant}`),
    undefined,
  );
  assert.equal(await runners.allow(key, first.project), "Allowed");
  for (let held = 1; held < personalRunnerProjectsMax; held += 1) {
    const next = await projectIn(first.tenant, `runner-bound-${String(held)}`);
    assert.equal(await runners.allow(key, next.project), "Allowed");
  }
  const past = await projectIn(first.tenant, "runner-bound-past");
  assert.equal(await runners.allow(key, past.project), "LimitReached");
  assert.equal(
    (await runners.runner(key))?.projects.length,
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
    undefined,
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
    await tokens.mint(tenant, digest, ["linux"], Date.now() + 60_000, member),
    "Minted",
  );
  assert.deepEqual(await tokens.permitted(digest), {
    tenant,
    capabilities: ["linux"],
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
    await tokens.mint(tenant, digest, [], Date.now() - 1_000, member),
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
      [],
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
      [],
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
        [],
        Date.now() + 60_000,
        member,
      ),
      "Minted",
    );
  assert.equal(
    await tokens.mint(
      tenant,
      postgresHarnessTokenDigest("dff"),
      [],
      Date.now() + 60_000,
      member,
    ),
    "LimitReached",
  );
  assert.equal(
    await tokens.mint(
      tenant,
      postgresHarnessTokenDigest("e0"),
      [],
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
      `UPDATE personal_runner SET last_polled_at=now() WHERE principal='none'`,
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
