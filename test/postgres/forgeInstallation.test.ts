/**
 * The claimed-installation row against a real server: the door's four outcomes,
 * what the trigger refuses even from the owner, and which role may reach any of
 * it.
 *
 * AN ACCOUNT IS THE UNIT AND THE TENANT IS NOT PART OF IT. The cases that
 * matter are two tenants claiming one account and one tenant claiming it twice,
 * because those are the two the key shape decides.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import {
  postgresForgeInstallationClaims,
  postgresForgeInstallationRecording,
  postgresForgeInstallations,
} from "../../src/adapters/postgres/forgeInstallation.ts";
import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
} from "../../src/interpreter/forgeInstallation.ts";
import { forgeInstallationsAnsweredMax } from "../../src/contract/http.ts";
import { asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import type { ForgeInstallationClaim } from "../../src/interpreter/forgeInstallationClaim.ts";
import {
  apiRole,
  configurationImporterRole,
  finalizerRole,
  forgeInstallationRecordFunction,
  schedulerRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

/** One claim on an account no other case is using. */
function claim(
  overrides: Partial<ForgeInstallationClaim> = {},
): ForgeInstallationClaim {
  return {
    forge: asForgeId("github"),
    app: asForgeApp("portal"),
    account: asForgeAccount(`account-${randomUUID()}`),
    accountKind: "Organization",
    installationId: asForgeInstallationId("156333284"),
    tenant: asTenantId("vteng"),
    authority: {
      kind: asAuthorityKind("Member"),
      subject: asAuthoritySubject("14:https://issuer/op"),
    },
    ...overrides,
  };
}

test("a claim is recorded once and replays by equality", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const first = claim();
  assert.equal(await recording.record(first), "Recorded");
  assert.equal(await recording.record(first), "AlreadyRecorded");
  assert.deepEqual(
    await postgresForgeInstallations(harness.pool).installation({
      forge: first.forge,
      app: first.app,
      account: first.account,
      tenant: first.tenant,
    }),
    {
      forge: first.forge,
      app: first.app,
      account: first.account,
      installationId: first.installationId,
    },
  );
});

test("an account another tenant holds is reported rather than taken", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const first = claim();
  assert.equal(await recording.record(first), "Recorded");
  assert.equal(
    await recording.record({ ...first, tenant: asTenantId("other") }),
    "ClaimedElsewhere",
  );
  const held = await postgresForgeInstallations(harness.pool).installation({
    forge: first.forge,
    app: first.app,
    account: first.account,
    tenant: first.tenant,
  });
  assert.equal(
    held?.installationId,
    first.installationId,
    "the standing claim did not move",
  );
});

test("a reinstall moves the claim onto the new installation", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const first = claim();
  assert.equal(await recording.record(first), "Recorded");
  const again = {
    ...first,
    installationId: asForgeInstallationId("156786211"),
  };
  assert.equal(await recording.record(again), "Reinstalled");
  assert.equal(await recording.record(again), "AlreadyRecorded");
  const held = await postgresForgeInstallations(harness.pool).installation({
    forge: first.forge,
    app: first.app,
    account: first.account,
    tenant: first.tenant,
  });
  assert.equal(held?.installationId, again.installationId);
});

test("an account no tenant claimed is answered by nothing at all", async () => {
  assert.equal(
    await postgresForgeInstallations(harness.pool).installation({
      forge: asForgeId("github"),
      app: asForgeApp("portal"),
      account: asForgeAccount(`account-${randomUUID()}`),
      tenant: asTenantId("vteng"),
    }),
    undefined,
  );
});

test("a claim another tenant holds is answered by nothing at all", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const first = claim();
  assert.equal(await recording.record(first), "Recorded");
  const installations = postgresForgeInstallations(harness.pool);
  assert.equal(
    await installations.installation({
      forge: first.forge,
      app: first.app,
      account: first.account,
      tenant: asTenantId("other"),
    }),
    undefined,
    "the account is claimed, but not by the tenant asking",
  );
  assert.notEqual(
    await installations.installation({
      forge: first.forge,
      app: first.app,
      account: first.account,
      tenant: first.tenant,
    }),
    undefined,
    "the tenant holding the claim still reads it",
  );
});

test("a tenant reads back every claim it holds and none of another's", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const tenant = asTenantId(`tenant-${randomUUID()}`);
  const first = claim({ tenant });
  const second = claim({
    tenant,
    installationId: asForgeInstallationId("156786211"),
  });
  const stranger = claim({ tenant: asTenantId(`tenant-${randomUUID()}`) });
  for (const recorded of [first, second, stranger])
    assert.equal(await recording.record(recorded), "Recorded");
  const page = await postgresForgeInstallationClaims(harness.pool).claims(
    tenant,
  );
  assert.equal(page.truncated, false);
  assert.deepEqual(
    page.claims.map((row) => row.account).sort(),
    [first.account, second.account].sort(),
  );
  assert.deepEqual(
    page.claims.map((row) => row.app),
    ["portal", "portal"],
  );
});

test("a tenant holding more claims than the page answers is told the page is partial", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const tenant = asTenantId(`tenant-${randomUUID()}`);
  for (let index = 0; index <= forgeInstallationsAnsweredMax; index += 1)
    assert.equal(await recording.record(claim({ tenant })), "Recorded");
  const page = await postgresForgeInstallationClaims(harness.pool).claims(
    tenant,
  );
  assert.equal(page.truncated, true);
  assert.equal(page.claims.length, forgeInstallationsAnsweredMax);
});

