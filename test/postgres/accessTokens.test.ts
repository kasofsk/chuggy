/**
 * A project's access tokens against a real server: concurrent mints keep both
 * bounds, a maker holds a name once in a project, a lifetime past its bound is
 * refused by the table, the epoch a token records is the newest, and only the
 * API reaches the table.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresAccessTokens } from "../../src/adapters/postgres/accessToken.ts";
import {
  apiRole,
  schedulerRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import {
  accessTokensHeldMax,
  accessTokensProjectMax,
} from "../../src/contract/accessToken.ts";
import type { AccessTokenMinting } from "../../src/interpreter/accessToken.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessDenial,
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

/** One mint's row, its identity and digest fresh, named `name` and made by `maker`. */
function minting(
  maker: Principal,
  name: string,
  lifetimeDays = 30,
): AccessTokenMinting {
  const token = randomUUID();
  return {
    token,
    name,
    access: "Read",
    maker,
    secretDigest: createHash("sha256").update(token).digest("hex"),
    lifetimeDays,
  };
}

async function held(partition: Partition, maker?: Principal): Promise<number> {
  const found = await harness.query(
    `SELECT count(*)::int AS held FROM access_token
      WHERE tenant=$1 AND project=$2 AND ($3::text IS NULL OR maker=$3)`,
    [partition.tenant, partition.project, maker ?? null],
  );
  return Number(found[0]?.["held"]);
}

test("concurrent mints by one maker keep the maker's bound", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-held");
  const tokens = postgresAccessTokens(api);
  const maker = asPrincipal("issuer-maker");
  const written = await Promise.all(
    Array.from({ length: accessTokensHeldMax + 4 }, (_unused, at) =>
      tokens.mint(partition, minting(maker, `token-${String(at)}`)),
    ),
  );
  assert.equal(
    written.filter((one) => one.written === "Minted").length,
    accessTokensHeldMax,
  );
  for (const one of written.filter((each) => each.written !== "Minted"))
    assert.deepEqual(one, { written: "LimitReached", bound: "Held" });
  assert.equal(await held(partition, maker), accessTokensHeldMax);
});

test("concurrent mints by many makers keep the project's bound", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "token-project",
  );
  const tokens = postgresAccessTokens(api);
  const makers = accessTokensProjectMax / accessTokensHeldMax + 1;
  const written = await Promise.all(
    Array.from({ length: makers * accessTokensHeldMax }, (_unused, at) =>
      tokens.mint(
        partition,
        minting(
          asPrincipal(`issuer-maker-${String(at % makers)}`),
          `token-${String(at)}`,
        ),
      ),
    ),
  );
  assert.equal(
    written.filter((one) => one.written === "Minted").length,
    accessTokensProjectMax,
  );
  assert.ok(
    written.some(
      (one) => one.written === "LimitReached" && one.bound === "Project",
    ),
  );
  assert.equal(await held(partition), accessTokensProjectMax);
  assert.equal(
    (await tokens.listed(partition, undefined)).length,
    accessTokensProjectMax,
  );
});

test("a maker holds a name once in a project, and another maker may hold it too", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-name");
  const tokens = postgresAccessTokens(api);
  const maker = asPrincipal("issuer-maker");
  assert.equal(
    (await tokens.mint(partition, minting(maker, "nightly"))).written,
    "Minted",
  );
  assert.deepEqual(await tokens.mint(partition, minting(maker, "nightly")), {
    written: "NameTaken",
  });
  assert.equal(
    (
      await tokens.mint(
        partition,
        minting(asPrincipal("issuer-other"), "nightly"),
      )
    ).written,
    "Minted",
  );
  await assert.rejects(
    harness.query(
      `INSERT INTO access_token(tenant,project,token,name,access,maker,secret_digest,expires_at,recovery_epoch)
       SELECT $1,$2,'duplicate','nightly','Read',$3,$4,now()+interval '1 day',epoch
         FROM recovery_epoch ORDER BY ordinal DESC LIMIT 1`,
      [partition.tenant, partition.project, maker, "f".repeat(64)],
    ),
    /access_token_name_is_the_makers_once/u,
  );
});

test("a lifetime of 367 days is refused by the table, and 366 is kept", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-life");
  const tokens = postgresAccessTokens(api);
  const maker = asPrincipal("issuer-maker");
  await assert.rejects(
    tokens.mint(partition, minting(maker, "too-long", 367)),
    /access_token_expires_within_its_lifetime/u,
  );
  const kept = await tokens.mint(partition, minting(maker, "longest", 366));
  assert.equal(kept.written, "Minted");
  assert.equal(await held(partition), 1);
});

test("a token records the newest recovery epoch at its mint", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-epoch");
  const newest = await harness.store.establishRecoveryEpoch(
    postgresHarnessNewEpoch(),
  );
  const tokens = postgresAccessTokens(api);
  const made = minting(asPrincipal("issuer-maker"), "epoch");
  assert.equal((await tokens.mint(partition, made)).written, "Minted");
  const found = await harness.query(
    `SELECT recovery_epoch FROM access_token WHERE tenant=$1 AND project=$2 AND token=$3`,
    [partition.tenant, partition.project, made.token],
  );
  assert.deepEqual(found, [{ recovery_epoch: newest }]);
});

test("a list is newest first and a maker's own where one is named, and a delete reaches only what its maker may", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-list");
  const tokens = postgresAccessTokens(api);
  const maker = asPrincipal("issuer-maker");
  const other = asPrincipal("issuer-other");
  const first = minting(maker, "first");
  const second = minting(other, "second");
  await tokens.mint(partition, first);
  await harness.query(
    `UPDATE access_token SET created_at=created_at-interval '1 minute',
            expires_at=expires_at-interval '1 minute'
      WHERE tenant=$1 AND project=$2 AND token=$3`,
    [partition.tenant, partition.project, first.token],
  );
  await tokens.mint(partition, second);
  assert.deepEqual(
    (await tokens.listed(partition, undefined)).map((token) => token.name),
    ["second", "first"],
  );
  assert.deepEqual(
    (await tokens.listed(partition, maker)).map((token) => token.name),
    ["first"],
  );
  assert.equal(await tokens.deleted(partition, second.token, maker), false);
  assert.equal(await tokens.deleted(partition, second.token, other), true);
  assert.equal(await tokens.deleted(partition, first.token, undefined), true);
  assert.equal(await held(partition), 0);
});

test("a mint in a project that is not active writes nothing", async () => {
  const partition = await postgresHarnessProject(harness.store, "token-fenced");
  await harness.query(
    `UPDATE project SET lifecycle='Deleting' WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  assert.deepEqual(
    await postgresAccessTokens(api).mint(
      partition,
      minting(asPrincipal("issuer-maker"), "fenced"),
    ),
    { written: "NotFound" },
  );
  assert.equal(await held(partition), 0);
});

test("only the API reaches the table, and it changes no row in place", async () => {
  for (const role of [ticketServiceRole, schedulerRole])
    assert.match(
      (await harness.attemptAs(role, "SELECT * FROM access_token")) ?? "",
      postgresHarnessDenial("access_token"),
      role,
    );
  assert.equal(
    await harness.attemptAs(
      apiRole,
      "SELECT tenant,project,token,name,access,maker,secret_digest,created_at,expires_at,recovery_epoch FROM access_token",
    ),
    undefined,
  );
  assert.match(
    (await harness.attemptAs(
      apiRole,
      "UPDATE access_token SET expires_at=expires_at",
    )) ?? "",
    postgresHarnessDenial("access_token"),
  );
});
