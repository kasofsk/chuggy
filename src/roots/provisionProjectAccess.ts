/**
 * The administrative command that grants and revokes a project membership.
 *
 * IT IS NOT THE API'S IDENTITY THAT RUNS THIS. `chuggy_api` is refused every
 * privilege on `project_membership` and that is deliberate, so this connects
 * as the identity that owns the table — `chuggy_owner` in the rig, the same
 * one that migrates. The precondition is checked as a privilege rather than as
 * a role name, because a deployment answering it with some other identity is
 * answering it correctly.
 *
 * THE ISSUER VARIABLE IS THE SERVER'S OWN. An administrator provisions against
 * the issuer the API validates rather than a second copy of it, and the
 * principal is then derived by the function the API derives its own with.
 */

import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresProjectMembership } from "../adapters/postgres/projectMembership.ts";
import { postgresProjectStore } from "../adapters/postgres/projectStore.ts";
import {
  checkedProjectMembership,
  checkedProjectMembershipTarget,
  type ProjectMembershipTarget,
  type ProjectMembershipTargetRequest,
} from "../interpreter/projectMembership.ts";

const databaseUrlVariable = "CHUG_PROVISION_DATABASE_URL";
const actionVariable = "CHUG_PROVISION_ACTION";
const issuerVariable = "CHUG_API_OIDC_ISSUER";
const subjectVariable = "CHUG_PROVISION_SUBJECT";
const tenantVariable = "CHUG_PROVISION_TENANT";
const projectVariable = "CHUG_PROVISION_PROJECT";
const accessVariable = "CHUG_PROVISION_ACCESS";
const authorityKindVariable = "CHUG_PROVISION_AUTHORITY_KIND";
const authoritySubjectVariable = "CHUG_PROVISION_AUTHORITY_SUBJECT";

const grantAction = "grant";
const revokeAction = "revoke";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function provisionAction(): typeof grantAction | typeof revokeAction {
  const value = requiredEnvironment(actionVariable);
  if (value !== grantAction && value !== revokeAction)
    throw new Error(
      `${actionVariable} must be ${grantAction} or ${revokeAction}`,
    );
  return value;
}

/** What both actions name, and all a revocation reads. */
function provisionTargetRequest(): ProjectMembershipTargetRequest {
  return {
    issuer: requiredEnvironment(issuerVariable),
    subject: requiredEnvironment(subjectVariable),
    tenant: requiredEnvironment(tenantVariable),
    project: requiredEnvironment(projectVariable),
  };
}

/**
 * The two things this command cannot do without: the privileges the membership
 * table refuses the runtime role, and a project for the row to belong to.
 */
async function provisionPreconditions(
  pool: ReturnType<typeof postgresPool>,
  target: ProjectMembershipTarget,
): Promise<void> {
  const found = await pool.query<{
    current_role: string;
    may_write: boolean | null;
  }>(
    `SELECT current_user AS current_role,
       has_table_privilege(current_user,'project_membership','INSERT,UPDATE,DELETE')
         AS may_write`,
  );
  const row = found.rows[0];
  if (row?.may_write !== true) {
    throw new Error(
      `${String(row?.current_role)} may not write project_membership; ${databaseUrlVariable} must name the identity that owns it`,
    );
  }
  if (
    (await postgresProjectStore(pool).standing(target.partition)) === undefined
  )
    throw new Error(
      `no project ${target.partition.tenant}/${target.partition.project} exists for a membership to belong to`,
    );
}

async function main(): Promise<void> {
  const action = provisionAction();
  const targetRequest = provisionTargetRequest();
  const membership =
    action === grantAction
      ? checkedProjectMembership({
          ...targetRequest,
          authorityKind: requiredEnvironment(authorityKindVariable),
          authoritySubject: requiredEnvironment(authoritySubjectVariable),
          access: requiredEnvironment(accessVariable).split(","),
        })
      : undefined;
  const target = membership ?? checkedProjectMembershipTarget(targetRequest);
  const pool = postgresPool(requiredEnvironment(databaseUrlVariable));
  try {
    await provisionPreconditions(pool, target);
    const administration = postgresProjectMembership(pool);
    if (membership !== undefined) {
      await administration.grant(membership);
      process.stdout.write(
        `granted ${[...membership.access].sort().join(",")} to ${membership.principal}\n`,
      );
      return;
    }
    const revoked = await administration.revoke(target);
    process.stdout.write(
      revoked
        ? `revoked every access from ${target.principal}\n`
        : `${target.principal} held no membership to revoke\n`,
    );
  } finally {
    await pool.end();
  }
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown provisioning failure";
  process.stderr.write(`provision project access: ${message}\n`);
  process.exitCode = 1;
});