test("the claim under an installation identity is the asking tenant's own row", async () => {
  const recording = postgresForgeInstallationRecording(harness.pool);
  const tenant = asTenantId(`tenant-${randomUUID()}`);
  const other = asTenantId(`tenant-${randomUUID()}`);
  const installationId = asForgeInstallationId("156901733");
  const own = claim({ tenant, installationId });
  const theirs = claim({ tenant: other, installationId });
  assert.equal(await recording.record(own), "Recorded");
  assert.equal(await recording.record(theirs), "Recorded");
  const claims = postgresForgeInstallationClaims(harness.pool);
  const found = await claims.claim(tenant, installationId);
  assert.equal(
    found?.account,
    own.account,
    "the row read is the asking tenant's and not the other tenant's",
  );
  assert.equal(found?.installationId, installationId);
  assert.equal(
    await claims.claim(tenant, asForgeInstallationId("156901734")),
    undefined,
  );
});

test("a claim is never released and never changes hands, even by the owner", async () => {
  const recorded = claim();
  assert.equal(
    await postgresForgeInstallationRecording(harness.pool).record(recorded),
    "Recorded",
  );
  const named = `forge='${recorded.forge}' AND app='${recorded.app}' AND account='${recorded.account}'`;
  await assert.rejects(
    () => harness.query(`DELETE FROM forge_installation WHERE ${named}`),
    /is not released/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE forge_installation SET tenant='elsewhere' WHERE ${named}`,
      ),
    /does not change hands/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE forge_installation SET account='moved' WHERE ${named}`,
      ),
    /does not change hands/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE forge_installation SET forge='gitlab' WHERE ${named}`,
      ),
    /does not change hands/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE forge_installation SET app='worker' WHERE ${named}`,
      ),
    /does not change hands/u,
    "an app the table declares is still not one a claim moves to",
  );
});

test("an app and an account kind this tree does not declare are refused by the table", async () => {
  await assert.rejects(
    () =>
      harness.query(
        `INSERT INTO forge_installation
           (forge,app,account,account_kind,installation_id,tenant,
            authority_kind,authority_subject)
           VALUES('github','mirror','a','Organization','1','vteng','Member','s')`,
      ),
    /forge_installation_app_is_known/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `INSERT INTO forge_installation
           (forge,app,account,account_kind,installation_id,tenant,
            authority_kind,authority_subject)
           VALUES('github','portal','b','Team','1','vteng','Member','s')`,
      ),
    /forge_installation_account_kind_is_known/u,
  );
});

test("the API reads the claimed installations and writes none directly", async () => {
  assert.equal(
    await harness.attemptAs(
      apiRole,
      "SELECT installation_id,tenant FROM forge_installation",
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      apiRole,
      "UPDATE forge_installation SET tenant=tenant",
    )) ?? "",
    postgresHarnessDenial("forge_installation"),
  );
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT ${forgeInstallationRecordFunction}(
         'github','portal','api-claimed','Organization','88','api-tenant',
         'Member','s')`,
    ),
    undefined,
  );
});

test("no other runtime role reaches a claim or the door onto one", async () => {
  for (const role of [
    ticketServiceRole,
    selectorServiceRole,
    schedulerRole,
    finalizerRole,
    configurationImporterRole,
  ]) {
    assert.match(
      (await harness.attemptAs(role, "SELECT * FROM forge_installation")) ?? "",
      postgresHarnessDenial("forge_installation"),
      role,
    );
    assert.match(
      (await harness.attemptAs(
        role,
        `SELECT ${forgeInstallationRecordFunction}(
           'github','portal','a','Organization','1','vteng','Member','s')`,
      )) ?? "",
      postgresHarnessDenial(forgeInstallationRecordFunction),
      role,
    );
  }
});

/**
 * The worker plane is the second reader of a claim, because it mints a pod's
 * credential at the moment the pod asks: the installation a repository's owner
 * was claimed under is what selects the installation to mint from. It reads and
 * it never claims, so the door onto a claim stays the API's alone.
 */
test("the worker plane reads a claim to mint from, and claims nothing itself", async () => {
  assert.equal(
    await harness.attemptAs(
      workerPlaneRole,
      "SELECT installation_id,tenant FROM forge_installation",
    ),
    undefined,
  );
  for (const written of [
    "UPDATE forge_installation SET tenant=tenant",
    `INSERT INTO forge_installation
       (forge,app,account,account_kind,installation_id,tenant,authority_kind,
        authority_subject)
       VALUES ('github','portal','b','Organization','2','vteng','Member','s')`,
    "DELETE FROM forge_installation",
  ])
    assert.match(
      (await harness.attemptAs(workerPlaneRole, written)) ?? "",
      postgresHarnessDenial("forge_installation"),
      written,
    );
  assert.match(
    (await harness.attemptAs(
      workerPlaneRole,
      `SELECT ${forgeInstallationRecordFunction}(
         'github','portal','a','Organization','1','vteng','Member','s')`,
    )) ?? "",
    postgresHarnessDenial(forgeInstallationRecordFunction),
  );
});
