/**
 * A tenant's invite links, the one thing the access plane keeps in a database.
 *
 * THE DATABASE'S CLOCK DECIDES. A spend, a revocation, the count of open links
 * and the state a list answers are each judged by `now()` in the statement
 * itself, so this process holds no clock a link's state could disagree with.
 *
 * A SPEND IS ONE CONDITIONAL UPDATE, so two callers presenting one token are
 * separated by the statement and not by this process. A revocation is the
 * same, and neither can take a link the other has ended.
 *
 * A MINT IS SERIALIZED PER TENANT on an advisory lock taken in a statement of
 * its own, for the reason the registration token's is: a count taken in the
 * insert's own snapshot would miss a mint committed while it waited. Under
 * that lock it drops the tenant's ended links past the most recently ended it
 * keeps, then counts the open ones.
 *
 * WHAT IS STORED IS READ BACK THROUGH THE CONTRACT'S SCHEMAS, so a role or a
 * project the contract no longer names is a fault rather than a grant.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { z } from "zod";

import {
  accessInvitationProjectSchema,
  accessInviteLinkLifetimeMs,
  accessInviteLinksEndedKept,
  accessInviteLinksOpenMax,
  accessTenantRoleSchema,
} from "../../contract/accessPlane.ts";
import type {
  AccessInviteLinkGrants,
  AccessInviteLinkMint,
  AccessInviteLinkStore,
  AccessInviteLinkStored,
  AccessInviteLinkWritten,
} from "../../interpreter/accessInviteLink.ts";
import { asTenantId } from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";

const inviteLinkProjectsSchema = z.array(accessInvitationProjectSchema);

/** What a link grants, as a row keeps it. */
function inviteLinkGrants(row: {
  role: string;
  projects: unknown;
}): AccessInviteLinkGrants {
  return {
    role: accessTenantRoleSchema.parse(row.role),
    projects: inviteLinkProjectsSchema.parse(row.projects),
  };
}

/** One listed row, its state the one its statement derived. */
function inviteLinkStored(row: {
  link: string;
  role: string;
  projects: unknown;
  new_accounts: boolean;
  minted_by: string;
  minted_at: Date;
  expires_at: Date;
  used_by: string | null;
  used_at: Date | null;
  state: "Used" | "Revoked" | "Expired" | "Open";
}): AccessInviteLinkStored {
  const kept = {
    link: row.link,
    ...inviteLinkGrants(row),
    newAccounts: row.new_accounts,
    mintedBy: row.minted_by,
    mintedAtMs: row.minted_at.getTime(),
    expiresAtMs: row.expires_at.getTime(),
  };
  const state = row.state;
  if (state !== "Used") return { ...kept, state };
  if (row.used_by === null || row.used_at === null)
    throw new RangeError("invite link: a used link names no use");
  return {
    ...kept,
    state,
    usedBy: row.used_by,
    usedAtMs: row.used_at.getTime(),
  };
}

async function inviteLinkMinted(
  client: pg.PoolClient,
  link: AccessInviteLinkMint,
): Promise<AccessInviteLinkWritten> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('invite-link:' || ${link.tenant}, 0))::text AS locked`,
  );
  await client.query(sql`DELETE FROM invite_link d WHERE d.link IN (
      SELECT e.link FROM invite_link e
      WHERE e.tenant=${link.tenant}
        AND (e.used_at IS NOT NULL OR e.revoked_at IS NOT NULL OR e.expires_at<=now())
      ORDER BY COALESCE(e.used_at, e.revoked_at, e.expires_at) DESC, e.link DESC
      OFFSET ${accessInviteLinksEndedKept})`);
  const counted = await client.query<{ open: number }>(
    sql`SELECT count(*)::int AS open FROM invite_link o
      WHERE o.tenant=${link.tenant} AND o.used_at IS NULL AND o.revoked_at IS NULL
        AND o.expires_at>now()`,
  );
  if (
    (counted.rows[0]?.open ?? accessInviteLinksOpenMax) >=
    accessInviteLinksOpenMax
  )
    return { written: "LimitReached" };
  const inserted = await client.query<{ link: string; expires_at: Date }>(
    sql`INSERT INTO invite_link(tenant,token_digest,role,projects,new_accounts,minted_by,expires_at)
      VALUES(${link.tenant},${link.digest},${link.role},${JSON.stringify(link.projects)}::jsonb,
        ${link.newAccounts},${link.mintedBy},
        now()+${accessInviteLinkLifetimeMs}::bigint*interval '1 millisecond')
      RETURNING link,expires_at`,
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new RangeError("invite link: no row inserted");
  return {
    written: "Minted",
    link: row.link,
    expiresAtMs: row.expires_at.getTime(),
  };
}

/** Every link the tenant keeps, newest first, each in the state the statement derives. */
async function inviteLinksListed(
  pool: pg.Pool,
  tenant: string,
): Promise<AccessInviteLinkStored[]> {
  const found = await pool.query<{
    link: string;
    role: string;
    projects: unknown;
    new_accounts: boolean;
    minted_by: string;
    minted_at: Date;
    expires_at: Date;
    used_by: string | null;
    used_at: Date | null;
    state: "Used" | "Revoked" | "Expired" | "Open";
  }>(sql`SELECT l.link,l.role,l.projects,l.new_accounts,l.minted_by,l.minted_at,
          l.expires_at,l.used_by,l.used_at,
          CASE WHEN l.used_at IS NOT NULL THEN 'Used'
               WHEN l.revoked_at IS NOT NULL THEN 'Revoked'
               WHEN l.expires_at<=now() THEN 'Expired'
               ELSE 'Open' END AS state
        FROM invite_link l WHERE l.tenant=${tenant}
        ORDER BY l.minted_at DESC, l.link DESC
        LIMIT ${accessInviteLinksOpenMax + accessInviteLinksEndedKept}`);
  return found.rows.map(inviteLinkStored);
}

export function postgresInviteLinks(pool: pg.Pool): AccessInviteLinkStore {
  return {
    mint: (link) =>
      postgresTransaction(pool, (client) => inviteLinkMinted(client, link)),
    listed: (tenant) => inviteLinksListed(pool, tenant),
    held: async (tenant, link) => {
      const found = await pool.query<{
        role: string;
        projects: unknown;
        open: boolean;
      }>(sql`SELECT l.role,l.projects,
          (l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()) AS open
        FROM invite_link l WHERE l.tenant=${tenant} AND l.link=${link}`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : { ...inviteLinkGrants(row), open: row.open };
    },
    revoke: async (tenant, link) => {
      const revoked =
        await pool.query(sql`UPDATE invite_link l SET revoked_at=now()
        WHERE l.tenant=${tenant} AND l.link=${link}
          AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()`);
      return (revoked.rowCount ?? 0) === 1;
    },
    spend: async (digest, subject) => {
      const spent = await pool.query<{
        link: string;
        tenant: string;
        role: string;
        projects: unknown;
      }>(sql`UPDATE invite_link l SET used_by=${subject},used_at=now()
        WHERE l.token_digest=${digest}
          AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()
        RETURNING l.link,l.tenant,l.role,l.projects`);
      const row = spent.rows[0];
      return row === undefined
        ? undefined
        : {
            link: row.link,
            tenant: asTenantId(row.tenant),
            ...inviteLinkGrants(row),
          };
    },
    restore: async (link) => {
      const restored =
        await pool.query(sql`UPDATE invite_link l SET used_by=NULL,used_at=NULL
        WHERE l.link=${link} AND l.used_at IS NOT NULL`);
      return (restored.rowCount ?? 0) === 1;
    },
  };
}
