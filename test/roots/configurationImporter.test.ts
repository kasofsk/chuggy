/**
 * What the importer refuses before it opens a database, and what it leaves
 * with once it has run. A run over every binding names no repository and no
 * commit at all, so what is left to refuse is a configuration that could read
 * nothing and a field this root does not know.
 *
 * A RUN THAT FILLED ITS BOUND IS NOT A RUN THAT IMPORTED THE ESTATE. The bound
 * is a prefix of a listing ordered by age, so a clean exit from one would be
 * the only thing telling anyone the newest bindings were never reached.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import {
  configurationImportLine,
  configurationImportRefusal,
} from "../../src/roots/configurationImporter.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type {
  BoundRepositoryImport,
  BoundRepositoryImportResult,
} from "../../src/interpreter/repositoryConfiguration.ts";

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

/** One binding's outcome, which is what a run reports and leaves on. */
function bound(result: BoundRepositoryImportResult): BoundRepositoryImport {
  return {
    partition: { tenant: asTenantId("acme"), project: asProjectId("atlas") },
    repository: asRepositoryId("https://github.com/acme/atlas.git"),
    result,
  };
}

const imported = bound({
  result: "Imported",
  commit: asGitObjectId("a".repeat(40)),
  declarations: 1,
});

test("a run that filled its listing's bound leaves non-zero naming the bound", () => {
  assert.equal(
    configurationImportRefusal({ imports: [imported], truncated: false }, 1000),
    undefined,
    "a listing that came back short of the bound read the whole estate",
  );
  assert.match(
    String(
      configurationImportRefusal(
        { imports: [imported], truncated: true },
        1000,
      ),
    ),
    /filled its bound of 1000 bindings/u,
  );
});

test("a binding that failed leaves non-zero beside a bound that filled", () => {
  const failed = bound({ result: "Failed", failure: { failure: "Raised" } });
  assert.equal(
    configurationImportRefusal(
      { imports: [failed, imported], truncated: false },
      1000,
    ),
    "1 of 2 bindings",
  );
  assert.match(
    String(
      configurationImportRefusal({ imports: [failed], truncated: true }, 1000),
    ),
    /^1 of 1 bindings; the listing filled/u,
  );
});

test("a refused declaration's path reaches its line escaped and not raw", () => {
  const line = configurationImportLine(
    bound({
      result: "Failed",
      failure: {
        failure: "Import",
        outcome: {
          result: "DeclarationsRefused",
          faults: [
            {
              path: ".chuggy/configurations/one\nfailed: acme/atlas",
              fault: "PathInvalid",
            },
          ],
        },
      },
    }),
  );
  assert.equal(line.includes("\n"), false);
  assert.match(line, /one\\nfailed/u);
});
