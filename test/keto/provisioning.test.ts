/**
 * The administrative command, run as a process against a real authority. It is
 * driven as a process because what it is being asked is whether the variables
 * an operator exports reach the tuple the API then reads.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  allProjectAccessKinds,
  projectAccessObject,
} from "../../src/interpreter/projectAccess.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import {
  ketoHarnessAccess,
  ketoHarnessClaims,
  ketoHarnessIssuer,
  ketoHarnessPartition,
  ketoHarnessReadUrl,
  ketoHarnessRoleKinds,
  ketoHarnessWriteUrl,
} from "./harness.ts";

const execute = promisify(execFile);
const access = ketoHarnessAccess();

interface Provisioned {
  readonly code: number;
  readonly output: string;
}

/** The command, run with the variables a case exports and nothing else of its own. */
async function provision(
  environment: Readonly<Record<string, string>>,
): Promise<Provisioned> {
  try {
    const ran = await execute(
      process.execPath,
      ["--experimental-strip-types", "src/roots/provisionProjectAccess.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CHUG_PROVISION_KETO_WRITE_URL: ketoHarnessWriteUrl(),
          CHUG_API_OIDC_ISSUER: ketoHarnessIssuer,
          ...environment,
        },
      },
    );
    return { code: 0, output: ran.stdout };
  } catch (failure) {
    const ran = failure as { code?: number; stderr?: string };
    return { code: ran.code ?? 1, output: ran.stderr ?? "" };
  }
}

test("a granted relation is one the API's own port then answers for", async () => {
  const partition = ketoHarnessPartition("provision");
  const granted = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "provisioned",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developers",
  });
  assert.equal(granted.code, 0, granted.output);
  const principal = oidcPrincipal(ketoHarnessIssuer, "provisioned");
  assert.notEqual(
    await access.authorize(principal, partition, "Mutate"),
    undefined,
    granted.output,
  );
  const revoked = await provision({
    CHUG_PROVISION_ACTION: "revoke",
    CHUG_PROVISION_SUBJECT: "provisioned",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developers",
  });
  assert.equal(revoked.code, 0, revoked.output);
  assert.equal(
    await access.authorize(principal, partition, "Mutate"),
    undefined,
  );
});

test("a tenant grant and the project's tenant relation compose to project access", async () => {
  const partition = ketoHarnessPartition("provision-tenant");
  const onTenant = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "tenant-provisioned",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_RELATION: "admins",
  });
  assert.equal(onTenant.code, 0, onTenant.output);
  const inherited = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "tenant",
  });
  assert.equal(inherited.code, 0, inherited.output);
  const principal = oidcPrincipal(ketoHarnessIssuer, "tenant-provisioned");
  for (const kind of allProjectAccessKinds)
    assert.equal(
      (await access.authorize(principal, partition, kind)) !== undefined,
      ketoHarnessRoleKinds.includes(kind),
      kind,
    );
});

test("a person's project grant links the project to its tenant, which then holds the tenant, and a revocation leaves the link", async () => {
  const partition = ketoHarnessPartition("provision-link");
  const person = {
    CHUG_PROVISION_SUBJECT: "linked",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developers",
  };
  const claims = ketoHarnessClaims();
  assert.equal(await claims.claimed(partition.tenant), false);
  const granted = await provision({
    ...person,
    CHUG_PROVISION_ACTION: "grant",
  });
  assert.equal(granted.code, 0, granted.output);
  assert.equal(await claims.claimed(partition.tenant), true, granted.output);
  const onTenant = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "linked-admin",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_RELATION: "admins",
  });
  assert.equal(onTenant.code, 0, onTenant.output);
  const tenantAdmin = oidcPrincipal(ketoHarnessIssuer, "linked-admin");
  assert.notEqual(
    await access.authorize(tenantAdmin, partition, "ManageProjectSelector"),
    undefined,
  );
  const revoked = await provision({
    ...person,
    CHUG_PROVISION_ACTION: "revoke",
  });
  assert.equal(revoked.code, 0, revoked.output);
  assert.notEqual(
    await access.authorize(tenantAdmin, partition, "ManageProjectSelector"),
    undefined,
    revoked.output,
  );
});

test("a project nothing created is granted access anyway", async () => {
  const partition = ketoHarnessPartition("provision-absent");
  const granted = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "early",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "admins",
  });
  assert.equal(granted.code, 0, granted.output);
  assert.notEqual(
    await access.authorize(
      oidcPrincipal(ketoHarnessIssuer, "early"),
      partition,
      "ManageProjectSelector",
    ),
    undefined,
  );
});

test("a relation the model does not declare is refused before anything is written", async () => {
  const partition = ketoHarnessPartition("provision-relation");
  const refused = await provision({
    CHUG_PROVISION_ACTION: "grant",
    CHUG_PROVISION_SUBJECT: "typo",
    CHUG_PROVISION_TENANT: partition.tenant,
    CHUG_PROVISION_PROJECT: partition.project,
    CHUG_PROVISION_RELATION: "developer",
  });
  assert.equal(refused.code, 1);
  assert.match(refused.output, /is not a project relation/u);
  const listing = new URL("relation-tuples", ketoHarnessReadUrl());
  listing.searchParams.set("namespace", "Project");
  listing.searchParams.set("object", projectAccessObject(partition));
  const onProject = (await (await fetch(listing)).json()) as {
    relation_tuples: unknown[];
  };
  assert.deepEqual(onProject.relation_tuples, []);
  assert.equal(await ketoHarnessClaims().claimed(partition.tenant), false);
});
