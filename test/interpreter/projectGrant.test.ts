import assert from "node:assert/strict";
import { test } from "node:test";

import { oidcPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  allProjectGrantRelations,
  allTenantGrantRelations,
  checkedProjectGrantSettings,
  projectPrincipalGrant,
  projectTenantGrant,
  projectTenantRelation,
  tenantPrincipalGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  projectAccessTimeoutMsDefault,
} from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";

const request = {
  issuer: "https://accounts.example.test",
  subject: "subject-one",
  tenant: "tenant-one",
  project: "project-one",
  relation: "developers",
};

test("a granted principal is the one the authenticated boundary derives", () => {
  const grant = projectPrincipalGrant(request);
  assert.deepEqual(grant.holder, {
    subject: "Principal",
    principal: oidcPrincipal(request.issuer, request.subject),
  });
  assert.equal(grant.namespace, projectAccessNamespace);
  assert.equal(
    grant.object,
    projectAccessObject({
      tenant: asTenantId(request.tenant),
      project: asProjectId(request.project),
    }),
  );
  assert.equal(grant.relation, "developers");
});

test("a tenant grant names the tenant namespace and the tenant's own object", () => {
  const grant = tenantPrincipalGrant({ ...request, relation: "members" });
  assert.equal(grant.namespace, projectAccessTenantNamespace);
  assert.equal(grant.object, projectAccessTenantObject(request.tenant));
  assert.deepEqual(grant.holder, {
    subject: "Principal",
    principal: oidcPrincipal(request.issuer, request.subject),
  });
});

test("the tenant relation names the tenant's object rather than a person", () => {
  const grant = projectTenantGrant(request);
  assert.equal(grant.namespace, projectAccessNamespace);
  assert.equal(grant.relation, projectTenantRelation);
  assert.deepEqual(grant.holder, {
    subject: "Tenant",
    tenantObject: projectAccessTenantObject(request.tenant),
  });
});

test("a relation the namespace does not declare is refused", () => {
  for (const relation of ["members", projectTenantRelation, "", "Admins"])
    assert.throws(
      () => projectPrincipalGrant({ ...request, relation }),
      RangeError,
      `${relation} was accepted as a project relation`,
    );
  for (const relation of ["developers", "", "Admins"])
    assert.throws(
      () => tenantPrincipalGrant({ ...request, relation }),
      RangeError,
      `${relation} was accepted as a tenant relation`,
    );
  assert.deepEqual([...allProjectGrantRelations].sort(), [
    "admins",
    "agents",
    "developers",
    "dispatchers",
  ]);
  assert.deepEqual([...allTenantGrantRelations].sort(), [
    "admins",
    "hosted_execution",
    "members",
  ]);
});

test("every identity a grant names is refused empty", () => {
  for (const empty of [
    { issuer: "" },
    { subject: "" },
    { tenant: "" },
    { project: "" },
  ])
    assert.throws(
      () => projectPrincipalGrant({ ...request, ...empty }),
      RangeError,
      `${Object.keys(empty)[0] ?? "a field"} was accepted empty`,
    );
});

test("the writer's settings take the default bound and refuse an unusable URL", () => {
  assert.deepEqual(
    checkedProjectGrantSettings({ writeUrl: "http://keto.test:4467" }),
    {
      writeUrl: "http://keto.test:4467/",
      requestTimeoutMs: projectAccessTimeoutMsDefault,
    },
  );
  assert.throws(
    () => checkedProjectGrantSettings({ writeUrl: "https://u:p@keto.test" }),
    RangeError,
  );
});
