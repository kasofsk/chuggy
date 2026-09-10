import assert from "node:assert/strict";
import { test } from "node:test";

import { authorityCharsMax } from "../../src/interpreter/operationInbox.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  allProjectAccessKinds,
  checkedProjectAccessSettings,
  memberAuthorities,
  memberAuthority,
  memberAuthorityKind,
  projectAccessObject,
  projectAccessPermits,
  projectAccessTenantObject,
  projectAccessTimeoutMsDefault,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import { executionSchedulerAuthorityKind } from "../../src/interpreter/executionScheduler.ts";
import { finalizerAuthorityKind } from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const partitionOf = (tenant: string, project: string) => ({
  tenant: asTenantId(tenant),
  project: asProjectId(project),
});

test("no two partitions carrying the separator encode to one object", () => {
  const objects = [
    partitionOf("a/b", "c"),
    partitionOf("a", "/bc"),
    partitionOf("a", "b/c"),
    partitionOf("ab", "c"),
    partitionOf("a:b", "c"),
    partitionOf("a", ":bc"),
  ].map(projectAccessObject);
  assert.equal(
    new Set(objects).size,
    objects.length,
    `two partitions share an object: ${objects.join(" ")}`,
  );
});

test("a tenant's own object is the partition encoding with no project on it", () => {
  assert.equal(
    projectAccessObject(partitionOf("acme", "web")),
    `${projectAccessTenantObject("acme")}web`,
  );
});

test("every access kind asks for a permit and no two ask for the same one", () => {
  const permits = allProjectAccessKinds.map(
    (kind) => projectAccessPermits[kind],
  );
  assert.equal(permits.length, allProjectAccessKinds.length);
  assert.equal(new Set(permits).size, permits.length);
  assert.ok(permits.every((permit) => permit.length > 0));
});

test("the derived authority is the principal under one kind", () => {
  const principal = asPrincipal("22:https://issuer.test/geoff");
  assert.deepEqual(memberAuthority(principal), {
    kind: memberAuthorityKind,
    subject: principal,
  });
});

test("the derived kind is neither boundary kind a completion is reserved to", () => {
  assert.notEqual(memberAuthorityKind, executionSchedulerAuthorityKind);
  assert.notEqual(memberAuthorityKind, finalizerAuthorityKind);
});

test("a principal too wide to be audited is refused rather than authorized", () => {
  assert.throws(
    () => memberAuthority(asPrincipal("p".repeat(authorityCharsMax + 1))),
    RangeError,
  );
});

test("settings take the default bound and refuse a URL nothing could be read from", () => {
  assert.deepEqual(
    checkedProjectAccessSettings({ readUrl: "http://keto.test:4466" }),
    {
      readUrl: "http://keto.test:4466/",
      requestTimeoutMs: projectAccessTimeoutMsDefault,
    },
  );
  for (const refused of [
    { readUrl: "ftp://keto.test" },
    { readUrl: "https://user:secret@keto.test" },
    { readUrl: "https://keto.test", requestTimeoutMs: 0 },
    { readUrl: "https://keto.test", requestTimeoutMs: 1.5 },
  ])
    assert.throws(() => checkedProjectAccessSettings(refused), RangeError);
  assert.throws(() => checkedProjectAccessSettings({ readUrl: "keto" }));
});

/** A port that admits the principals it is given and records every question. */
function accessAdmitting(admitted: readonly string[]): {
  readonly access: ProjectAccess;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    access: {
      authorize: (principal) => {
        asked.push(principal);
        return Promise.resolve(
          admitted.includes(principal) ? memberAuthority(principal) : undefined,
        );
      },
    },
  };
}

test("one page asks the authority once per distinct principal", async () => {
  const alice = asPrincipal("20:https://issuer.test/alice");
  const bob = asPrincipal("20:https://issuer.test/bobby");
  const asking = accessAdmitting([alice]);
  const admitted = await memberAuthorities(
    asking.access,
    partitionOf("acme", "web"),
    [alice, bob, alice, bob, alice],
    2,
  );
  assert.deepEqual(asking.asked, [alice, bob]);
  assert.deepEqual(admitted.get(alice), memberAuthority(alice));
  assert.equal(admitted.get(bob), undefined);
});

test("a page naming more principals than its bound is refused, not truncated", async () => {
  const principals = [0, 1, 2].map((at) =>
    asPrincipal(`20:https://issuer.test/p${String(at)}`),
  );
  const asking = accessAdmitting(principals);
  await assert.rejects(
    () =>
      memberAuthorities(
        asking.access,
        partitionOf("acme", "web"),
        principals,
        2,
      ),
    RangeError,
  );
});
