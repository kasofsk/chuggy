/**
 * The two checks the API asks of its pools before it starts, against a real
 * server. A database that answered is answered yes or no, including one that
 * was never migrated; a raise is left for a database that could not be reached
 * or queried, which is the split the start-up refusal reports.
 *
 * THE DEPLOYED SHAPE IS A LOGIN ROLE HOLDING BOTH GROUP ROLES BY GRANT, each
 * pool switching to one with the role option its URL carries, as
 * `deploy/rig/images/README.md` states it. A case connects that way as well as
 * as the server's owner, and the start-up refusal itself is driven in a child
 * process, because `.dependency-cruiser.cjs` forbids importing a root.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";

import { postgresApiReady } from "../../src/adapters/postgres/apiReadiness.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  selectorReviewRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresSelectorContextReady } from "../../src/adapters/postgres/selectorContextReadiness.ts";
import { postgresHarnessRolePool, postgresHarnessUrl } from "./harness.ts";
import { migrationDatabase } from "./migrationHarness.ts";

const execute = promisify(execFile);

/** The URL of a pool holding one deployment role over the database `url` names. */
function roleUrlAt(url: string, role: string): string {
  const at = new URL(url);
  at.searchParams.set("options", `-c role=${role}`);
  return at.toString();
}

function rolePoolAt(url: string, role: string) {
  return postgresPool(roleUrlAt(url, role));
}

/** The root's start-up check over the two URLs its environment names, printing what it refused with or null. */
const databasesReadyProgram = `
  const root = await import('./src/roots/nativeHttp.ts');
  const { postgresPool } = await import('./src/adapters/postgres/pool.ts');
  const api = postgresPool(process.env.READINESS_API_URL);
  const review = postgresPool(process.env.READINESS_REVIEW_URL);
  const refusal = await root.nativeDatabasesReady(api, review).then(
    async () => {
      await Promise.all([api.end(), review.end()]);
      return null;
    },
    (failure) => failure.message,
  );
  process.stdout.write(JSON.stringify({ refusal }));
`;

async function databasesReadyRefusal(
  apiUrl: string,
  reviewUrl: string,
): Promise<string | null> {
  const ran = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      databasesReadyProgram,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        READINESS_API_URL: apiUrl,
        READINESS_REVIEW_URL: reviewUrl,
      },
    },
  );
  return (JSON.parse(ran.stdout) as { refusal: string | null }).refusal;
}

test("each check answers yes over the migrated schema as its own role, and no as the other's", async () => {
  const api = postgresHarnessRolePool(apiRole);
  const review = postgresHarnessRolePool(selectorReviewRole);
  try {
    assert.equal(await postgresApiReady(api), true);
    assert.equal(await postgresSelectorContextReady(review), true);
    assert.equal(await postgresApiReady(review), false);
    assert.equal(await postgresSelectorContextReady(api), false);
  } finally {
    await Promise.all([api.end(), review.end()]);
  }
});

test("as a login role holding both group roles by grant, each check answers yes and a start refuses nothing", async () => {
  const admin = postgresPool(postgresHarnessUrl());
  const login = `chuggy_readiness_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID();
  await admin.query(
    `CREATE ROLE ${login} WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
  );
  try {
    await admin.query(`GRANT ${apiRole}, ${selectorReviewRole} TO ${login}`);
    const at = new URL(postgresHarnessUrl());
    at.username = login;
    at.password = password;
    const apiUrl = roleUrlAt(at.toString(), apiRole);
    const reviewUrl = roleUrlAt(at.toString(), selectorReviewRole);
    const api = postgresPool(apiUrl);
    const review = postgresPool(reviewUrl);
    try {
      assert.equal(await postgresApiReady(api), true);
      assert.equal(await postgresSelectorContextReady(review), true);
    } finally {
      await Promise.all([api.end(), review.end()]);
    }
    assert.equal(await databasesReadyRefusal(apiUrl, reviewUrl), null);
  } finally {
    await admin.query(`DROP ROLE ${login}`);
    await admin.end();
  }
});

test("a database that answered but was never migrated is answered no rather than raised, as either check's own role", async () => {
  await migrationDatabase("unmigrated_ready", async (_subject, url) => {
    const api = rolePoolAt(url, apiRole);
    const review = rolePoolAt(url, selectorReviewRole);
    try {
      assert.equal(await postgresApiReady(api), false);
      assert.equal(await postgresSelectorContextReady(review), false);
    } finally {
      await Promise.all([api.end(), review.end()]);
    }
  });
});
