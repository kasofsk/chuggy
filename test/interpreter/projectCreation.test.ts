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
  projectTenantGrant,
  tenantAdministratorGrant,
  type ProjectGrant,
} from "../../src/interpreter/projectGrant.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
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
function creationWith(answer: ProjectCreationAnswer, grantFails = false) {
  const access = memoryProjectAccess();
  const writes: ProjectCreationWrite[] = [];
  const grants: ProjectGrant[] = [];
  const recorded: OperationId[] = [];
  const service = projectCreation({
    access,
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
        if (grantFails)
          return Promise.reject(new ProjectAccessUnavailable("keto down"));
        grants.push(grant);
        return Promise.resolve();
      },
      remove: () => Promise.reject(new Error("creation removes no grant")),
    },
  });
  return { access, writes, grants, recorded, service };
}

const created: ProjectCreationAnswer = {
  outcome: "Created",
  tenantCreated: true,
  grantsWritten: false,
};

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
  const { access, writes, grants, service } = creationWith(created);
  access.breaks();
  assert.deepEqual(
    await service.create(principal, { ...request, project: "Chuggy" }),
    { result: "NameInvalid", field: "project" },
  );
  assert.deepEqual(writes, []);
  assert.deepEqual(grants, []);
});

test("a reserved name is refused to a caller who would make the tenant, and taken by one who administers it", async () => {
  for (const tenant of reservedTenantNames) {
    const refused = creationWith(created);
    assert.deepEqual(
      await refused.service.create(principal, { ...request, tenant }),
      { result: "TenantReserved" },
      tenant,
    );
    assert.deepEqual(refused.writes, [], tenant);
    const standing = creationWith({ ...created, tenantCreated: false });
    standing.access.grantTenant({
      tenant: asTenantId(tenant),
      principal,
      access: new Set(["AdministerTenant"]),
    });
    assert.equal(
      (await standing.service.create(principal, { ...request, tenant })).result,
      "Created",
      tenant,
    );
  }
});

test("a caller the tenant does not answer to expects it new and administers what it made", async () => {
  const { writes, grants, recorded, service } = creationWith(created);
  assert.deepEqual(await service.create(principal, request), {
    result: "Created",
    partition,
  });
  assert.deepEqual(writes, [
    {
      partition,
      tenantNew: true,
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

test("a grant the authority does not take leaves the creation unrecorded", async () => {
  const { recorded, service } = creationWith(created, true);
  await assert.rejects(
    service.create(principal, request),
    ProjectAccessUnavailable,
  );
  assert.deepEqual(recorded, []);
});

test("a tenant's administrator expects it to stand and is granted nothing on it again", async () => {
  const { access, writes, grants, service } = creationWith({
    outcome: "Created",
    tenantCreated: false,
    grantsWritten: false,
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
  assert.equal(writes[0]?.tenantNew, false);
  assert.deepEqual(grants, [projectTenantGrant(partition)]);
});

test("a replay before the grants are recorded writes and records them", async () => {
  for (const tenantCreated of [true, false]) {
    const { grants, recorded, service } = creationWith({
      outcome: "AlreadyCreated",
      tenantCreated,
      grantsWritten: false,
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
    assert.deepEqual(recorded, [request.operation]);
  }
});

test("a replay after the grants are recorded writes nothing", async () => {
  for (const tenantCreated of [true, false]) {
    const { grants, recorded, service } = creationWith({
      outcome: "AlreadyCreated",
      tenantCreated,
      grantsWritten: true,
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
    "OperationConflict",
  ] as const satisfies readonly ProjectCreationOutcome[]) {
    const { grants, recorded, service } = creationWith({
      outcome,
      tenantCreated: false,
      grantsWritten: false,
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

test("an authority that cannot answer creates nothing", async () => {
  const { access, writes, service } = creationWith(created);
  access.breaks();
  await assert.rejects(
    service.create(principal, request),
    ProjectAccessUnavailable,
  );
  assert.deepEqual(writes, []);
});
