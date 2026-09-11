/**
 * The administrative command that records which tenant claimed a forge app on
 * an account.
 *
 * IT CONNECTS AS THE BOUNDARY OWNER. The claim door is the owner's alone in
 * this slice, so an operator runs this against the owner's URL; no route holds
 * `EXECUTE` on it, which is what keeps an account from being claimed by
 * anything but a deliberate act.
 *
 * THE ISSUER VARIABLE IS THE SERVER'S OWN, for the reason
 * `provisionProjectAccess.ts` names: the audited authority is derived by the
 * function the API derives its own with, from the issuer the API validates.
 *
 * IT IS REPLAYABLE AND IT NEVER TAKES AN ACCOUNT AWAY. Running it twice on the
 * same claim reports `AlreadyRecorded`, a reinstall moves the claim onto the
 * new installation, and an account another tenant holds is reported rather than
 * taken — every one of them an outcome the door answers with.
 */

import { postgresPool } from "../adapters/postgres/pool.ts";
import { postgresForgeInstallationRecording } from "../adapters/postgres/forgeInstallation.ts";
import { memberAuthority } from "../interpreter/projectAccess.ts";
import { oidcPrincipal } from "../interpreter/principal.ts";
import { asTenantId } from "../interpreter/projectStore.ts";
import {
  asForgeAccount,
  asForgeAccountKind,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
} from "../interpreter/forgeInstallation.ts";
import type { ForgeInstallationClaim } from "../interpreter/forgeInstallationClaim.ts";

const databaseUrlVariable = "CHUG_PROVISION_DATABASE_URL";
const issuerVariable = "CHUG_API_OIDC_ISSUER";
const subjectVariable = "CHUG_PROVISION_SUBJECT";
const forgeVariable = "CHUG_PROVISION_FORGE";
const appVariable = "CHUG_PROVISION_APP";
const accountVariable = "CHUG_PROVISION_ACCOUNT";
const accountKindVariable = "CHUG_PROVISION_ACCOUNT_KIND";
const installationIdVariable = "CHUG_PROVISION_INSTALLATION_ID";
const tenantVariable = "CHUG_PROVISION_TENANT";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}

/** The claim the variables name, every identity in it narrowed before a connection is opened. */
function provisionClaim(): ForgeInstallationClaim {
  return {
    forge: asForgeId(requiredEnvironment(forgeVariable)),
    app: asForgeApp(requiredEnvironment(appVariable)),
    account: asForgeAccount(requiredEnvironment(accountVariable)),
    accountKind: asForgeAccountKind(requiredEnvironment(accountKindVariable)),
    installationId: asForgeInstallationId(
      requiredEnvironment(installationIdVariable),
    ),
    tenant: asTenantId(requiredEnvironment(tenantVariable)),
    authority: memberAuthority(
      oidcPrincipal(
        requiredEnvironment(issuerVariable),
        requiredEnvironment(subjectVariable),
      ),
    ),
  };
}

/** What one claim is reported as, naming the account rather than the installation it points at. */
function provisionClaimText(claim: ForgeInstallationClaim): string {
  return `${claim.forge}/${claim.app} on ${claim.account} for ${claim.tenant}`;
}

async function main(): Promise<void> {
  const claim = provisionClaim();
  const pool = postgresPool(requiredEnvironment(databaseUrlVariable));
  try {
    const recorded =
      await postgresForgeInstallationRecording(pool).record(claim);
    process.stdout.write(`${recorded} ${provisionClaimText(claim)}\n`);
    if (recorded === "ClaimedElsewhere") process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown provisioning failure";
  process.stderr.write(`provision forge installation: ${message}\n`);
  process.exitCode = 1;
});
