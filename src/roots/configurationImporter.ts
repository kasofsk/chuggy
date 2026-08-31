/** One-shot import of repository-declared configurations at one exact commit. */

import { credentialFiles } from "../adapters/credentials/credentialFiles.ts";
import { gitRepositoryConfiguration } from "../adapters/git/gitRepositoryConfiguration.ts";
import { postgresAuthoring } from "../adapters/postgres/authoring.ts";
import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresProjectRepositoryBinding } from "../adapters/postgres/repositoryConfiguration.ts";
import { configurationImporterRole } from "../adapters/postgres/schema.ts";
import {
  currentRuntimeSchemaContract,
  postgresRuntimeSchema,
} from "../adapters/postgres/runtimeSchema.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../interpreter/operationInbox.ts";
import { importRepositoryConfigurationPartitions } from "../interpreter/repositoryConfiguration.ts";
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

async function main(): Promise<void> {
  const config = configurationImporterConfig(process.env);
  const pool = postgresPool(config.database.url, config.database.limits);
  try {
    if (!(await importerDatabaseReady(pool)))
      throw new Error(
        `database must connect as ${configurationImporterLoginRole} with a current schema`,
      );
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
      credentials: credentialFiles({ sources: config.git.credentials }),
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
    const authoring = postgresAuthoring(pool);
    const ports = {
      bindings: postgresProjectRepositoryBinding(pool),
      snapshots,
      store: authoring,
    };
    const imports = await importRepositoryConfigurationPartitions({
      partitions: config.partitions,
      commit: config.commit,
      authority,
      ports,
    });
    const failures = imports.filter(
      ({ outcome }) => outcome.result !== "Imported",
    );
    for (const { partition, outcome } of imports)
      if (outcome.result === "Imported")
        process.stdout.write(
          `${partition.tenant}/${partition.project} imported ${config.commit}\n`,
        );
    if (failures.length > 0)
      throw new Error(
        failures
          .map(
            ({ partition, outcome }) =>
              `${partition.tenant}/${partition.project}: ${JSON.stringify(outcome)}`,
          )
          .join("; "),
      );
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
