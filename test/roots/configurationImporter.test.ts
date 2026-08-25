import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

interface Ran {
  readonly code: number | null;
  readonly stderr: string;
}

function run(configuration: unknown): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "src/roots/configurationImporter.ts"],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env["PATH"] ?? "",
          CHUG_CONFIGURATION_IMPORT_CONFIG: JSON.stringify(configuration),
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    database: { url: "postgres://importer@127.0.0.1:1/chuggy" },
    git: { scratchDirectory: "/scratch", credentialSources: [] },
    commit: "a".repeat(40),
    partitions: [{ tenant: "acme", project: "atlas" }],
    ...overrides,
  };
}

test("the importer refuses a moving ref before opening its database", async () => {
  const ran = await run(configuration({ commit: "main" }));
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /CHUG_CONFIGURATION_IMPORT_CONFIG.commit is invalid/u,
  );
  assert.equal(ran.stderr.includes("postgres"), false);
});

test("the importer requires at least one bounded partition", async () => {
  const ran = await run(configuration({ partitions: [] }));
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /CHUG_CONFIGURATION_IMPORT_CONFIG.partitions is invalid/u,
  );
});
