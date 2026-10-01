import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectNameCharsMax,
  reservedTenantNames,
} from "../../src/contract/requests.ts";
import {
  asOperationId,
  type OperationId,
} from "../../src/interpreter/operationInbox.ts";
import {
  memberAuthority,
  ProjectAccessUnavailable,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectCreation,
  projectCreationNameFault,
  type ProjectCreationAnswer,
  type ProjectCreationOutcome,
  type ProjectCreationWrite,
} from "../../src/interpreter/projectCreation.ts";
import {
  projectRelationGrant,
  projectTenantGrant,
  tenantAdministratorGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type TenantId,
} from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const principal = asPrincipal("issuer alice");
const partition = {
  tenant: asTenantId("vteng"),
  project: asProjectId("chuggy"),
};
const request = {
  tenant: partition.tenant,
  project: partition.project,
  operation: asOperationId("create-chuggy-1"),
};

/** A creation over ports that record what they were asked and answer as scripted. */
function creationWith(
  answer: ProjectCreationAnswer,
  options: {
    readonly claimed?: readonly string[];
    readonly grantFails?: boolean;
    readonly selector?: Principal;
  } = {},
) {
  const access = memoryProjectAccess();
  const writes: ProjectCreationWrite[] = [];
  const grants: ProjectGrant[] = [];
  const recorded: OperationId[] = [];
  const asked: TenantId[] = [];
  const claims = {
    broken: false,
    claimed: (tenant: TenantId) => {
      asked.push(tenant);
      if (claims.broken)
        return Promise.reject(new ProjectAccessUnavailable("keto down"));
      return Promise.resolve(options.claimed?.includes(tenant) === true);
    },
  };
  const service = projectCreation({
    access,
    claims,
    store: {
      create: (write) => {
        writes.push(write);
        return Promise.resolve(answer);
      },
      recordGrants: (operation) => {
        recorded.push(operation);
        return Promise.resolve();
      },
    },
    grants: {
      write: (grant) => {
        if (options.grantFails === true)
          return Promise.reject(new ProjectAccessUnavailable("keto down"));
        grants.push(grant);
        return Promise.resolve();
      },
      remove: () => Promise.reject(new Error("creation removes no grant")),
    },
    ...(options.selector === undefined ? {} : { selector: options.selector }),
  });
  return { access, claims, asked, writes, grants, recorded, service };
}

const created: ProjectCreationAnswer = {
  outcome: "Created",
  tenantCreated: true,
  grantsWritten: false,
  operation: request.operation,
};

/** An earlier identity the same creator made the project under, which a repeat under a new one finishes. */
const earlier = asOperationId("create-chuggy-0");

test("a name is lowercase letters, digits and hyphens that begin and end with a letter or digit", () => {
  for (const name of [
    "vteng",
    "chuggy",
    "rehearsal",
    "a",
    "a-b",
    "a--1",
    "9lives",
    "a".repeat(projectNameCharsMax),
  ])
    assert.equal(
      projectCreationNameFault({ tenant: name, project: name }),
      undefined,
      name,
    );
  for (const name of [
    "",
    "Vteng",
    "-a",
    "a-",
    "-",
    "a_b",
    "a.b",
    "a b",
    "ä",
    "a".repeat(projectNameCharsMax + 1),
  ])
    assert.equal(
      projectCreationNameFault({ tenant: name, project: "chuggy" }),
      "tenant",
      name,
    );
});

test("a refused name names its own field, the tenant's first", () => {
  assert.equal(
    projectCreationNameFault({ tenant: "vteng", project: "Chuggy" }),
    "project",
  );
  assert.equal(
    projectCreationNameFault({ tenant: "Vteng", project: "Chuggy" }),
    "tenant",
  );
});

