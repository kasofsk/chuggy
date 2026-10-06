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
 * CONFIGURATIONS AND ACTIONS ARE IMPORTED AT ONE HEAD AND REPORTED APART. Each
 * is attempted for itself and written on its own line, so what one is refused
 * for leaves the other imported.
 *
 * A SKIP IS NOT A FAILURE AND A FAILURE IS NOT THE RUN'S END. A repository
 * holding no commit, or no configuration directory at its head, is passed over
 * — seeding one belongs to the bind and to the configuration route — and a
 * head holding no action directory declares none, which is imported as that.
 * Everything else is reported on its own line, every other binding is still
 * attempted, and the run exits non-zero if any failed.
 *
 * A RUN THAT FILLED ITS BOUND DID NOT IMPORT THE ESTATE, and leaves non-zero
 * saying so. The listing is ordered by age, so a deployment holding more
 * bindings than one run may read imports the same prefix for ever, and a clean
 * exit would be the only thing telling anyone otherwise.
 */

import { gitRepositoryConfiguration } from "../adapters/git/gitRepositoryConfiguration.ts";
import { postgresAuthoring } from "../adapters/postgres/authoring.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresRepositoryActions } from "../adapters/postgres/repositoryAction.ts";
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
  boundRepositoryImportRefusal,
  boundRepositoryImportReport,
  importBoundRepositories,
  repositoryBindingsPerImportMax,
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

function configurationImporterPorts(
  config: ReturnType<typeof configurationImporterConfig>,
  pool: ReturnType<typeof postgresPool>,
): Parameters<typeof importBoundRepositories>[0]["ports"] {
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
    actionSnapshots: snapshots,
    actionStore: postgresRepositoryActions(pool),
  };
}

async function main(): Promise<void> {
  const config = configurationImporterConfig(process.env);
  const pool = postgresPool(config.database.url, config.database.limits);
  try {
    if (!(await importerDatabaseReady(pool)))
      throw new Error(
        `database must connect as ${configurationImporterLoginRole} with a current schema`,
      );
    const run = await importBoundRepositories({
      authority,
      ports: configurationImporterPorts(config, pool),
      bindingsMax: repositoryBindingsPerImportMax,
    });
    for (const bound of run.imports)
      for (const { line, failed } of boundRepositoryImportReport(bound))
        (failed ? process.stderr : process.stdout).write(`${line}\n`);
    const refused = boundRepositoryImportRefusal(
      run,
      repositoryBindingsPerImportMax,
    );
    if (refused !== undefined) throw new Error(refused);
  } finally {
    await pool.end();
  }
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown failure";
  process.stderr.write(`configuration import: ${message}\n`);
  process.exitCode = 1;
});
