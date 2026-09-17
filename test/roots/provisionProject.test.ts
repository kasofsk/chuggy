import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluatedModule as evaluated } from "./harness.ts";

const environment = {
  CHUG_PROVISION_PROJECT_TENANT: "tenant",
  CHUG_PROVISION_PROJECT_PROJECT: "project",
};

const active = { lifecycle: "Active" };

test("the command requires the partition it provisions", async () => {
  const found = JSON.parse(
    await evaluated(`
      const { provisionProjectPartition } = await import('./src/roots/provisionProject.ts');
      const environment = ${JSON.stringify(environment)};
      const results = Object.keys(environment).map((key) => {
        const absent = { ...environment }; delete absent[key];
        try { provisionProjectPartition(absent); return null; }
        catch (failure) { return failure.message; }
      });
      process.stdout.write(JSON.stringify(results));
    `),
  ) as readonly string[];
  for (const message of found) assert.match(message, / is required$/u);
});

test("the command refuses an identity that cannot insert, naming the variable", async () => {
  const found = await evaluated(`
    const { provisionProjectRun } = await import('./src/roots/provisionProject.ts');
    const denied = await provisionProjectRun({
      environment: ${JSON.stringify(environment)},
      provisioning: {
        writer: async () => ({ role: 'chuggy_api', canInsert: false }),
        standing: async () => { throw new Error('not reached'); },
        create: async () => { throw new Error('not reached'); },
      },
    }).catch((failure) => failure.message);
    process.stdout.write(denied);
  `);
  assert.match(found, /^chuggy_api cannot insert a project;/u);
  assert.match(found, /CHUG_PROVISION_PROJECT_DATABASE_URL/u);
});

test("an absent partition is provisioned and a live one is reported as already there", async () => {
  const found = JSON.parse(
    await evaluated(`
      const { provisionProjectRun } = await import('./src/roots/provisionProject.ts');
      const environment = ${JSON.stringify(environment)};
      const writer = async () => ({ role: 'chuggy_boundary_owner', canInsert: true });
      const created = await provisionProjectRun({ environment, provisioning: {
        writer, standing: async () => undefined, create: async () => (${JSON.stringify(active)}),
      }});
      const repeated = await provisionProjectRun({ environment, provisioning: {
        writer, standing: async () => (${JSON.stringify(active)}), create: async () => (${JSON.stringify(active)}),
      }});
      process.stdout.write(JSON.stringify({ created, repeated }));
    `),
  ) as { created: string; repeated: string };
  assert.equal(found.created, "Provisioned: tenant/project, lifecycle Active");
  assert.equal(
    found.repeated,
    "AlreadyProvisioned: tenant/project, lifecycle Active",
  );
});

test("a partition past Active is refused rather than reported as created", async () => {
  const found = await evaluated(`
    const { provisionProjectRun } = await import('./src/roots/provisionProject.ts');
    const refused = await provisionProjectRun({
      environment: ${JSON.stringify(environment)},
      provisioning: {
        writer: async () => ({ role: 'chuggy_boundary_owner', canInsert: true }),
        standing: async () => ({ lifecycle: 'Retention' }),
        create: async () => { throw new Error('not reached'); },
      },
    }).catch((failure) => failure.message);
    process.stdout.write(refused);
  `);
  assert.match(found, /^tenant\/project is already provisioned/u);
  assert.match(found, /lifecycle is Retention/u);
});
