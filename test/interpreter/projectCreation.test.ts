import assert from "node:assert/strict";
import { test } from "node:test";

import { projectNameCharsMax } from "../../src/contract/requests.ts";
import { asOperationId } from "../../src/interpreter/operationInbox.ts";
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
function creationWith(answer: ProjectCreationAnswer) {
  const access = memoryProjectAccess();
  const writes: ProjectCreationWrite[] = [];
  const grants: ProjectGrant[] = [];
  const service = projectCreation({
    access,
    store: {
      create: (write) => {
        writes.push(write);
        return Promise.resolve(answer);
      },
    },
    grants: {
      write: (grant) => {
        grants.push(grant);
        return Promise.resolve();
      },
      remove: () => Promise.reject(new Error("creation removes no grant")),
    },
  });
  return { access, writes, grants, service };
}

const created: ProjectCreationAnswer = {
  outcome: "Created",
  tenantCreated: true,
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

test("a caller the tenant does not answer to expects it new and administers what it made", async () => {
  const { writes, grants, service } = creationWith(created);
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
});

test("a tenant's administrator expects it to stand and is granted nothing on it again", async () => {
  const { access, writes, grants, service } = creationWith({
    outcome: "Created",
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
  assert.equal(writes[0]?.tenantNew, false);
  assert.deepEqual(grants, [projectTenantGrant(partition)]);
});

test("a replay writes the grants the creation it repeats wrote", async () => {
  for (const tenantCreated of [true, false]) {
    const { grants, service } = creationWith({
      outcome: "AlreadyCreated",
      tenantCreated,
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
  }
});

test("a refusal from the door grants nothing", async () => {
  for (const outcome of [
    "ProjectExists",
    "TenantTaken",
    "OperationConflict",
  ] as const satisfies readonly ProjectCreationOutcome[]) {
    const { grants, service } = creationWith({
      outcome,
      tenantCreated: false,
    });
    assert.deepEqual(await service.create(principal, request), {
      result: outcome,
    });
    assert.deepEqual(grants, [], outcome);
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
