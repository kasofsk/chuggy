/**
 * PostgreSQL read side of the claimed forge installations, and the owner's door
 * that records one.
 *
 * THE READ IS A TABLE READ AND THE WRITE IS A FUNCTION. A claim is one row the
 * API mints from and never makes, so the API role holds SELECT and nothing
 * else; the door runs as the boundary owner, which is what keeps a route from
 * claiming an account before the slice that has one.
 *
 * THE TENANT IS A TERM OF THE READ. A row another tenant claimed does not match
 * and the read answers nothing, so a caller cannot be handed a claim it would
 * have had to remember to compare.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { forgeInstallationsAnsweredMax } from "../../contract/http.ts";
import {
  asForgeAccount,
  asForgeAccountKind,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  type ForgeInstallation,
  type ForgeInstallationId,
  type ForgeInstallationStore,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaim,
  ForgeInstallationClaimed,
  ForgeInstallationClaims,
  ForgeInstallationClaimsPage,
  ForgeInstallationRecorded,
  ForgeInstallationRecording,
} from "../../interpreter/forgeInstallationClaim.ts";
import { allForgeInstallationRecorded } from "../../interpreter/forgeInstallationClaim.ts";
import type { TenantId } from "../../interpreter/projectStore.ts";

/** The installation a tenant claimed for one account, read as the branded row it is. */
export function postgresForgeInstallations(
  pool: pg.Pool,
): ForgeInstallationStore {
  return {
    installation: async (query): Promise<ForgeInstallation | undefined> => {
      const found = await pool.query<{
        installation_id: string;
      }>(
        sql`SELECT installation_id
              FROM forge_installation
              WHERE forge = ${query.forge}
                AND app = ${query.app}
                AND account = ${query.account}
                AND tenant = ${query.tenant}`,
      );
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            forge: asForgeId(query.forge),
            app: asForgeApp(query.app),
            account: asForgeAccount(query.account),
            installationId: asForgeInstallationId(row.installation_id),
          };
    },
  };
}

/** One claim as the relation holds it, every column of it NOT NULL. */
interface ForgeInstallationRow {
  forge: string;
  app: string;
  account: string;
  account_kind: string;
  installation_id: string;
  claimed_at: string;
}

/** One row as the interpreter reads it, every identity narrowed where it is read. */
function forgeInstallationClaimed(
  row: ForgeInstallationRow,
): ForgeInstallationClaimed {
  return {
    forge: asForgeId(row.forge),
    app: asForgeApp(row.app),
    account: asForgeAccount(row.account),
    accountKind: asForgeAccountKind(row.account_kind),
    installationId: asForgeInstallationId(row.installation_id),
    claimedAt: row.claimed_at,
  };
}

/**
 * A tenant's claims, oldest first and broken apart by the account, which is the
 * key, so a listing a reader pages by eye is stable as later claims arrive. The
 * listing reads one row past the ceiling the response schema answers under, so
 * a tenant holding more than that is told the page is partial instead of being
 * handed a silently short one.
 */
async function forgeInstallationClaimsPage(
  pool: pg.Pool,
  tenant: TenantId,
): Promise<ForgeInstallationClaimsPage> {
  const found = await pool.query<ForgeInstallationRow>(
    sql`SELECT forge,app,account,account_kind,installation_id,
               claimed_at::text AS claimed_at
          FROM forge_installation
          WHERE tenant = ${tenant}
          ORDER BY claimed_at,forge,app,account
          LIMIT ${forgeInstallationsAnsweredMax + 1}`,
  );
  return {
    claims: found.rows
      .slice(0, forgeInstallationsAnsweredMax)
      .map(forgeInstallationClaimed),
    truncated: found.rows.length > forgeInstallationsAnsweredMax,
  };
}

/**
 * The one claim a tenant holds under an installation identity, which is a
 * lookup and never a search of the listing's page: a page bound used as an
 * ownership test answers `NotFound` for a claim past it, which is a tenant
 * refused what it holds.
 */
async function forgeInstallationClaim(
  pool: pg.Pool,
  tenant: TenantId,
  installationId: ForgeInstallationId,
): Promise<ForgeInstallationClaimed | undefined> {
  const found = await pool.query<ForgeInstallationRow>(
    sql`SELECT forge,app,account,account_kind,installation_id,
               claimed_at::text AS claimed_at
          FROM forge_installation
          WHERE tenant = ${tenant} AND installation_id = ${installationId}
          ORDER BY forge,app,account
          LIMIT 1`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : forgeInstallationClaimed(row);
}

/** The tenant's own claims, read as a page and one row at a time. */
export function postgresForgeInstallationClaims(
  pool: pg.Pool,
): ForgeInstallationClaims {
  return {
    claims: (tenant) => forgeInstallationClaimsPage(pool, tenant),
    claim: (tenant, installationId) =>
      forgeInstallationClaim(pool, tenant, installationId),
  };
}

/** The owner's door onto a claim, every outcome of it one the interpreter declares. */
export function postgresForgeInstallationRecording(
  pool: pg.Pool,
): ForgeInstallationRecording {
  return {
    record: async (claim: ForgeInstallationClaim) => {
      const found = await pool.query<{ outcome: string | null }>(
        sql`SELECT record_forge_installation(
          ${claim.forge},${claim.app},${claim.account},${claim.accountKind},
          ${claim.installationId},${claim.tenant},
          ${claim.authority.kind},${claim.authority.subject})::text AS outcome`,
      );
      const outcome = found.rows[0]?.outcome;
      if (
        outcome === null ||
        outcome === undefined ||
        !allForgeInstallationRecorded.includes(
          outcome as ForgeInstallationRecorded,
        )
      )
        throw new Error(
          `forge installation: unknown outcome ${String(outcome)}`,
        );
      return outcome as ForgeInstallationRecorded;
    },
  };
}
