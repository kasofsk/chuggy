/**
 * One-shot import of every bound repository's declarations at its own head.
 *
 * THE RUN IS THE ESTATE AND NOT A REPOSITORY. A binding is what says a project
 * takes its declarations from a repository, so the bindings are the list, and a
 * deployment that had to name its repositories in a CronJob had a second copy
 * of that list to keep true.
 *
 * THE HEAD IS ASKED OF THE REMOTE. There is no ticket here to take a commit
 * from, so each repository is imported at whatever its own default branch
 * points at when the run reaches it.
 *
 * A SKIP IS NOT A FAILURE AND A FAILURE IS NOT THE RUN'S END. A repository
 * holding no commit, or no configuration directory at its head, is passed over
 * — seeding one belongs to the bind and happens once. Everything else is
 * reported on its own line, every other binding is still attempted, and the run
 * exits non-zero if any failed.
 *
 * A RUN THAT FILLED ITS BOUND DID NOT IMPORT THE ESTATE, and leaves non-zero
 * saying so. The listing is ordered by age, so a deployment holding more
 * bindings than one run may read imports the same prefix for ever, and a clean
 * exit would be the only thing telling anyone otherwise.
 */

import { pathToFileURL } from "node:url";

import { gitRepositoryConfiguration } from "../adapters/git/gitRepositoryConfiguration.ts";
import { postgresAuthoring } from "../adapters/postgres/authoring.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresRepositoryBindingListing } from "../adapters/postgres/repositoryBinding.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import { configurationImporterRole } from "../adapters/postgres/schema.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import {
  composeConfigurationImporterCredentials,
  composeForgeRepositoryMinting,
} from "../compose.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../interpreter/operationInbox.ts";
import {
  importBoundRepositoryConfigurations,
  repositoryBindingsPerImportMax,
  type BoundRepositoryImport,
  type BoundRepositoryImportRun,
} from "../interpreter/repositoryConfiguration.ts";
import { schemaCompatibilityPrecondition } from "../interpreter/serviceRuntime.ts";
import { finalizerGitEnvironmentNames } from "../interpreter/finalizerSettings.ts";
import { configurationImporterConfig } from "./configurationImporterConfig.ts";

const configurationImporterLoginRole = "chuggy_configuration_importer_login";
const authority = {
  kind: asAuthorityKind("Service"),
  subject: asAuthoritySubject("configuration-mirror-importer"),
};

async function importerDatabaseReady(
  pool: ReturnType<typeof postgresPool>,
): Promise<boolean> {
  const found = await pool.query<{ current_role: string; member: boolean }>(
    `SELECT current_user AS current_role,
       pg_has_role(current_user,$1,'member') AS member`,
    [configurationImporterRole],
  );
  return (
    found.rows[0]?.current_role === configurationImporterLoginRole &&
    found.rows[0]?.member === true &&
    (
      await schemaCompatibilityPrecondition(
        postgresRuntimeSchema(pool),
        currentRuntimeSchemaContract,
      ).check(new AbortController().signal)
    ).met === "Met"
  );
}

/**
 * One binding's outcome as a line. Every term is a variant of the run's own
 * types but a refused declaration's path, which `JSON.stringify` escapes.
 */
export function configurationImportLine(bound: BoundRepositoryImport): string {
  const where = `${bound.partition.tenant}/${bound.partition.project} ${bound.repository}`;
  switch (bound.result.result) {
    case "Imported":
      return `${where} imported at ${bound.result.commit}`;
    case "Skipped":
      return `${where} skipped: ${bound.result.why}`;
    case "Failed":
      return `${where} failed: ${JSON.stringify(bound.result.failure)}`;
  }
}

function configurationImporterPorts(
  config: ReturnType<typeof configurationImporterConfig>,
  pool: ReturnType<typeof postgresPool>,
): Parameters<typeof importBoundRepositoryConfigurations>[0]["ports"] {
  const environment = Object.fromEntries(
    finalizerGitEnvironmentNames
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
  const snapshots = gitRepositoryConfiguration({
    scratchDirectory: config.git.scratchDirectory,
    identity: {
      name: "Chuggy configuration importer",
      email: "configuration-importer@chuggy.invalid",
    },
    environment,
    credentials: composeConfigurationImporterCredentials(
      { sources: config.git.credentials },
      composeForgeRepositoryMinting(pool, config.forge),
    ),
    ...(config.git.credentialUsername === undefined
      ? {}
      : { credentialUsername: config.git.credentialUsername }),
    ...(config.git.localTimeoutSecsMax === undefined
      ? {}
      : { localTimeoutSecsMax: config.git.localTimeoutSecsMax }),
    ...(config.git.remoteTimeoutSecsMax === undefined
      ? {}
      : { remoteTimeoutSecsMax: config.git.remoteTimeoutSecsMax }),
  });
  return {
    listing: postgresRepositoryBindingListing(pool),
    bindings: postgresProjectRepositoryBinding(pool),
    heads: snapshots,
    snapshots,
    store: postgresAuthoring(pool),
  };
}

/**
 * Why a run may not leave zero: a binding it could not import, or a listing it
 * filled, which leaves every binding past the bound unimported.
 */
export function configurationImportRefusal(
  run: BoundRepositoryImportRun,
  bindingsMax: number,
): string | undefined {
  const failed = run.imports.filter(
    (bound) => bound.result.result === "Failed",
  ).length;
  const refusals = [
    ...(failed === 0
      ? []
      : [`${String(failed)} of ${String(run.imports.length)} bindings`]),
    ...(run.truncated
      ? [
          `the listing filled its bound of ${String(bindingsMax)} bindings and the rest of the estate is unimported`,
        ]
      : []),
  ];
  return refusals.length === 0 ? undefined : refusals.join("; ");
}

async function main(): Promise<void> {
  const config = configurationImporterConfig(process.env);
  const pool = postgresPool(config.database.url, config.database.limits);
  try {
    if (!(await importerDatabaseReady(pool)))
      throw new Error(
        `database must connect as ${configurationImporterLoginRole} with a current schema`,
      );
    const run = await importBoundRepositoryConfigurations({
      authority,
      ports: configurationImporterPorts(config, pool),
      bindingsMax: repositoryBindingsPerImportMax,
    });
    for (const bound of run.imports) {
      const line = `${configurationImportLine(bound)}\n`;
      if (bound.result.result === "Failed") process.stderr.write(line);
      else process.stdout.write(line);
    }
    const refused = configurationImportRefusal(
      run,
      repositoryBindingsPerImportMax,
    );
    if (refused !== undefined) throw new Error(refused);
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main().catch((failure: unknown) => {
    const message =
      failure instanceof Error ? failure.message : "unknown failure";
    process.stderr.write(`configuration import: ${message}\n`);
    process.exitCode = 1;
  });
