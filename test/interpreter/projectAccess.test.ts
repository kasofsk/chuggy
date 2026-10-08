import assert from "node:assert/strict";
import { test } from "node:test";

import { authorityCharsMax } from "../../src/interpreter/operationInbox.ts";
import {
  asPrincipal,
  oidcPrincipal,
  oidcPrincipalSubject,
} from "../../src/interpreter/principal.ts";
import {
  allProjectAccessKinds,
  checkedProjectAccessSettings,
  memberAuthorities,
  memberAuthority,
  memberAuthorityKind,
  projectAccessObject,
  projectAccessObjectPartition,
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

test("a project object decodes to the partition it was encoded from, separators and all", () => {
  for (const partition of [
    partitionOf("a/b", "c"),
    partitionOf("a", "/bc"),
    partitionOf("a:b", ":c"),
    partitionOf("1:a", "2:b"),
    partitionOf("\u{1F600}", "web"),
  ])
    assert.deepEqual(
      projectAccessObjectPartition(projectAccessObject(partition)),
      partition,
    );
});

test("text no partition encodes to decodes to nothing", () => {
  for (const object of [
    "",
    "acme",
    ":acme",
    "0:web",
    "04:acmeweb",
    "4:acme",
    "9:acme",
    projectAccessTenantObject("acme"),
    `2:${"\u{1F600}".slice(0, 1)}x`,
  ])
    assert.equal(projectAccessObjectPartition(object), undefined, object);
});

test("a principal decodes to its subject under its own issuer and to nothing under another", () => {
  const issuer = "https://issuer.test";
  for (const subject of ["geoff", "a:b/c", "22:https://other.test"])
    assert.equal(
      oidcPrincipalSubject(issuer, oidcPrincipal(issuer, subject)),
      subject,
    );
  for (const other of [
    "https://issuer.tes",
    "https://issuer.testx",
    "https://issuer.TEST",
  ])
    assert.equal(
      oidcPrincipalSubject(issuer, oidcPrincipal(other, "geoff")),
      undefined,
      other,
    );
  assert.equal(oidcPrincipalSubject(issuer, `19:${issuer}`), undefined);
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

test("a principal too wide to be audited is refused where it is composed", () => {
  assert.throws(
    () => asPrincipal("p".repeat(authorityCharsMax + 1)),
    RangeError,
  );
  assert.deepEqual(
    memberAuthority(asPrincipal("p".repeat(authorityCharsMax))),
    {
      kind: memberAuthorityKind,
      subject: "p".repeat(authorityCharsMax),
    },
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
      authorizeTenant: () => Promise.resolve(undefined),
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
