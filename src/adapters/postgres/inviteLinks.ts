/**
 * A tenant's invite links and the site's workspace links, the one thing the
 * access plane keeps in a database.
 *
 * A WORKSPACE LINK IS A ROW NAMING NO TENANT, so every statement keyed by a
 * tenant passes it by, and each of the site's statements asks for the rows
 * naming none. The workspace its use made is a column of its own.
 *
 * THE DATABASE'S CLOCK DECIDES. A spend, a revocation, the count of open links,
 * the open link a registration reads and the state a list answers are each judged by `now()` in the statement
 * itself, so this process holds no clock a link's state could disagree with.
 *
 * A SPEND IS ONE CONDITIONAL UPDATE, so two callers presenting one token are
 * separated by the statement and not by this process. A revocation is the
 * same, and neither can take a link the other has ended. A workspace link's
 * spend writes the workspace in that update, and the index holding a name to
 * one used link refuses a second, so two links taking one name at once are
 * separated by the index.
 *
 * A MINT IS SERIALIZED PER TENANT, and the site's workspace links on a lock of
 * their own, on an advisory lock taken in a statement of its own, for the reason the registration token's is: a count taken in the
 * insert's own snapshot would miss a mint committed while it waited. Under
 * that lock it drops the tenant's ended links past the most recently ended it
 * keeps, then counts the open ones.
 *
 * WHAT IS STORED IS READ BACK THROUGH THE CONTRACT'S SCHEMAS, so a role or a
 * project the contract no longer names is a fault rather than a grant.
 */
import { sql } from "@ts-safeql/sql-tag";
import pg from "pg";
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
  AccessInviteLinkUsed,
  AccessInviteLinkWritten,
  AccessWorkspaceLinkMint,
  AccessWorkspaceLinkSpent,
  AccessWorkspaceLinkStored,
} from "../../interpreter/accessInviteLink.ts";
import { asTenantId } from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";

const inviteLinkProjectsSchema = z.array(accessInvitationProjectSchema);

/** The index that holds a workspace's name to one used link. */
const inviteLinkWorkspaceIndex = "invite_link_workspace_once";

/** The advisory lock the site's workspace links are minted under. */
const inviteLinkSiteLock = "invite-link-site";

