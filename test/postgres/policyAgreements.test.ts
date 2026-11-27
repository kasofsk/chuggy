/**
 * Who agreed to which policies against a real PostgreSQL, driven as the
 * agreement plane's own role: what that role is refused, the first agreement
 * standing with its time and evidence when it is made again, a re-pinned
 * digest asking again, and a stale agreement writing nothing.
 *
 * EACH CASE AGREES AS A PERSON OF ITS OWN, so the cases share the suite's
 * database without reading each other's rows.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresPolicyAgreements,
  postgresPolicyAgreementsReady,
} from "../../src/adapters/postgres/policyAgreements.ts";
import {
  agreementPlaneRole,
  metricsPlaneRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import type { AgreementPolicyEntry } from "../../src/contract/agreementPlane.ts";
import { agreementPlane } from "../../src/interpreter/agreementPlane.ts";
import {
  agreementFixtureEntry,
  agreementFixtureIssuer,
  agreementFixturePrincipal,
} from "../interpreter/agreementPlaneFixture.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let role: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  role = postgresHarnessRolePool(agreementPlaneRole);
});
after(async () => {
  await role.end();
  await harness.close();
});

const terms = agreementFixtureEntry("terms", "2026-11");
const privacy = agreementFixtureEntry("privacy", "v3");

function planeOver(policies: readonly AgreementPolicyEntry[]) {
  return agreementPlane(postgresPolicyAgreements(role), {
    issuer: agreementFixtureIssuer,
    policies,
  });
}

const named = (entry: AgreementPolicyEntry) => ({
  policy: entry.policy,
  version: entry.version,
  digest: entry.digest,
});

async function rowsOf(principal: string) {
  return harness.query(
    `SELECT policy,version,url,digest,agreed_at,host(client_address) AS client_address,user_agent
     FROM policy_agreement WHERE principal=$1 ORDER BY policy`,
    [principal],
  );
}

test("the plane's role is ready, and another role's connection is not the plane's", async () => {
  assert.equal(
    await postgresPolicyAgreementsReady(role, agreementPlaneRole),
    true,
  );
  const owner = postgresHarnessRolePool(metricsPlaneRole);
  try {
    assert.equal(
      await postgresPolicyAgreementsReady(owner, agreementPlaneRole),
      false,
    );
  } finally {
    await owner.end();
  }
});

test("the plane's role appends and reads its record, and can neither alter nor remove it nor write its time", async () => {
  for (const statement of [
    "SELECT principal,policy,version,url,digest,agreed_at,client_address,user_agent FROM policy_agreement",
    `INSERT INTO policy_agreement(principal,policy,version,url,digest,client_address,user_agent)
     VALUES('role-case','terms','v1','https://site.example/terms','sha256:${"a".repeat(64)}','192.0.2.1','agent')`,
  ])
    assert.equal(
      await harness.attemptAs(agreementPlaneRole, statement),
      undefined,
      statement,
    );
  for (const [statement, relation] of [
    ["UPDATE policy_agreement SET user_agent=user_agent", "policy_agreement"],
    ["UPDATE policy_agreement SET agreed_at=now()", "policy_agreement"],
    ["DELETE FROM policy_agreement", "policy_agreement"],
    ["TRUNCATE policy_agreement", "policy_agreement"],
    [
      `INSERT INTO policy_agreement(principal,policy,version,url,digest,agreed_at)
       VALUES('role-case','terms','v1','https://site.example/terms','sha256:${"a".repeat(64)}',now())`,
      "policy_agreement",
    ],
    ["SELECT * FROM project", "project"],
    ["SELECT * FROM invite_link", "invite_link"],
  ] as const)
    assert.match(
      (await harness.attemptAs(agreementPlaneRole, statement)) ?? "",
      postgresHarnessDenial(relation),
      statement,
    );
});

test("a second agreement to the same version and digest leaves the first row's time and evidence as they were", async () => {
  const plane = planeOver([terms, privacy]);
  const alice = agreementFixturePrincipal("again-alice");
  await plane.agreed(
    alice,
    { agreements: [named(terms)] },
    { clientAddress: "192.0.2.7", userAgent: "first" },
  );
  const [first] = await rowsOf(alice);
  const again = await plane.agreed(
    alice,
    { agreements: [named(terms), named(privacy)] },
    { clientAddress: "2001:db8::1", userAgent: "second" },
  );
  assert.equal(again.outcome, "Agreed");
  const rows = await rowsOf(alice);
  assert.equal(rows.length, 2);
  const kept = rows.find((row) => row["policy"] === "terms");
  assert.deepEqual(kept, first);
  assert.equal(kept?.["client_address"], "192.0.2.7");
  assert.equal(kept?.["user_agent"], "first");
  assert.equal(kept?.["url"], terms.url);
  const added = rows.find((row) => row["policy"] === "privacy");
  assert.equal(added?.["client_address"], "2001:db8::1");
  if (again.outcome === "Agreed")
    assert.equal(
      again.standing.policies[0]?.agreedAt,
      (first?.["agreed_at"] as Date).toISOString(),
    );
});

test("an agreement with no evidence keeps none, and its time is the database's", async () => {
  const plane = planeOver([terms]);
  const alice = agreementFixturePrincipal("bare-alice");
  const [clock] = await harness.query("SELECT now() AS at");
  await plane.agreed(alice, { agreements: [named(terms)] }, {});
  const [row] = await rowsOf(alice);
  assert.equal(row?.["client_address"], null);
  assert.equal(row?.["user_agent"], null);
  assert.ok(
    (row?.["agreed_at"] as Date).getTime() >= (clock?.["at"] as Date).getTime(),
  );
});

test("an agreement under a re-pinned digest is read as not agreed until agreed again", async () => {
  const alice = agreementFixturePrincipal("repinned-alice");
  await planeOver([terms]).agreed(alice, { agreements: [named(terms)] }, {});
  const repinned = { ...terms, digest: `sha256:${"d".repeat(64)}` };
  const after = planeOver([repinned]);
  assert.deepEqual(await after.standing(alice), { policies: [repinned] });
  await after.agreed(alice, { agreements: [named(repinned)] }, {});
  const standing = await after.standing(alice);
  assert.equal(typeof standing?.policies[0]?.agreedAt, "string");
  assert.equal((await rowsOf(alice)).length, 2);
});

test("a request naming one stale policy among current ones writes no row and is answered with the current policies", async () => {
  const plane = planeOver([terms, privacy]);
  const alice = agreementFixturePrincipal("stale-alice");
  assert.deepEqual(
    await plane.agreed(
      alice,
      { agreements: [named(terms), { ...named(privacy), version: "v2" }] },
      { clientAddress: "192.0.2.7" },
    ),
    { outcome: "PoliciesChanged", current: { policies: [terms, privacy] } },
  );
  assert.deepEqual(await rowsOf(alice), []);
});

test("a person the table has never seen is answered every current policy with no agreement", async () => {
  assert.deepEqual(await planeOver([terms, privacy]).personStanding("nobody"), {
    policies: [terms, privacy],
  });
});
