/**
 * Who agreed to which version of the deployment's policies, the one thing the
 * agreement plane keeps in a database.
 *
 * A REQUEST'S AGREEMENTS ARE ONE STATEMENT, so they land together or not at
 * all, and a row its person already holds is passed over by the key rather
 * than written again: the first agreement stands with its time and evidence.
 *
 * THE TIME IS THE COLUMN'S DEFAULT. No statement here names `agreed_at` but
 * to read it, and the plane's role could not write one if it did.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import type { AgreementStore } from "../../interpreter/agreementPlane.ts";

export function postgresPolicyAgreements(pool: pg.Pool): AgreementStore {
  return {
    agreed: async (principal, policies) => {
      const found = await pool.query<{
        policy: string;
        version: string;
        digest: string;
        agreed_at: Date;
      }>(
        sql`SELECT a.policy,a.version,a.digest,a.agreed_at FROM policy_agreement a
        JOIN unnest(${policies.map((entry) => entry.policy)}::text[],
                    ${policies.map((entry) => entry.version)}::text[],
                    ${policies.map((entry) => entry.digest)}::text[])
          AS c(policy,version,digest)
          ON a.policy=c.policy AND a.version=c.version AND a.digest=c.digest
        WHERE a.principal=${principal}`,
      );
      return found.rows.map((row) => ({
        policy: row.policy,
        version: row.version,
        digest: row.digest,
        agreedAt: row.agreed_at.toISOString(),
      }));
    },
    record: async (principal, policies, evidence) => {
      await pool.query(
        sql`INSERT INTO policy_agreement
          (principal,policy,version,url,digest,client_address,user_agent)
        SELECT ${principal},c.policy,c.version,c.url,c.digest,
               ${evidence.clientAddress ?? null}::inet,${evidence.userAgent ?? null}::text
        FROM unnest(${policies.map((entry) => entry.policy)}::text[],
                    ${policies.map((entry) => entry.version)}::text[],
                    ${policies.map((entry) => entry.url)}::text[],
                    ${policies.map((entry) => entry.digest)}::text[])
          AS c(policy,version,url,digest)
        ON CONFLICT (principal,policy,version,digest) DO NOTHING`,
      );
    },
  };
}

/** Whether the pool's connection is `role`'s, which is what the plane is ready under. */
export async function postgresPolicyAgreementsReady(
  pool: pg.Pool,
  role: string,
): Promise<boolean> {
  try {
    const found = await pool.query<{ current_role: string }>(
      sql`SELECT COALESCE(current_user::text,'') AS current_role`,
    );
    return found.rows[0]?.current_role === role;
  } catch {
    return false;
  }
}
