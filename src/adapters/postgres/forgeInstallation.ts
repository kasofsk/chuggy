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
  type ForgeInstallationStore,
} from "../../interpreter/forgeInstallation.ts";
import type {
  ForgeInstallationClaim,
  ForgeInstallationClaimed,
  ForgeInstallationClaims,
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

/**
 * Every claim one tenant holds, oldest first and broken apart by the account,
 * which is the key, so a listing a reader pages by eye is stable as later
 * claims arrive. Nothing bounds how many accounts a tenant installs the app on,
 * so the read carries the ceiling the response schema answers under rather than
 * fetching a set it would discard the tail of.
 */
export function postgresForgeInstallationClaims(
  pool: pg.Pool,
): ForgeInstallationClaims {
  return {
    claims: async (
      tenant: TenantId,
    ): Promise<readonly ForgeInstallationClaimed[]> => {
      const found = await pool.query<{
        forge: string;
        app: string;
        account: string;
        account_kind: string;
        installation_id: string;
        claimed_at: string;
      }>(
        sql`SELECT forge,app,account,account_kind,installation_id,
                   claimed_at::text AS claimed_at
              FROM forge_installation
              WHERE tenant = ${tenant}
              ORDER BY claimed_at,forge,app,account
              LIMIT ${forgeInstallationsAnsweredMax}`,
      );
      return found.rows.map((row) => {
        return {
          forge: asForgeId(row.forge),
          app: asForgeApp(row.app),
          account: asForgeAccount(row.account),
          accountKind: asForgeAccountKind(row.account_kind),
          installationId: asForgeInstallationId(row.installation_id),
          claimedAt: row.claimed_at,
        };
      });
    },
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
