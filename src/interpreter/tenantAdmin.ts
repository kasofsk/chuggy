import type { AuthorizedResult, Principal } from "./nativeWeb.ts";
import type { Authority } from "./operationInbox.ts";
import type { Partition, TenantId } from "./projectStore.ts";

/** What a principal may be within one tenant. */
export type TenantRole = "Owner" | "Admin" | "Member";

/** Every tenant role, so a suite iterates rather than restates. */
export const allTenantRoles: readonly TenantRole[] = [
  "Owner",
  "Admin",
  "Member",
];

/**
 * What a tenant membership authorizes, which is administration and never a
 * ticket. Project access is a separate question answered by `ProjectAccess`,
 * because a role only supplies the default there and a project row overrides it.
 */
export type TenantCapability =
  "ManageTenant" | "ManageMembers" | "ManageProjects" | "ReadTenant";

/** Every tenant capability, so a suite iterates rather than restates. */
export const allTenantCapabilities: readonly TenantCapability[] = [
  "ManageTenant",
  "ManageMembers",
  "ManageProjects",
  "ReadTenant",
];

/**
 * Current tenant standing, for a caller deciding what to offer rather than
 * whether to permit. Permission is resolved by the store, in the same statement
 * as the change, so a revoked administrator has no in-flight write to finish.
 */
export interface TenantAdministrationAccess {
  authorize(
    principal: Principal,
    tenant: TenantId,
    capability: TenantCapability,
  ): Promise<Authority | undefined>;
}

/** One person's standing in a tenant, as an administrator reads it back. */
export interface TenantMember {
  readonly principal: Principal;
  readonly role: TenantRole;
  readonly authority: Authority;
}

/** An outstanding offer of membership, which no principal holds yet. */
export interface TenantInvitation {
  readonly email: string;
  readonly role: TenantRole;
  readonly expiresAt: Date;
}

/** What redeeming an invitation produced, so a caller can report it. */
export interface RedeemedInvitation {
  readonly tenant: TenantId;
  readonly role: TenantRole;
}

/** The four accesses a project membership row carries as an override. */
export interface ProjectAccessGrant {
  readonly mayRead: boolean;
  readonly mayMutate: boolean;
  readonly mayDispatch: boolean;
  readonly mayPropose: boolean;
}

/**
 * Tenant administration, which is control-plane state rather than ticket state
 * and so is written directly rather than journaled.
 *
 * Every operation naming an actor answers `NotFound` when that actor lacks the
 * capability, because being told no is an input to the caller's decision rather
 * than a failure.
 */
export interface TenantAdministrationStore {
  createTenant(
    principal: Principal,
    tenant: TenantId,
    displayName: string,
    authority: Authority,
  ): Promise<void>;
  redeemInvitations(
    principal: Principal,
    email: string,
  ): Promise<readonly RedeemedInvitation[]>;
  grantMembership(
    actor: Principal,
    tenant: TenantId,
    principal: Principal,
    role: TenantRole,
  ): Promise<AuthorizedResult<void>>;
  revokeMembership(
    actor: Principal,
    tenant: TenantId,
    principal: Principal,
  ): Promise<AuthorizedResult<void>>;
  invite(
    actor: Principal,
    tenant: TenantId,
    email: string,
    role: TenantRole,
    expiresAt: Date,
  ): Promise<AuthorizedResult<void>>;
  revokeInvitation(
    actor: Principal,
    tenant: TenantId,
    email: string,
  ): Promise<AuthorizedResult<void>>;
  createProject(
    actor: Principal,
    partition: Partition,
  ): Promise<AuthorizedResult<void>>;
  setProjectAccess(
    actor: Principal,
    partition: Partition,
    principal: Principal,
    grant: ProjectAccessGrant,
  ): Promise<AuthorizedResult<void>>;
  clearProjectAccess(
    actor: Principal,
    partition: Partition,
    principal: Principal,
  ): Promise<AuthorizedResult<void>>;
  members(
    actor: Principal,
    tenant: TenantId,
  ): Promise<AuthorizedResult<readonly TenantMember[]>>;
  invitations(
    actor: Principal,
    tenant: TenantId,
  ): Promise<AuthorizedResult<readonly TenantInvitation[]>>;
}
