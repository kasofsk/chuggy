/**
 * PostgreSQL read side of the claimed forge installations, and the owner's door
 * that records one.
 *
 * THE READ IS A TABLE READ AND THE WRITE IS A FUNCTION. A claim is one row the
 * API mints from and never makes, so the API role holds SELECT and nothing
 * else; the door runs as the boundary owner, which is what keeps a route from
 * claiming an account before the slice that has one.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asForgeAccount,
  asForgeApp,
  asForgeId,
  asForgeInstallationId,
  type ForgeInstallation,
  type ForgeInstallationStore,
} from "../../interpreter/forgeInstallation.ts";
import { asTenantId } from "../../interpreter/projectStore.ts";
import type {
  ForgeInstallationClaim,
  ForgeInstallationRecorded,
  ForgeInstallationRecording,
} from "../../interpreter/forgeInstallationClaim.ts";
import { allForgeInstallationRecorded } from "../../interpreter/forgeInstallationClaim.ts";

/** The installation a tenant claimed for one account, read as the branded row it is. */
export function postgresForgeInstallations(
  pool: pg.Pool,
): ForgeInstallationStore {
  return {
    installation: async (query): Promise<ForgeInstallation | undefined> => {
      const found = await pool.query<{
        installation_id: string;
        tenant: string;
      }>(
        sql`SELECT installation_id, tenant
              FROM forge_installation
              WHERE forge = ${query.forge}
                AND app = ${query.app}
                AND account = ${query.account}`,
      );
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            forge: asForgeId(query.forge),
            app: asForgeApp(query.app),
            account: asForgeAccount(query.account),
            installationId: asForgeInstallationId(row.installation_id),
            tenant: asTenantId(row.tenant),
          };
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
