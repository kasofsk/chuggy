/**
 * The administrative command that gives the site, and the tenants and projects
 * that existed before their creation wrote them, their default authority
 * holders.
 *
 * IT READS AND WRITES THE AUTHORITY AND NOTHING ELSE. What a level holds is
 * tuples, so no database is involved and no identity in one is.
 *
 * IT WRITES ONLY WHEN TOLD TO. Without `CHUG_PROVISION_APPLY=1` it reports what
 * it would do and writes nothing, and any other value is refused, so a typo is
 * never read as either answer.
 *
 * What it decides, and why, is `../interpreter/accessDefaults.ts`'s; this is
 * the wiring.
 */

import { ketoAccessTuples } from "../adapters/keto/accessTuples.ts";
import { ketoProjectGrants } from "../adapters/keto/projectGrants.ts";
import {
  AccessDefaultsListingCut,
  accessDefaultsListingPagesMaxDefault,
  accessDefaultsProvisioned,
  type AccessDefaultsSettings,
} from "../interpreter/accessDefaults.ts";
import { checkedProjectAccessSettings } from "../interpreter/projectAccess.ts";
import { checkedProjectGrantSettings } from "../interpreter/projectGrant.ts";
import { asTenantId } from "../interpreter/projectStore.ts";
import {
  planeEnvironmentPositive,
  planeEnvironmentRequired,
} from "./planeEnvironment.ts";

const readUrlVariable = "CHUG_PROVISION_KETO_READ_URL";
const writeUrlVariable = "CHUG_PROVISION_KETO_WRITE_URL";
const tenantVariable = "CHUG_PROVISION_TENANT";
const applyVariable = "CHUG_PROVISION_APPLY";
const listingPagesVariable = "CHUG_PROVISION_LISTING_PAGES_MAX";

function provisionDefaultsApply(): boolean {
  const value = process.env[applyVariable];
  if (value === undefined || value === "") return false;
  if (value === "1") return true;
  throw new Error(`${applyVariable} must be 1 or unset`);
}

function provisionDefaultsSettings(): AccessDefaultsSettings {
  const tenant = process.env[tenantVariable];
  return {
    tenant:
      tenant === undefined || tenant === "" ? undefined : asTenantId(tenant),
    apply: provisionDefaultsApply(),
    listingPagesMax: planeEnvironmentPositive(
      listingPagesVariable,
      accessDefaultsListingPagesMaxDefault,
    ),
  };
}

async function main(): Promise<void> {
  const settings = provisionDefaultsSettings();
  await accessDefaultsProvisioned(
    {
      tuples: ketoAccessTuples(
        checkedProjectAccessSettings({
          readUrl: planeEnvironmentRequired(readUrlVariable),
        }),
      ),
      grants: ketoProjectGrants(
        checkedProjectGrantSettings({
          writeUrl: planeEnvironmentRequired(writeUrlVariable),
        }),
      ),
    },
    settings,
    (line) => process.stdout.write(`${line}\n`),
  );
  process.stdout.write(
    settings.apply
      ? "wrote the defaults above\n"
      : `wrote nothing; ${applyVariable}=1 writes the defaults above\n`,
  );
}

await main().catch((failure: unknown) => {
  const message =
    failure instanceof Error ? failure.message : "unknown provisioning failure";
  const remedy =
    failure instanceof AccessDefaultsListingCut
      ? `; nothing was written past it, and ${listingPagesVariable} raises the bound`
      : "";
  process.stderr.write(`provision access defaults: ${message}${remedy}\n`);
  process.exitCode = 1;
});
