/**
 * The administrative command that provisions a project partition.
 *
 * IT IS THE FIRST STEP OF AN INSTALLATION AND HAD NO COMMAND. Every other
 * administrative act presupposes the `project` row: `bind_project_repository`
 * raises `repository binding project is absent` without one, a session is
 * opened against a partition, and `GET /api/v1/projects` lists rows before it
 * filters them through the authority. Nothing in the tree wrote that row —
 * `ProjectStore.createProject` was reached only from suites — so a fresh
 * installation's operator had a console that correctly reported no project and
 * no supported way to make one.
 *
 * IT IS NOT AUTHORIZATION, and the two are provisioned in either order.
 * `./provisionProjectAccess.ts` writes a relation tuple naming an object rather
 * than referencing a row, so a grant may precede the project it grants on; this
 * writes the row and consults no authority. A partition needs both before it
 * answers anyone, and neither command is the other's precondition.
 *
 * IT CONNECTS AS THE IDENTITY THAT OWNS THE BOUNDARY, the same one that
 * migrates and that `./provisionAgentSession.ts` requires, because the
 * `project` table grants INSERT to no runtime role.
 *
 * IT READS BEFORE IT WRITES, AND NOT FOR SAFETY. The write absorbs a repeat on
 * the composite key, so a partition provisioned between the read and the write
 * is reported as new and is still correct. What the read decides is the
 * refusal: a partition already past `Active` must not be reported as created,
 * because the write would answer with a standing its own ON CONFLICT declined
 * to change.
 */

import { pathToFileURL } from "node:url";

import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresProjectProvisioning } from "../adapters/postgres/projectProvisioning.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
  type ProjectProvisioning,
} from "../interpreter/projectStore.ts";

export type ProvisionProjectEnvironment = Readonly<
  Record<string, string | undefined>
>;

const variables = {
  databaseUrl: "CHUG_PROVISION_PROJECT_DATABASE_URL",
  tenant: "CHUG_PROVISION_PROJECT_TENANT",
  project: "CHUG_PROVISION_PROJECT_PROJECT",
} as const;

function required(
  environment: ProvisionProjectEnvironment,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

export function provisionProjectPartition(
  environment: ProvisionProjectEnvironment,
): Partition {
  return {
    tenant: asTenantId(required(environment, variables.tenant)),
    project: asProjectId(required(environment, variables.project)),
  };
}

/** Provisions the partition the environment names, reporting which of the two things happened. */
export async function provisionProjectRun(input: {
  readonly environment: ProvisionProjectEnvironment;
  readonly provisioning: ProjectProvisioning;
}): Promise<string> {
  const partition = provisionProjectPartition(input.environment);
  const writer = await input.provisioning.writer();
  if (!writer.canInsert)
    throw new Error(
      `${writer.role} cannot insert a project; ${variables.databaseUrl} must name the identity that owns the boundary`,
    );
  const name = `${partition.tenant}/${partition.project}`;

  const before = await input.provisioning.standing(partition);
  if (before !== undefined && before.lifecycle !== "Active")
    throw new Error(
      `${name} is already provisioned and its lifecycle is ${before.lifecycle}; provisioning does not revive a partition`,
    );

  const standing = await input.provisioning.create(partition);
  const verdict = before === undefined ? "Provisioned" : "AlreadyProvisioned";
  return `${verdict}: ${name}, lifecycle ${standing.lifecycle}`;
}

async function main(environment: ProvisionProjectEnvironment): Promise<void> {
  const pool = postgresPool(required(environment, variables.databaseUrl));
  try {
    process.stdout.write(
      `${await provisionProjectRun({
        environment,
        provisioning: postgresProjectProvisioning(pool),
      })}\n`,
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
      failure instanceof Error
        ? failure.message
        : "unknown provisioning failure";
    process.stderr.write(`provision project: ${message}\n`);
    process.exitCode = 1;
  });
