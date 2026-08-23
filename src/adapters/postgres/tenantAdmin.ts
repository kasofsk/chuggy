import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asPrincipal,
  type AuthorizedResult,
} from "../../interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../interpreter/operationInbox.ts";
import { asTenantId } from "../../interpreter/projectStore.ts";
import {
  allTenantRoles,
  type RedeemedInvitation,
  type TenantAdministrationAccess,
  type TenantAdministrationStore,
  type TenantInvitation,
  type TenantMember,
  type TenantRole,
} from "../../interpreter/tenantAdmin.ts";
import { tenantAuthorizationFunction } from "./schema.ts";

interface AuthorityRow {
  readonly authority_kind: string | null;
  readonly authority_subject: string | null;
}

/**
 * A set-returning function reports every column as nullable whatever its body
 * can produce, so these rows say so and the narrowing below is what turns them
 * back into the values the function actually answers with.
 */
interface MemberRow {
  readonly principal: string | null;
  readonly role: string | null;
  readonly authority_kind: string | null;
  readonly authority_subject: string | null;
}

interface InvitationRow {
  readonly email: string | null;
  readonly role: string | null;
  readonly expires_at: Date | null;
}

interface RedeemedRow {
  readonly tenant: string | null;
  readonly role: string | null;
}

/** What the checked functions raise when the actor holds no such capability. */
const insufficientPrivilege = "42501";

/** A column the function cannot answer null in, narrowed where it arrives. */
function present<Value>(value: Value | null, what: string): Value {
  if (value === null)
    throw new Error(`tenant administration: ${what} came back null`);
  return value;
}

/** A role the database returned, narrowed against the one declared list. */
function asTenantRole(value: string | null): TenantRole {
  const named = present(value, "a role");
  const role = allTenantRoles.find((candidate) => candidate === named);
  if (role === undefined)
    throw new Error(`tenant administration: unknown role ${named}`);
  return role;
}

/**
 * A refusal from the database is a value here rather than a fault: the function
 * is the authority on the capability, and it says so with the one SQLSTATE
 * reserved for it. Any other failure is a fault and stays thrown.
 */
async function authorized<Value>(
  act: () => Promise<Value>,
): Promise<AuthorizedResult<Value>> {
  try {
    return { result: "Authorized", value: await act() };
  } catch (raised) {
    if (
      typeof raised === "object" &&
      raised !== null &&
      "code" in raised &&
      raised.code === insufficientPrivilege
    )
      return { result: "NotFound" };
    throw raised;
  }
}

/** Current tenant standing, over an API-role pool. */
export function postgresTenantAdministrationAccess(
  pool: pg.Pool,
): TenantAdministrationAccess {
  return {
    authorize: async (principal, tenant, capability) => {
      const found = await pool.query<AuthorityRow>(
        sql`SELECT authority_kind,authority_subject
              FROM authorize_tenant_capability(
                ${principal},${tenant},${capability})`,
      );
      const row = found.rows[0];
      if (row === undefined) return undefined;
      if (found.rows.length !== 1)
        throw new Error(
          `${tenantAuthorizationFunction}: one membership resolved more than once`,
        );
      return {
        kind: asAuthorityKind(present(row.authority_kind, "a kind")),
        subject: asAuthoritySubject(
          present(row.authority_subject, "a subject"),
        ),
      };
    },
  };
}

/** Who belongs to a tenant, and at what standing. */
function postgresTenantMemberships(
  pool: pg.Pool,
): Pick<
  TenantAdministrationStore,
  "createTenant" | "grantMembership" | "revokeMembership" | "members"
