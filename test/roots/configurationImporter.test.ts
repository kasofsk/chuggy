/**
 * What the importer refuses before it opens a database. A run over every
 * binding names no repository and no commit at all, so what is left to refuse
 * is a configuration that could read nothing and a field this root does not
 * know.
 */

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
    forge: { appId: "1", keyFile: "/keys/portal.pem" },
    ...overrides,
  };
}

test("the importer refuses a run that could read no repository at all", async () => {
  const ran = await run(configuration({ forge: undefined }));
  assert.equal(ran.code, 1);
  assert.match(
    ran.stderr,
    /CHUG_CONFIGURATION_IMPORT_CONFIG.forge or CHUG_CONFIGURATION_IMPORT_CONFIG.git.credentialSources is required/u,
  );
  assert.equal(ran.stderr.includes("postgres"), false);
});

test("the importer refuses a run still naming one repository at one commit", async () => {
  const ran = await run(
    configuration({ repository: "chuggy", commit: "a".repeat(40) }),
  );
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /CHUG_CONFIGURATION_IMPORT_CONFIG/u);
  assert.equal(ran.stderr.includes("postgres"), false);
});

test("a run mounting a credential file needs no app key", async () => {
  const ran = await run(
    configuration({
      forge: undefined,
      git: {
        scratchDirectory: "/scratch",
        credentialSources: [
          { repository: "https://example.invalid/one.git", path: "/c/one" },
        ],
      },
    }),
  );
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr.includes("CHUG_CONFIGURATION_IMPORT_CONFIG"),
    false,
    "the configuration stood and the run reached its database",
  );
});
