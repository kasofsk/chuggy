/**
 * The agreement plane over a store in memory: the deployment's policies as its
 * setting names them, a standing read against the current versions and
 * digests, and an agreement refused whole where any policy it names has moved.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { agreementPoliciesMax } from "../../src/contract/agreementPlane.ts";
import {
  agreementPlane,
  agreementPlanePoliciesRead,
} from "../../src/interpreter/agreementPlane.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  agreementFixtureEntry,
  agreementFixtureIssuer,
  agreementFixturePrincipal,
  agreementMemory,
} from "./agreementPlaneFixture.ts";

const terms = agreementFixtureEntry("terms", "2026-11");
const privacy = agreementFixtureEntry("privacy", "v3");
const alice = agreementFixturePrincipal("alice");
const bob = agreementFixturePrincipal("bob");
const agreedAtMs = Date.parse("2026-11-27T12:00:00.000Z");

function planeOver(policies = [terms, privacy]) {
  const memory = agreementMemory(() => agreedAtMs);
  return {
    memory,
    plane: agreementPlane(memory.store, {
      issuer: agreementFixtureIssuer,
      policies,
    }),
  };
}

const named = (entry: typeof terms) => ({
  policy: entry.policy,
  version: entry.version,
  digest: entry.digest,
});

test("an unset or empty setting names no policies, and a well-formed one names each in its order", () => {
  assert.deepEqual(agreementPlanePoliciesRead(undefined), []);
  assert.deepEqual(agreementPlanePoliciesRead(""), []);
  assert.deepEqual(agreementPlanePoliciesRead("[]"), []);
  assert.deepEqual(
    agreementPlanePoliciesRead(JSON.stringify([privacy, terms])),
    [privacy, terms],
  );
});

test("a setting that is not a list of distinct, well-formed policies is refused", () => {
  for (const malformed of [
    "{",
    "{}",
    JSON.stringify([terms, { ...terms, version: "other" }]),
    JSON.stringify([{ ...terms, digest: "a".repeat(64) }]),
    JSON.stringify([{ ...terms, url: "http://site.example/terms" }]),
    JSON.stringify([{ ...terms, policy: "Terms Of Service" }]),
    JSON.stringify([{ ...terms, extra: true }]),
    JSON.stringify(
      Array.from({ length: agreementPoliciesMax + 1 }, (_, index) =>
        agreementFixtureEntry(`policy-${String(index)}`, "v1"),
      ),
    ),
  ])
    assert.throws(() => agreementPlanePoliciesRead(malformed), RangeError);
});

test("a plane naming no policies answers none and an empty standing without asking its store", async () => {
  const memory = agreementMemory();
  const asked = {
    ...memory.store,
    agreed: () => Promise.reject(new Error("asked")),
  };
  const plane = agreementPlane(asked, {
    issuer: agreementFixtureIssuer,
    policies: [],
  });
  assert.deepEqual(plane.policies(), { policies: [] });
  assert.deepEqual(await plane.standing(alice), { policies: [] });
  assert.deepEqual(await plane.personStanding("anyone"), { policies: [] });
});

test("an agreement is recorded with its evidence and read back on every current policy", async () => {
  const { plane, memory } = planeOver();
  const agreed = await plane.agreed(
    alice,
    { agreements: [named(terms)] },
    { clientAddress: "192.0.2.7", userAgent: "browser" },
  );
  assert.deepEqual(agreed, {
    outcome: "Agreed",
    standing: {
      policies: [
        { ...terms, agreedAt: new Date(agreedAtMs).toISOString() },
        privacy,
      ],
    },
  });
  assert.equal(memory.rows.length, 1);
  assert.equal(memory.rows[0]?.url, terms.url);
  assert.deepEqual(memory.rows[0]?.evidence, {
    clientAddress: "192.0.2.7",
    userAgent: "browser",
  });
});

test("one stale policy among current ones writes nothing and is answered with the current policies", async () => {
  const { plane, memory } = planeOver();
  for (const stale of [
    { ...named(privacy), version: "v2" },
    { ...named(privacy), digest: `sha256:${"b".repeat(64)}` },
    named(agreementFixtureEntry("cookies", "v1")),
  ])
    assert.deepEqual(
      await plane.agreed(alice, { agreements: [named(terms), stale] }, {}),
      { outcome: "PoliciesChanged", current: { policies: [terms, privacy] } },
    );
  assert.deepEqual(memory.rows, []);
});

test("an agreement under a re-pinned digest is not agreed until agreed again", async () => {
  const memory = agreementMemory(() => agreedAtMs);
  const before = agreementPlane(memory.store, {
    issuer: agreementFixtureIssuer,
    policies: [terms],
  });
  await before.agreed(alice, { agreements: [named(terms)] }, {});
  const repinned = { ...terms, digest: `sha256:${"c".repeat(64)}` };
  const after = agreementPlane(memory.store, {
    issuer: agreementFixtureIssuer,
    policies: [repinned],
  });
  assert.deepEqual(await after.standing(alice), { policies: [repinned] });
  await after.agreed(alice, { agreements: [named(repinned)] }, {});
  assert.equal(
    (await after.standing(alice))?.policies[0]?.agreedAt,
    new Date(agreedAtMs).toISOString(),
  );
});

test("one caller's agreement leaves another's standing as it was", async () => {
  const { plane } = planeOver();
  await plane.agreed(alice, { agreements: [named(terms), named(privacy)] }, {});
  assert.deepEqual(await plane.standing(bob), { policies: [terms, privacy] });
  assert.deepEqual(await plane.personStanding(bob), {
    policies: [terms, privacy],
  });
});

test("a caller under another issuer is answered absent and nothing is written", async () => {
  const { plane, memory } = planeOver();
  const stranger = oidcPrincipal("https://other.example", "alice");
  assert.equal(await plane.standing(stranger), undefined);
  assert.deepEqual(
    await plane.agreed(stranger, { agreements: [named(terms)] }, {}),
    { outcome: "Absent" },
  );
  assert.deepEqual(memory.rows, []);
});

test("a person the store has never seen has agreed to nothing, and is answered so", async () => {
  const { plane } = planeOver();
  assert.deepEqual(await plane.personStanding("never-seen"), {
    policies: [terms, privacy],
  });
});