> {
  return {
    createTenant: async (principal, tenant, displayName, authority) => {
      await pool.query<{ created: string | null }>(
        sql`SELECT create_tenant(
              ${principal},${tenant},${displayName},
              ${authority.kind},${authority.subject})::text AS created`,
      );
    },

    grantMembership: (actor, tenant, principal, role) =>
      authorized(async () => {
        await pool.query<{ granted: string | null }>(
          sql`SELECT grant_tenant_membership(
                ${actor},${tenant},${principal},${role})::text AS granted`,
        );
      }),

    revokeMembership: (actor, tenant, principal) =>
      authorized(async () => {
        await pool.query<{ revoked: string | null }>(
          sql`SELECT revoke_tenant_membership(${actor},${tenant},${principal})::text AS revoked`,
        );
      }),

    members: (actor, tenant) =>
      authorized(async () => {
        const found = await pool.query<MemberRow>(
          sql`SELECT principal,role,authority_kind,authority_subject
                FROM list_tenant_members(${actor},${tenant})`,
        );
        return found.rows.map((row): TenantMember => ({
          principal: asPrincipal(present(row.principal, "a principal")),
          role: asTenantRole(row.role),
          authority: {
            kind: asAuthorityKind(present(row.authority_kind, "a kind")),
            subject: asAuthoritySubject(
              present(row.authority_subject, "a subject"),
            ),
          },
        }));
      }),
  };
}

/** Offers of membership, and what becomes of them. */
function postgresTenantInvitations(
  pool: pg.Pool,
): Pick<
  TenantAdministrationStore,
  "invite" | "revokeInvitation" | "redeemInvitations" | "invitations"
> {
  return {
    invite: (actor, tenant, email, role, expiresAt) =>
      authorized(async () => {
        await pool.query<{ invited: string | null }>(
          sql`SELECT invite_to_tenant(
                ${actor},${tenant},${email},${role},${expiresAt})::text AS invited`,
        );
      }),

    revokeInvitation: (actor, tenant, email) =>
      authorized(async () => {
        await pool.query<{ withdrawn: string | null }>(
          sql`SELECT revoke_tenant_invitation(${actor},${tenant},${email})::text AS withdrawn`,
        );
      }),

    redeemInvitations: async (principal, email) => {
      const found = await pool.query<RedeemedRow>(
        sql`SELECT redeemed_tenant AS tenant,redeemed_role AS role
              FROM redeem_tenant_invitations(${principal},${email})`,
      );
      return found.rows.map((row): RedeemedInvitation => ({
        tenant: asTenantId(present(row.tenant, "a tenant")),
        role: asTenantRole(row.role),
      }));
    },

    invitations: (actor, tenant) =>
      authorized(async () => {
        const found = await pool.query<InvitationRow>(
          sql`SELECT email,role,expires_at
                FROM list_tenant_invitations(${actor},${tenant})`,
        );
        return found.rows.map((row): TenantInvitation => ({
          email: present(row.email, "an address"),
          role: asTenantRole(row.role),
          expiresAt: present(row.expires_at, "an expiry"),
        }));
      }),
  };
}

/** Projects a tenant holds, and the per-project overrides on them. */
function postgresTenantProjects(
  pool: pg.Pool,
): Pick<
  TenantAdministrationStore,
  "createProject" | "setProjectAccess" | "clearProjectAccess"
> {
  return {
    createProject: (actor, partition) =>
      authorized(async () => {
        await pool.query<{ created: string | null }>(
          sql`SELECT create_project_in_tenant(
                ${actor},${partition.tenant},${partition.project})::text AS created`,
        );
      }),

    setProjectAccess: (actor, partition, principal, grant) =>
      authorized(async () => {
        await pool.query<{ set: string | null }>(
          sql`SELECT set_project_membership(
                ${actor},${partition.tenant},${partition.project},${principal},
                ${grant.mayRead},${grant.mayMutate},
                ${grant.mayDispatch},${grant.mayPropose})::text AS set`,
        );
      }),

    clearProjectAccess: (actor, partition, principal) =>
      authorized(async () => {
        await pool.query<{ cleared: string | null }>(
          sql`SELECT clear_project_membership(
                ${actor},${partition.tenant},${partition.project},${principal})::text AS cleared`,
        );
      }),
  };
}

/**
 * Tenant administration over an API-role pool. Every operation is one function
 * call because the API role holds neither DML nor SELECT on the tables
 * underneath, so the capability check and the change cannot come apart.
 */
export function postgresTenantAdministration(
  pool: pg.Pool,
): TenantAdministrationStore {
  return {
    ...postgresTenantMemberships(pool),
    ...postgresTenantInvitations(pool),
    ...postgresTenantProjects(pool),
  };
}