test("a refused name asks neither the authority nor the door", async () => {
  const { access, asked, writes, grants, service } = creationWith(created);
  access.breaks();
  assert.deepEqual(
    await service.create(principal, { ...request, project: "Chuggy" }),
    { result: "NameInvalid", field: "project" },
  );
  assert.deepEqual(asked, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(grants, []);
});

test("the door is told the caller administers the tenant, or else whether any tuple holds it", async () => {
  const administering = creationWith(created, {
    claimed: [partition.tenant],
  });
  administering.access.grantTenant({
    tenant: partition.tenant,
    principal,
    access: new Set(["AdministerTenant"]),
  });
  await administering.service.create(principal, request);
  assert.equal(administering.writes[0]?.standing, "Administers");
  assert.deepEqual(administering.asked, []);
  const claimed = creationWith(created, { claimed: [partition.tenant] });
  await claimed.service.create(principal, request);
  assert.equal(claimed.writes[0]?.standing, "Claimed");
  assert.deepEqual(claimed.asked, [partition.tenant]);
  const unclaimed = creationWith(created);
  await unclaimed.service.create(principal, request);
  assert.equal(unclaimed.writes[0]?.standing, "Unclaimed");
});

test("the door is told whether the tenant's name is reserved, and a reservation it answers creates nothing", async () => {
  for (const tenant of reservedTenantNames) {
    const refused = creationWith({ ...created, outcome: "TenantReserved" });
    assert.deepEqual(
      await refused.service.create(principal, { ...request, tenant }),
      { result: "TenantReserved" },
      tenant,
    );
    assert.equal(refused.writes[0]?.reserved, true, tenant);
    assert.deepEqual(refused.grants, [], tenant);
  }
  const open = creationWith(created);
  await open.service.create(principal, request);
  assert.equal(open.writes[0]?.reserved, false);
});

test("a caller nothing names the tenant to makes it and administers what it made", async () => {
  const { writes, grants, recorded, service } = creationWith(created);
  assert.deepEqual(await service.create(principal, request), {
    result: "Created",
    partition,
  });
  assert.deepEqual(writes, [
    {
      partition,
      standing: "Unclaimed",
      reserved: false,
      operation: request.operation,
      authority: memberAuthority(principal),
    },
  ]);
  assert.deepEqual(grants, [
    tenantAdministratorGrant(principal, partition.tenant),
    projectTenantGrant(partition),
  ]);
  assert.deepEqual(recorded, [request.operation]);
});

test("a site that names its selector makes it a developer of the project, beside the creator's grants", async () => {
  const selector = asPrincipal("issuer selector");
  const { grants, service } = creationWith(created, { selector });
  assert.equal((await service.create(principal, request)).result, "Created");
  assert.deepEqual(grants, [
    tenantAdministratorGrant(principal, partition.tenant),
    projectTenantGrant(partition),
    projectRelationGrant(selector, partition, "developers"),
  ]);
});

test("a grant the authority does not take leaves the creation unrecorded", async () => {
  const { recorded, service } = creationWith(created, { grantFails: true });
  await assert.rejects(
    service.create(principal, request),
    ProjectAccessUnavailable,
  );
  assert.deepEqual(recorded, []);
});

test("a tenant's administrator is granted nothing on it again", async () => {
  const { access, grants, service } = creationWith({
    ...created,
    tenantCreated: false,
  });
  access.grantTenant({
    tenant: partition.tenant,
    principal,
    access: new Set(["AdministerTenant"]),
  });
  assert.deepEqual(await service.create(principal, request), {
    result: "Created",
    partition,
  });
  assert.deepEqual(grants, [projectTenantGrant(partition)]);
});

test("a repeat before the grants are recorded writes them and records the operation that made the project", async () => {
  for (const tenantCreated of [true, false]) {
    const { grants, recorded, service } = creationWith({
      outcome: "AlreadyCreated",
      tenantCreated,
      grantsWritten: false,
      operation: earlier,
    });
    assert.deepEqual(await service.create(principal, request), {
      result: "AlreadyCreated",
      partition,
    });
    assert.deepEqual(
      grants,
      tenantCreated
        ? [
            tenantAdministratorGrant(principal, partition.tenant),
            projectTenantGrant(partition),
          ]
        : [projectTenantGrant(partition)],
    );
    assert.deepEqual(recorded, [earlier]);
  }
});

test("a repeat after the grants are recorded writes nothing", async () => {
  for (const tenantCreated of [true, false]) {
    const { grants, recorded, service } = creationWith({
      outcome: "AlreadyCreated",
      tenantCreated,
      grantsWritten: true,
      operation: earlier,
    });
    assert.deepEqual(await service.create(principal, request), {
      result: "AlreadyCreated",
      partition,
    });
    assert.deepEqual(grants, []);
    assert.deepEqual(recorded, []);
  }
});

test("a refusal from the door grants nothing", async () => {
  for (const outcome of [
    "ProjectExists",
    "TenantTaken",
    "TenantReserved",
    "OperationConflict",
  ] as const satisfies readonly ProjectCreationOutcome[]) {
    const { grants, recorded, service } = creationWith({
      ...created,
      outcome,
      tenantCreated: false,
    });
    assert.deepEqual(await service.create(principal, request), {
      result: outcome,
    });
    assert.deepEqual(grants, [], outcome);
    assert.deepEqual(recorded, [], outcome);
  }
});

test("a deployment with no grant writer creates nothing", async () => {
  const writes: ProjectCreationWrite[] = [];
  const service = projectCreation({
    access: memoryProjectAccess(),
    claims: { claimed: () => Promise.resolve(false) },
    store: {
      create: (write) => {
        writes.push(write);
        return Promise.resolve(created);
      },
      recordGrants: () => Promise.reject(new Error("nothing to record")),
    },
  });
  assert.deepEqual(await service.create(principal, request), {
    result: "NotConfigured",
  });
  assert.deepEqual(writes, []);
});

test("an authority that cannot answer either question creates nothing", async () => {
  const unasked = creationWith(created);
  unasked.access.breaks();
  const unlisted = creationWith(created);
  unlisted.claims.broken = true;
  for (const { writes, service } of [unasked, unlisted]) {
    await assert.rejects(
      service.create(principal, request),
      ProjectAccessUnavailable,
    );
    assert.deepEqual(writes, []);
  }
});