/** What a link grants, as a row keeps it, which a workspace link's row does not and is refused. */
function inviteLinkGrants(row: {
  role: string | null;
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
  role: string | null;
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
    role: string | null;
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

/** The kind of the open link `digest` names, read without spending it. */
async function inviteLinkPresented(
  pool: pg.Pool,
  digest: string,
): Promise<"Tenant" | "Workspace" | undefined> {
  const found = await pool.query<{ workspace: boolean }>(
    sql`SELECT (l.tenant IS NULL) AS workspace FROM invite_link l
    WHERE l.token_digest=${digest}
      AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return row.workspace ? "Workspace" : "Tenant";
}

/** The used link of either kind `digest` names whose user is `subject`, whatever the clock says. */
async function inviteLinkUsedBy(
  pool: pg.Pool,
  digest: string,
  subject: string,
): Promise<AccessInviteLinkUsed | undefined> {
  const found = await pool.query<{
    tenant: string | null;
    role: string | null;
    projects: unknown;
    workspace: string | null;
  }>(sql`SELECT l.tenant,l.role,l.projects,l.workspace FROM invite_link l
    WHERE l.token_digest=${digest} AND l.used_by=${subject}`);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  if (row.tenant !== null)
    return {
      kind: "Tenant",
      tenant: asTenantId(row.tenant),
      ...inviteLinkGrants(row),
    };
  if (row.workspace === null)
    throw new RangeError("workspace link: a used link names no use");
  return { kind: "Workspace", workspace: asTenantId(row.workspace) };
}

/** One listed workspace link row, its state the one its statement derived. */
function workspaceLinkStored(row: {
  link: string;
  create_accounts: boolean | null;
  note: string | null;
  new_accounts: boolean;
  minted_by: string;
  minted_at: Date;
  expires_at: Date;
  used_by: string | null;
  used_at: Date | null;
  workspace: string | null;
  state: "Used" | "Revoked" | "Expired" | "Open";
}): AccessWorkspaceLinkStored {
  if (row.create_accounts === null)
    throw new RangeError("workspace link: a workspace link carries no grant");
  const kept = {
    link: row.link,
    createAccounts: row.create_accounts,
    note: row.note ?? undefined,
    newAccounts: row.new_accounts,
    mintedBy: row.minted_by,
    mintedAtMs: row.minted_at.getTime(),
    expiresAtMs: row.expires_at.getTime(),
  };
  const state = row.state;
  if (state !== "Used") return { ...kept, state };
  if (row.used_by === null || row.used_at === null || row.workspace === null)
    throw new RangeError("workspace link: a used link names no use");
  return {
    ...kept,
    state,
    usedBy: row.used_by,
    usedAtMs: row.used_at.getTime(),
    workspace: asTenantId(row.workspace),
  };
}

async function workspaceLinkMinted(
  client: pg.PoolClient,
  link: AccessWorkspaceLinkMint,
): Promise<AccessInviteLinkWritten> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${inviteLinkSiteLock}, 0))::text AS locked`,
  );
  await client.query(sql`DELETE FROM invite_link d WHERE d.link IN (
      SELECT e.link FROM invite_link e
      WHERE e.tenant IS NULL
        AND (e.used_at IS NOT NULL OR e.revoked_at IS NOT NULL OR e.expires_at<=now())
      ORDER BY COALESCE(e.used_at, e.revoked_at, e.expires_at) DESC, e.link DESC
      OFFSET ${accessInviteLinksEndedKept})`);
  const counted = await client.query<{ open: number }>(
    sql`SELECT count(*)::int AS open FROM invite_link o
      WHERE o.tenant IS NULL AND o.used_at IS NULL AND o.revoked_at IS NULL
        AND o.expires_at>now()`,
  );
  if (
    (counted.rows[0]?.open ?? accessInviteLinksOpenMax) >=
    accessInviteLinksOpenMax
  )
    return { written: "LimitReached" };
  const inserted = await client.query<{ link: string; expires_at: Date }>(
    sql`INSERT INTO invite_link(token_digest,create_accounts,note,new_accounts,minted_by,expires_at)
      VALUES(${link.digest},${link.createAccounts},${link.note ?? null},
        ${link.newAccounts},${link.mintedBy},
        now()+${accessInviteLinkLifetimeMs}::bigint*interval '1 millisecond')
      RETURNING link,expires_at`,
  );
  const row = inserted.rows[0];
  if (row === undefined)
    throw new RangeError("workspace link: no row inserted");
  return {
    written: "Minted",
    link: row.link,
    expiresAtMs: row.expires_at.getTime(),
  };
}

/** Every workspace link the site keeps, newest first, each in the state the statement derives. */
async function workspaceLinksListed(
  pool: pg.Pool,
): Promise<AccessWorkspaceLinkStored[]> {
  const found = await pool.query<{
    link: string;
    create_accounts: boolean | null;
    note: string | null;
    new_accounts: boolean;
    minted_by: string;
    minted_at: Date;
    expires_at: Date;
    used_by: string | null;
    used_at: Date | null;
    workspace: string | null;
    state: "Used" | "Revoked" | "Expired" | "Open";
  }>(sql`SELECT l.link,l.create_accounts,l.note,l.new_accounts,l.minted_by,
          l.minted_at,l.expires_at,l.used_by,l.used_at,l.workspace,
          CASE WHEN l.used_at IS NOT NULL THEN 'Used'
               WHEN l.revoked_at IS NOT NULL THEN 'Revoked'
               WHEN l.expires_at<=now() THEN 'Expired'
               ELSE 'Open' END AS state
        FROM invite_link l WHERE l.tenant IS NULL
        ORDER BY l.minted_at DESC, l.link DESC
        LIMIT ${accessInviteLinksOpenMax + accessInviteLinksEndedKept}`);
  return found.rows.map(workspaceLinkStored);
}

/** Whether `failure` is the index refusing a workspace another used link holds. */
function workspaceLinkTaken(failure: unknown): boolean {
  return (
    failure instanceof pg.DatabaseError &&
    failure.code === "23505" &&
    failure.constraint === inviteLinkWorkspaceIndex
  );
}

async function workspaceLinkSpent(
  pool: pg.Pool,
  spend: { digest: string; subject: string; workspace: string },
): Promise<AccessWorkspaceLinkSpent | undefined> {
  try {
    const spent = await pool.query<{
      link: string;
      create_accounts: boolean | null;
    }>(sql`UPDATE invite_link l
        SET used_by=${spend.subject},used_at=now(),workspace=${spend.workspace}
        WHERE l.token_digest=${spend.digest} AND l.tenant IS NULL
          AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()
        RETURNING l.link,l.create_accounts`);
    const row = spent.rows[0];
    if (row === undefined) return undefined;
    if (row.create_accounts === null)
      throw new RangeError("workspace link: a workspace link carries no grant");
    return {
      spent: "Spent",
      link: row.link,
      createAccounts: row.create_accounts,
    };
  } catch (failure) {
    if (workspaceLinkTaken(failure)) return { spent: "Taken" };
    throw failure;
  }
}

/** The site's workspace link statements, each over the rows naming no tenant. */
function workspaceLinks(
  pool: pg.Pool,
): Pick<
  AccessInviteLinkStore,
  | "workspaceMint"
  | "workspaceListed"
  | "workspaceHeld"
  | "workspaceRevoke"
  | "workspaceSpend"
> {
  return {
    workspaceMint: (link) =>
      postgresTransaction(pool, (client) => workspaceLinkMinted(client, link)),
    workspaceListed: () => workspaceLinksListed(pool),
    workspaceHeld: async (link) => {
      const found = await pool.query<{
        create_accounts: boolean | null;
        open: boolean;
      }>(sql`SELECT l.create_accounts,
          (l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()) AS open
        FROM invite_link l WHERE l.tenant IS NULL AND l.link=${link}`);
      const row = found.rows[0];
      if (row === undefined) return undefined;
      if (row.create_accounts === null)
        throw new RangeError(
          "workspace link: a workspace link carries no grant",
        );
      return { createAccounts: row.create_accounts, open: row.open };
    },
    workspaceRevoke: async (link) => {
      const revoked =
        await pool.query(sql`UPDATE invite_link l SET revoked_at=now()
        WHERE l.tenant IS NULL AND l.link=${link}
          AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()`);
      return (revoked.rowCount ?? 0) === 1;
    },
    workspaceSpend: (digest, subject, workspace) =>
      workspaceLinkSpent(pool, { digest, subject, workspace }),
  };
}

export function postgresInviteLinks(pool: pg.Pool): AccessInviteLinkStore {
  return {
    mint: (link) =>
      postgresTransaction(pool, (client) => inviteLinkMinted(client, link)),
    listed: (tenant) => inviteLinksListed(pool, tenant),
    held: async (tenant, link) => {
      const found = await pool.query<{
        role: string | null;
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
        tenant: string | null;
        role: string | null;
        projects: unknown;
      }>(sql`UPDATE invite_link l SET used_by=${subject},used_at=now()
        WHERE l.token_digest=${digest} AND l.tenant IS NOT NULL
          AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()
        RETURNING l.link,l.tenant,l.role,l.projects`);
      const row = spent.rows[0];
      if (row === undefined) return undefined;
      if (row.tenant === null)
        throw new RangeError("invite link: a tenant's link names no tenant");
      return {
        link: row.link,
        tenant: asTenantId(row.tenant),
        ...inviteLinkGrants(row),
      };
    },
    restore: async (link) => {
      const restored = await pool.query(sql`UPDATE invite_link l
        SET used_by=NULL,used_at=NULL,workspace=NULL
        WHERE l.link=${link} AND l.used_at IS NOT NULL`);
      return (restored.rowCount ?? 0) === 1;
    },
    opened: async (digest) => {
      const found = await pool.query<{ new_accounts: boolean }>(
        sql`SELECT l.new_accounts FROM invite_link l
        WHERE l.token_digest=${digest}
          AND l.used_at IS NULL AND l.revoked_at IS NULL AND l.expires_at>now()`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : { newAccounts: row.new_accounts };
    },
    presented: (digest) => inviteLinkPresented(pool, digest),
    usedBy: (digest, subject) => inviteLinkUsedBy(pool, digest, subject),
    ...workspaceLinks(pool),
  };
}
