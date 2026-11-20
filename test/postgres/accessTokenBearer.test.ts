/**
 * A presented access token against a real server: a live one answers its maker,
 * project and access, and a deleted one, an expired one and one of an older
 * recovery epoch answer nothing, each read afresh.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  accessTokenSecretDigest,
  accessTokenSecrets,
} from "../../src/adapters/crypto/accessTokenMint.ts";
import {
  postgresAccessTokenBearerAuthority,
  postgresAccessTokens,
} from "../../src/adapters/postgres/accessToken.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import { asAccessTokenBearerSecret } from "../../src/interpreter/accessToken.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessNewEpoch,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

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

const maker = asPrincipal("issuer-maker");

/** A token minted in `partition` through the API's own store, and its secret. */
async function minted(partition: Partition, name: string) {
  const drawn = accessTokenSecrets().mint();
  const written = await postgresAccessTokens(api).mint(partition, {
    token: drawn.token,
    name,
    access: "Write",
    maker,
    secretDigest: drawn.secretDigest,
    lifetimeDays: 30,
  });
  assert.equal(written.written, "Minted");
  return { ...drawn, secret: asAccessTokenBearerSecret(drawn.secret) };
}

function authority() {
  return postgresAccessTokenBearerAuthority(api, accessTokenSecretDigest);
}

test("a live token answers its maker in its project, under its access, until it is deleted", async () => {
  const partition = await postgresHarnessProject(harness.store, "bearer-live");
  const made = await minted(partition, "nightly");
  const found = await authority().authenticate(made.secret);
  assert.ok(found !== undefined);
  assert.deepEqual(
    {
      partition: found.partition,
      token: found.token,
      name: found.name,
      access: found.access,
      principal: found.principal,
    },
    {
      partition,
      token: made.token,
      name: "nightly",
      access: "Write",
      principal: maker,
    },
  );
  assert.ok(Date.parse(found.expiresAt) > Date.now());
  assert.equal(
    await postgresAccessTokens(api).deleted(partition, made.token, maker),
    true,
  );
  assert.equal(await authority().authenticate(made.secret), undefined);
});

test("an expired token answers nothing", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "bearer-expired",
  );
  const drawn = accessTokenSecrets().mint();
  await harness.query(
    `INSERT INTO access_token(tenant,project,token,name,access,maker,secret_digest,created_at,expires_at,recovery_epoch)
     SELECT $1,$2,$3,'expired','Write',$4,$5,now()-interval '2 days',now()-interval '1 day',epoch
       FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1`,
    [
      partition.tenant,
      partition.project,
      drawn.token,
      maker,
      drawn.secretDigest,
    ],
  );
  assert.equal(
    await authority().authenticate(asAccessTokenBearerSecret(drawn.secret)),
    undefined,
  );
});

test("a token of an older recovery epoch answers nothing", async () => {
  const partition = await postgresHarnessProject(harness.store, "bearer-epoch");
  const made = await minted(partition, "before-recovery");
  assert.notEqual(await authority().authenticate(made.secret), undefined);
  await harness.store.establishRecoveryEpoch(postgresHarnessNewEpoch());
  assert.equal(await authority().authenticate(made.secret), undefined);
});

test("a secret no row holds answers nothing", async () => {
  const drawn = accessTokenSecrets().mint();
  assert.equal(
    await authority().authenticate(asAccessTokenBearerSecret(drawn.secret)),
    undefined,
  );
});
