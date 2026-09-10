/**
 * The administrative command that grants and revokes project access.
 *
 * IT WRITES A RELATION TUPLE, NOT A ROW. Access is the authority's to hold, so
 * this command connects to the authority's write side and to nothing else; the
 * database it used to write is not involved and no identity in it is.
 *
 * THE ISSUER VARIABLE IS THE SERVER'S OWN. An administrator provisions against
 * the issuer the API validates rather than a second copy of it, and the
 * principal is then derived by the function the API derives its own with.
 *
 * THERE IS NO PROJECT PRECONDITION. A tuple names an object rather than
 * referencing a row, so a grant written before its project exists is one that
 * starts answering when the project does — which is what lets an operator
 * write every member's access before the release that reads it.
 */

import { ketoProjectGrants } from "../adapters/keto/projectGrants.ts";
import { projectAccessTenantNamespace } from "../interpreter/projectAccess.ts";
import {
  checkedProjectGrantSettings,
  projectPrincipalGrant,
  projectTenantGrant,
  projectTenantRelation,
  tenantPrincipalGrant,
  type ProjectGrant,
} from "../interpreter/projectGrant.ts";

const writeUrlVariable = "CHUG_PROVISION_KETO_WRITE_URL";
const actionVariable = "CHUG_PROVISION_ACTION";
const issuerVariable = "CHUG_API_OIDC_ISSUER";
const subjectVariable = "CHUG_PROVISION_SUBJECT";
const tenantVariable = "CHUG_PROVISION_TENANT";
const projectVariable = "CHUG_PROVISION_PROJECT";
const relationVariable = "CHUG_PROVISION_RELATION";

const grantAction = "grant";
const revokeAction = "revoke";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function provisionAction(): "Grant" | "Revoke" {
  const value = requiredEnvironment(actionVariable);
  if (value === grantAction) return "Grant";
  if (value === revokeAction) return "Revoke";
  throw new Error(
    `${actionVariable} must be ${grantAction} or ${revokeAction}`,
  );
}

/**
 * The tuple the variables name. A project is what decides which namespace the
 * relation is looked for in, and the project's own `tenant` relation is the one
 * arm naming no person.
 */
function provisionGrant(): ProjectGrant {
  const tenant = requiredEnvironment(tenantVariable);
  const relation = requiredEnvironment(relationVariable);
  const project = optionalEnvironment(projectVariable);
  if (project === undefined)
    return tenantPrincipalGrant({
      issuer: requiredEnvironment(issuerVariable),
      subject: requiredEnvironment(subjectVariable),
      tenant,
      relation,
    });
  if (relation === projectTenantRelation)
    return projectTenantGrant({ tenant, project });
  return projectPrincipalGrant({
    issuer: requiredEnvironment(issuerVariable),
    subject: requiredEnvironment(subjectVariable),
    tenant,
    project,
    relation,
  });
}

/** What one tuple is reported as, naming the holder the authority will answer for. */
function provisionGrantText(grant: ProjectGrant): string {
  const holder =
    grant.holder.subject === "Principal"
      ? grant.holder.principal
      : `${projectAccessTenantNamespace}:${grant.holder.tenantObject}`;
  return `${grant.namespace}:${grant.object}#${grant.relation} for ${holder}`;
}

async function main(): Promise<void> {
  const action = provisionAction();
  const grant = provisionGrant();
  const grants = ketoProjectGrants(
    checkedProjectGrantSettings({
      writeUrl: requiredEnvironment(writeUrlVariable),
    }),
  );
  if (action === "Grant") {
    await grants.write(grant);
    process.stdout.write(`granted ${provisionGrantText(grant)}\n`);
    return;
  }
  await grants.remove(grant);
  process.stdout.write(`revoked ${provisionGrantText(grant)}\n`);
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown provisioning failure";
  process.stderr.write(`provision project access: ${message}\n`);
  process.exitCode = 1;
});
