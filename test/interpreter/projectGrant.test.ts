import assert from "node:assert/strict";
import { test } from "node:test";

import { oidcPrincipal } from "../../src/interpreter/nativeWeb.ts";
import {
  allProjectGrantRelations,
  allTenantGrantRelations,
  checkedProjectGrantSettings,
  projectAuthorityDefaults,
  projectPrincipalGrant,
  projectTenantGrant,
  projectTenantRelation,
  siteAuthorityDefaults,
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessSiteNamespace,
  projectAccessSiteObject,
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
    subject: "Object",
    namespace: projectAccessTenantNamespace,
    object: projectAccessTenantObject(request.tenant),
  });
});

test("a tenant's administrator is the principal an authenticated request carries, in the relation that administers", () => {
  const principal = oidcPrincipal(request.issuer, request.subject);
  assert.deepEqual(
    tenantAdministratorGrant(principal, asTenantId(request.tenant)),
    tenantPrincipalGrant({ ...request, relation: "admins" }),
  );
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
    "pools",
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

/** A tuple as one line of the authority's own notation, so a level's defaults compare as a set. */
function grantText(grant: ProjectGrant): string {
  const holder =
    grant.holder.subject === "Principal"
      ? grant.holder.principal
      : grant.holder.subject === "Object"
        ? `${grant.holder.namespace}:${grant.holder.object}`
        : `${grant.holder.namespace}:${grant.holder.object}#${grant.holder.relation}`;
  return `${grant.namespace}:${grant.object}#${grant.relation}@${holder}`;
}

const defaultsOf = (grants: readonly ProjectGrant[]): readonly string[] =>
  grants.map(grantText).sort();

test("the site starts with its administrators making accounts and tenants, and nobody managing", () => {
  const site = `${projectAccessSiteNamespace}:${projectAccessSiteObject}`;
  assert.deepEqual(defaultsOf(siteAuthorityDefaults()), [
    `${site}#account_creators@${site}#admins`,
    `${site}#tenant_creators@${site}#admins`,
  ]);
});

test("a tenant starts linked to the site, its own administrators granting and managing, and the site's granting hosted runs", () => {
  const tenant = asTenantId(request.tenant);
  const object = `${projectAccessTenantNamespace}:${projectAccessTenantObject(tenant)}`;
  const site = `${projectAccessSiteNamespace}:${projectAccessSiteObject}`;
  assert.deepEqual(
    defaultsOf(tenantAuthorityDefaults(tenant)),
    [
      `${object}#admin_granters@${object}#admins`,
      `${object}#authority_managers@${object}#admins`,
      `${object}#hosted_execution_granters@${site}#admins`,
      `${object}#member_granters@${object}#admins`,
      `${object}#site@${site}`,
    ].sort(),
  );
});

test("a project starts with each of its authority relations held by its administrators and its tenant's", () => {
  const partition = {
    tenant: asTenantId(request.tenant),
    project: asProjectId(request.project),
  };
  const object = `${projectAccessNamespace}:${projectAccessObject(partition)}`;
  const tenant = `${projectAccessTenantNamespace}:${projectAccessTenantObject(partition.tenant)}`;
  assert.deepEqual(
    defaultsOf(projectAuthorityDefaults(partition)),
    [
      "admin_granters",
      "developer_granters",
      "dispatcher_granters",
      "authority_managers",
    ]
      .flatMap((relation) => [
        `${object}#${relation}@${object}#admins`,
        `${object}#${relation}@${tenant}#admins`,
      ])
      .sort(),
  );
});
