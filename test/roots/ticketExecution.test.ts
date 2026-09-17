import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("ticket execution chooses separate read and publication credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticket-credentials-"));
  try {
    const read = join(directory, "read");
    const write = join(directory, "write");
    await Promise.all([
      writeFile(read, "read-credential"),
      writeFile(write, "write-credential"),
    ]);
    const repository = "https://forge.invalid/owner/repository";
    const settings = {
      credentialSources: [
        { repository, permissions: "read", path: read },
        { repository, permissions: "write", path: write },
      ],
    };
    const source = `
      const { ticketExecutionCredentials } = await import('./src/roots/ticketExecution.ts');
      const settings = ${JSON.stringify(settings)};
      const binding = { partition: { tenant: 'tenant', project: 'project' }, repository: ${JSON.stringify(repository)}, recoveryEpoch: 'epoch' };
      const credentials = ticketExecutionCredentials(undefined, settings);
      const readOnly = ticketExecutionCredentials(undefined, { credentialSources: settings.credentialSources.slice(0, 1) });
      process.stdout.write(JSON.stringify([
        await credentials.credential(binding, 'ReadRepository'),
        await credentials.credential(binding, 'PublishRepositoryResult'),
        await readOnly.credential(binding, 'PublishRepositoryResult'),
      ]));
    `;
    const result = await execute(process.execPath, [
      "--input-type=module",
      "--eval",
      source,
    ]);
    assert.deepEqual(JSON.parse(result.stdout), [
      { resolved: "Credential", credential: "read-credential" },
      { resolved: "Credential", credential: "write-credential" },
      { resolved: "Denied" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ticket execution mints through the worker app installation", async () => {
  const source = `
    const { ticketExecutionCredentials } = await import('./src/roots/ticketExecution.ts');
    const queries = [];
    const pool = { query: async (query) => { queries.push(query.values); return { rows: [] }; } };
    const credentials = ticketExecutionCredentials(pool, { credentialSources: [], forge: { appId: '123', keyFile: '/unused/key.pem' } });
    const binding = { partition: { tenant: 'tenant', project: 'project' }, repository: 'https://github.com/owner/repository', recoveryEpoch: 'epoch' };
    const result = await credentials.credential(binding, 'PublishRepositoryResult');
    process.stdout.write(JSON.stringify({ result, queries }));
  `;
  const result = await execute(process.execPath, [
    "--input-type=module",
    "--eval",
    source,
  ]);
  assert.deepEqual(JSON.parse(result.stdout), {
    result: { resolved: "Denied" },
    queries: [["github", "worker", "owner", "tenant"]],
  });
});
