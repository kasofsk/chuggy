/**
 * The access plane against a real authority: what a list reads back from the
 * tuples, a principal and a project object decoded from what the server
 * answers, and a role granted being a permit `ProjectAccess` then answers for.
 *
 * NOTHING ON A FRESH TENANT IS WRITTEN BUT BY THE CASE. The plane cannot write
 * a `tenant` link or a tenant's first administrator, so each case writes those
 * itself, as creation and provisioning do.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ketoAccessPageTuplesMax } from "../../src/adapters/keto/accessTuples.ts";
import {
  accessPlane,
  accessPlaneBoundsDefault,
} from "../../src/interpreter/accessPlane.ts";
import {
  oidcPrincipal,
  oidcPrincipalSubject,
} from "../../src/interpreter/principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessObjectPartition,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectPrincipalGrant,
  projectTenantGrant,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  ketoHarnessAccess,
  ketoHarnessGrants,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessTuples,
} from "./harness.ts";

const access = ketoHarnessAccess();
const grants = ketoHarnessGrants();
const tuples = ketoHarnessTuples();
const plane = accessPlane(
  { access, tuples, grants },
  { issuer: ketoHarnessIssuer, bounds: accessPlaneBoundsDefault },
);
const alice = oidcPrincipal(ketoHarnessIssuer, "alice");

/**
 * A fresh tenant administered by alice, with two projects linked to it and one
 * under its name that is not. Every project carries a `/`, as the harness's do.
 */
async function tenantOf(label: string) {
  const web = ketoHarnessPartition(label);
  const api: Partition = {
    tenant: web.tenant,
    project: asProjectId(`api/${web.project}`),
  };
  const loose: Partition = {
    tenant: web.tenant,
    project: asProjectId(`loose/${web.project}`),
  };
  await grants.write(projectTenantGrant(web));
  await grants.write(projectTenantGrant(api));
  await grants.write(
    tenantPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "alice",
      tenant: web.tenant,
      relation: "admins",
    }),
  );
  return { web, api, loose, tenant: web.tenant };
}

test("a tenant's administrator lists every holder the authority answers, the caller marked and the linked projects named", async () => {
  const { web, api, loose, tenant } = await tenantOf("people");
  assert.equal(
    await plane.tenantRoleGranted(alice, tenant, "b/o:1", "Member"),
    "Changed",
  );
  assert.equal(
    await plane.projectRoleGranted(alice, web, "b/o:1", "Developer"),
    "Changed",
  );
  assert.equal(
    await plane.projectRoleGranted(alice, api, "cy", "Dispatcher"),
    "Changed",
  );
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject: "stray",
      ...loose,
      relation: "developers",
    }),
  );
  await grants.write(
    tenantPrincipalGrant({
      issuer: "https://other.keto.test",
      subject: "x",
      tenant,
      relation: "members",
    }),
  );
  const people = await plane.tenantPeople(alice, tenant);
  assert.deepEqual(people?.projects, [api.project, web.project].sort());
  assert.deepEqual(
    people?.people.map((person) => [
      person.subject,
      person.mine,
      person.tenantRoles,
      person.projects,
    ]),
    [
      ["alice", true, ["Admin"], []],
      [
        "b/o:1",
        false,
        ["Member"],
        [{ project: web.project, roles: ["Developer"] }],
      ],
      ["cy", false, [], [{ project: api.project, roles: ["Dispatcher"] }]],
    ],
  );
  assert.equal(people?.otherIssuers, 1);
  assert.equal(people?.truncated, false);
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "alice", "Admin"),
    "LastTenantAdministrator",
  );
});

test("a principal and a project object read back from the authority decode to what was written", async () => {
  const partition = ketoHarnessPartition("decode");
  const subject = "a/b:c 7";
  await grants.write(
    projectPrincipalGrant({
      issuer: ketoHarnessIssuer,
      subject,
      ...partition,
      relation: "developers",
    }),
  );
  const page = await tuples.page(
    {
      query: "Object",
      namespace: projectAccessNamespace,
      object: projectAccessObject(partition),
    },
    undefined,
  );
  const [tuple] = page.tuples;
  assert.deepEqual(
    projectAccessObjectPartition(tuple?.object ?? ""),
    partition,
  );
  assert.equal(
    tuple?.subject.subject === "Id"
      ? oidcPrincipalSubject(ketoHarnessIssuer, tuple.subject.id)
      : undefined,
    subject,
  );
});

/** Whether `subject` holds `kind` on `partition`, asked as the API asks it. */
async function holds(
  subject: string,
  partition: Partition,
  kind: ProjectAccessKind,
): Promise<boolean> {
  return (
    (await access.authorize(
      oidcPrincipal(ketoHarnessIssuer, subject),
      partition,
      kind,
    )) !== undefined
  );
}

test("a project role granted is the permit it carries, and removed is not", async () => {
  const { web } = await tenantOf("permits");
  for (const [role, kind] of [
    ["Developer", "Mutate"],
    ["Dispatcher", "DispatchTicket"],
    ["Admin", "Administer"],
  ] as const) {
    const subject = `holder-${role}`;
    assert.equal(await holds(subject, web, kind), false, role);
    await plane.projectRoleGranted(alice, web, subject, role);
    assert.equal(await holds(subject, web, kind), true, role);
    await plane.projectRoleRemoved(alice, web, subject, role);
    assert.equal(await holds(subject, web, kind), false, role);
  }
});

test("a tenant's administrator granted administers each of its projects, and removed does not", async () => {
  const { web, api, tenant } = await tenantOf("tenant-admin");
  await plane.tenantRoleGranted(alice, tenant, "dee", "Admin");
  for (const partition of [web, api])
    assert.equal(await holds("dee", partition, "Administer"), true);
  assert.equal(
    await plane.tenantRoleRemoved(alice, tenant, "dee", "Admin"),
    "Changed",
  );
  for (const partition of [web, api])
    assert.equal(await holds("dee", partition, "Administer"), false);
});

test("a list crosses the authority's page boundary and reads every holder past it", async () => {
  const { tenant } = await tenantOf("pages");
  const subjects = Array.from(
    { length: ketoAccessPageTuplesMax + 3 },
    (_, at) => `member-${String(at).padStart(3, "0")}`,
  );
  for (const subject of subjects)
    await plane.tenantRoleGranted(alice, tenant, subject, "Member");
  const first = await tuples.page(
    {
      query: "Object",
      namespace: projectAccessTenantNamespace,
      object: projectAccessTenantObject(tenant),
    },
    undefined,
  );
  assert.equal(first.tuples.length, ketoAccessPageTuplesMax);
  assert.notEqual(first.next ?? "", "");
  const people = await plane.tenantPeople(alice, tenant);
  assert.deepEqual(
    people?.people.map((person) => person.subject),
    ["alice", ...subjects],
  );
  assert.equal(people?.truncated, false);
});
