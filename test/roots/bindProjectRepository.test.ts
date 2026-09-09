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
  CHUG_BIND_REPOSITORY_TENANT: "tenant",
  CHUG_BIND_REPOSITORY_PROJECT: "project",
  CHUG_BIND_REPOSITORY_REPOSITORY: "new",
  CHUG_BIND_REPOSITORY_RECOVERY_EPOCH: "epoch",
  CHUG_BIND_REPOSITORY_OPERATION: "operation",
  CHUG_BIND_REPOSITORY_AUTHORITY_KIND: "Administrator",
  CHUG_BIND_REPOSITORY_AUTHORITY_SUBJECT: "operator",
};

test("the command requires every fenced and audited input", async () => {
  const found = JSON.parse(
    await evaluated(`
      const { bindRepositoryRequestOf } = await import('./src/roots/bindProjectRepository.ts');
      const environment = ${JSON.stringify(environment)};
      const results = Object.keys(environment).map((key) => {
        const absent = { ...environment }; delete absent[key];
        try { bindRepositoryRequestOf(absent); return null; }
        catch (failure) { return failure.message; }
      });
      process.stdout.write(JSON.stringify(results));
    `),
  ) as readonly string[];
  for (const message of found) assert.match(message, / is required$/u);
});

test("the command verifies owner authority and reports the complete binding", async () => {
  const found = JSON.parse(
    await evaluated(`
      const { bindRepositoryRun } = await import('./src/roots/bindProjectRepository.ts');
      const environment = ${JSON.stringify(environment)};
      const denied = await bindRepositoryRun({ environment, administration: {
        writer: async () => ({ role: 'runtime', canExecute: false }),
        bind: async () => 'Bound',
      }}).catch((failure) => failure.message);
      const report = await bindRepositoryRun({ environment, administration: {
        writer: async () => ({ role: 'owner', canExecute: true }),
        bind: async () => 'Bound',
      }});
      const fenced = await bindRepositoryRun({ environment, administration: {
        writer: async () => ({ role: 'owner', canExecute: true }),
        bind: async () => 'RepositoryBoundElsewhere',
      }}).catch((failure) => failure.message);
      process.stdout.write(JSON.stringify({ denied, report, fenced }));
    `),
  ) as { denied: string; report: string; fenced: string };
  assert.match(found.denied, /runtime cannot execute bind_project_repository/u);
  assert.equal(
    found.report,
    "Bound: tenant/project bound repository new; recovery epoch epoch; operation operation; authority Administrator/operator",
  );
  assert.match(found.fenced, /^RepositoryBoundElsewhere: binding refused;/u);
});
