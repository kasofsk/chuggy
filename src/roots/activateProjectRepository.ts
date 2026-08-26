/** Owner-role command that appends the repository binding future work discovers. */

import { pathToFileURL } from "node:url";

import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresRepositoryActivation } from "../adapters/postgres/repositoryActivation.ts";
import {
  checkedRepositoryActivation,
  type RepositoryActivationAdministration,
  type RepositoryActivationRequest,
} from "../interpreter/repositoryActivation.ts";

export type ActivateRepositoryEnvironment = Readonly<
  Record<string, string | undefined>
>;

const variables = {
  databaseUrl: "CHUG_ACTIVATE_REPOSITORY_DATABASE_URL",
  tenant: "CHUG_ACTIVATE_REPOSITORY_TENANT",
  project: "CHUG_ACTIVATE_REPOSITORY_PROJECT",
  expectedRepository: "CHUG_ACTIVATE_REPOSITORY_EXPECTED_REPOSITORY",
  repository: "CHUG_ACTIVATE_REPOSITORY_REPOSITORY",
  recoveryEpoch: "CHUG_ACTIVATE_REPOSITORY_RECOVERY_EPOCH",
  operation: "CHUG_ACTIVATE_REPOSITORY_OPERATION",
  authorityKind: "CHUG_ACTIVATE_REPOSITORY_AUTHORITY_KIND",
  authoritySubject: "CHUG_ACTIVATE_REPOSITORY_AUTHORITY_SUBJECT",
} as const;

function required(environment: ActivateRepositoryEnvironment, name: string) {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

export function activateRepositoryRequestOf(
  environment: ActivateRepositoryEnvironment,
): RepositoryActivationRequest {
  return {
    tenant: required(environment, variables.tenant),
    project: required(environment, variables.project),
    expectedRepository: required(environment, variables.expectedRepository),
    repository: required(environment, variables.repository),
    recoveryEpoch: required(environment, variables.recoveryEpoch),
    operation: required(environment, variables.operation),
    authorityKind: required(environment, variables.authorityKind),
    authoritySubject: required(environment, variables.authoritySubject),
  };
}

export async function activateRepositoryRun(input: {
  readonly environment: ActivateRepositoryEnvironment;
  readonly administration: RepositoryActivationAdministration;
}): Promise<string> {
  const activation = checkedRepositoryActivation(
    activateRepositoryRequestOf(input.environment),
  );
  const writer = await input.administration.writer();
  if (!writer.canExecute)
    throw new Error(
      `${writer.role} cannot execute activate_project_repository; ${variables.databaseUrl} must name its owning identity`,
    );
  const outcome = await input.administration.activate(activation);
  const verification = `${activation.partition.tenant}/${activation.partition.project} active repository ${activation.repository}; expected ${activation.expectedRepository}; recovery epoch ${activation.recoveryEpoch}; operation ${activation.operation}; authority ${activation.authority.kind}/${activation.authority.subject}`;
  if (outcome !== "Activated" && outcome !== "AlreadyActivated")
    throw new Error(`${outcome}: activation refused; ${verification}`);
  return `${outcome}: ${verification}`;
}

async function main(environment: ActivateRepositoryEnvironment): Promise<void> {
  const pool = postgresPool(required(environment, variables.databaseUrl));
  try {
    process.stdout.write(
      `${await activateRepositoryRun({ environment, administration: postgresRepositoryActivation(pool) })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  await main(process.env).catch((failure: unknown) => {
    const message =
      failure instanceof Error ? failure.message : "unknown activation failure";
    process.stderr.write(`activate project repository: ${message}\n`);
    process.exitCode = 1;
  });
