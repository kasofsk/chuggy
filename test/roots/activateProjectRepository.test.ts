import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);

async function evaluated(program: string): Promise<string> {
  return (
    await execute(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", program],
      { cwd: process.cwd() },
    )
  ).stdout;
}

const environment = {
  CHUG_ACTIVATE_REPOSITORY_TENANT: "tenant",
  CHUG_ACTIVATE_REPOSITORY_PROJECT: "project",
  CHUG_ACTIVATE_REPOSITORY_EXPECTED_REPOSITORY: "old",
  CHUG_ACTIVATE_REPOSITORY_REPOSITORY: "new",
  CHUG_ACTIVATE_REPOSITORY_RECOVERY_EPOCH: "epoch",
  CHUG_ACTIVATE_REPOSITORY_OPERATION: "operation",
  CHUG_ACTIVATE_REPOSITORY_AUTHORITY_KIND: "Administrator",
  CHUG_ACTIVATE_REPOSITORY_AUTHORITY_SUBJECT: "operator",
};

test("the command requires every fenced and audited input", async () => {
  const found = JSON.parse(
    await evaluated(`
      const { activateRepositoryRequestOf } = await import('./src/roots/activateProjectRepository.ts');
      const environment = ${JSON.stringify(environment)};
      const results = Object.keys(environment).map((key) => {
        const absent = { ...environment }; delete absent[key];
        try { activateRepositoryRequestOf(absent); return null; }
        catch (failure) { return failure.message; }
      });
      process.stdout.write(JSON.stringify(results));
    `),
  ) as readonly string[];
  for (const message of found) assert.match(message, / is required$/u);
});

test("the command verifies owner authority and reports the complete activation", async () => {
  const found = JSON.parse(
    await evaluated(`
      const { activateRepositoryRun } = await import('./src/roots/activateProjectRepository.ts');
      const environment = ${JSON.stringify(environment)};
      const denied = await activateRepositoryRun({ environment, administration: {
        writer: async () => ({ role: 'runtime', canExecute: false }),
        activate: async () => 'Activated',
      }}).catch((failure) => failure.message);
      const report = await activateRepositoryRun({ environment, administration: {
        writer: async () => ({ role: 'owner', canExecute: true }),
        activate: async () => 'Activated',
      }});
      const fenced = await activateRepositoryRun({ environment, administration: {
        writer: async () => ({ role: 'owner', canExecute: true }),
        activate: async () => 'ExpectedRepositoryMismatch',
      }}).catch((failure) => failure.message);
      process.stdout.write(JSON.stringify({ denied, report, fenced }));
    `),
  ) as { denied: string; report: string; fenced: string };
  assert.match(
    found.denied,
    /runtime cannot execute activate_project_repository/u,
  );
  assert.equal(
    found.report,
    "Activated: tenant/project active repository new; expected old; recovery epoch epoch; operation operation; authority Administrator/operator",
  );
  assert.match(
    found.fenced,
    /^ExpectedRepositoryMismatch: activation refused;/u,
  );
});
