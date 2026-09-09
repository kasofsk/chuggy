/** Owner-role command that binds a repository to a project and elects nothing. */

import { pathToFileURL } from "node:url";

import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresRepositoryBinding } from "../adapters/postgres/repositoryBinding.ts";
import {
  checkedRepositoryBindingCommand,
  type RepositoryBindingAdministration,
  type RepositoryBindingRequest,
} from "../interpreter/repositoryBinding.ts";

export type BindRepositoryEnvironment = Readonly<
  Record<string, string | undefined>
>;

const variables = {
  databaseUrl: "CHUG_BIND_REPOSITORY_DATABASE_URL",
  tenant: "CHUG_BIND_REPOSITORY_TENANT",
  project: "CHUG_BIND_REPOSITORY_PROJECT",
  repository: "CHUG_BIND_REPOSITORY_REPOSITORY",
  recoveryEpoch: "CHUG_BIND_REPOSITORY_RECOVERY_EPOCH",
  operation: "CHUG_BIND_REPOSITORY_OPERATION",
  authorityKind: "CHUG_BIND_REPOSITORY_AUTHORITY_KIND",
  authoritySubject: "CHUG_BIND_REPOSITORY_AUTHORITY_SUBJECT",
} as const;

function required(environment: BindRepositoryEnvironment, name: string) {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

export function bindRepositoryRequestOf(
  environment: BindRepositoryEnvironment,
): RepositoryBindingRequest {
  return {
    tenant: required(environment, variables.tenant),
    project: required(environment, variables.project),
    repository: required(environment, variables.repository),
    recoveryEpoch: required(environment, variables.recoveryEpoch),
    operation: required(environment, variables.operation),
    authorityKind: required(environment, variables.authorityKind),
    authoritySubject: required(environment, variables.authoritySubject),
  };
}

export async function bindRepositoryRun(input: {
  readonly environment: BindRepositoryEnvironment;
  readonly administration: RepositoryBindingAdministration;
}): Promise<string> {
  const command = checkedRepositoryBindingCommand(
    bindRepositoryRequestOf(input.environment),
  );
  const writer = await input.administration.writer();
  if (!writer.canExecute)
    throw new Error(
      `${writer.role} cannot execute bind_project_repository; ${variables.databaseUrl} must name its owning identity`,
    );
  const outcome = await input.administration.bind(command);
  const verification = `${command.partition.tenant}/${command.partition.project} bound repository ${command.repository}; recovery epoch ${command.recoveryEpoch}; operation ${command.operation}; authority ${command.authority.kind}/${command.authority.subject}`;
  if (outcome !== "Bound" && outcome !== "AlreadyBound")
    throw new Error(`${outcome}: binding refused; ${verification}`);
  return `${outcome}: ${verification}`;
}

async function main(environment: BindRepositoryEnvironment): Promise<void> {
  const pool = postgresPool(required(environment, variables.databaseUrl));
  try {
    process.stdout.write(
      `${await bindRepositoryRun({ environment, administration: postgresRepositoryBinding(pool) })}\n`,
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
      failure instanceof Error ? failure.message : "unknown binding failure";
    process.stderr.write(`bind project repository: ${message}\n`);
    process.exitCode = 1;
  });
