/**
 * The site inviting a person into a tenant of their own: their account found or
 * created as the tenant invitation finds or creates it, then made the tenant's
 * administrator with the defaults every tenant starts with.
 *
 * A TENANT IS FREE OR ALREADY THIS PERSON'S. One the account carrying the
 * credential administers is the same invitation sent again, and is written
 * again; otherwise one any tuple holds is taken, by `TenantClaims`' own
 * definition, and nothing is made or written. Without such an account nobody
 * administers it as this person, so only whether it is held is asked.
 *
 * IT IS SAFE TO SEND TWICE, AND NOTHING LOCKS. Every write is idempotent and a
 * repeat finds the person administering, but the check and the writes are
 * separate requests: two invitations of different people to one free tenant
 * may both pass the check, and the plane does not close that window.
 *
 * EACH POWER IS ASKED BY ITS OWN KIND. `CreateTenant` always, before anything
 * else is asked, and a caller without it is answered as absent;
 * `ManageSiteAuthorities` only where the tenant's administrators are to make
 * accounts; `CreateAccount` only where an account is made.
 *
 * THE PERSON IS GIVEN NOTHING ELSE. No `members` tuple, no project, no tenant
 * row: a tenant held by its tuples is one the API treats as administered by
 * them, who creates its first project as anyone does in a tenant they
 * administer.
 */

import {
  accessOwnedTenantSchema,
  type AccessOwnerInvitation,
} from "../contract/accessPlane.ts";
import {
  accessGroupHolder,
  accessSiteAuthorityRelations,
  accessTenantPlace,
} from "./accessAuthorities.ts";
import type { AccessDirectory } from "./accessDirectory.ts";
import {
  accessInvitationPerson,
  type AccessGithubAccounts,
  type AccessInvitationRefusal,
  type AccessInvitationSettings,
  type AccessPersonInvited,
} from "./accessInvitation.ts";
import { oidcPrincipal, type Principal } from "./principal.ts";
import {
  projectAccessSiteNamespace,
  projectAccessSiteObject,
  type ProjectAccess,
} from "./projectAccess.ts";
import type { TenantClaims } from "./projectCreation.ts";
import {
  tenantAdministratorGrant,
  tenantAuthorityDefaults,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import { asTenantId, type TenantId } from "./projectStore.ts";

export interface AccessOwnerInvitationPorts {
  readonly access: ProjectAccess;
  readonly claims: TenantClaims;
  readonly grants: ProjectGrantWriter;
  readonly directory?: AccessDirectory | undefined;
  readonly github?: AccessGithubAccounts | undefined;
}

/** Where a tenant the invitation names is held by something other than the person invited. */
export interface AccessOwnerTenantTaken {
  readonly invited: "TenantTaken";
}

/** What a site's invitation came to. Every outcome but `Invited` changed nothing. */
export type AccessOwnerInvitationResult =
  AccessPersonInvited | AccessOwnerTenantTaken | AccessInvitationRefusal;

export interface AccessOwnerInvitations {
  invite(
    caller: Principal,
    invitation: AccessOwnerInvitation,
  ): Promise<AccessOwnerInvitationResult>;
}

/** Whether the caller may make a tenant, and may hand its administrators the making of accounts where the invitation asks it, as an outcome refusing it where not. */
async function accessOwnerInvitationAdmitted(
  access: ProjectAccess,
  caller: Principal,
  invitation: AccessOwnerInvitation,
): Promise<AccessInvitationRefusal | undefined> {
  if ((await access.authorizeSite(caller, "CreateTenant")) === undefined)
    return { invited: "Absent" };
  if (
    invitation.createAccounts &&
    (await access.authorizeSite(caller, "ManageSiteAuthorities")) === undefined
  )
    return { invited: "Refused" };
  return undefined;
}

/** Whether `tenant` is taken from the person `subject` names, or from a person no account names yet. */
async function accessOwnerInvitationStanding(
  ports: AccessOwnerInvitationPorts,
  issuer: string,
  tenant: TenantId,
  subject: string | undefined,
): Promise<AccessOwnerTenantTaken | undefined> {
  if (
    subject !== undefined &&
    (await ports.access.authorizeTenant(
      oidcPrincipal(issuer, subject),
      tenant,
      "AdministerTenant",
    )) !== undefined
  )
    return undefined;
  return (await ports.claims.claimed(tenant))
    ? { invited: "TenantTaken" }
    : undefined;
}

/** Every tuple the invitation writes, the administrator's first: the person administering, the tenant's defaults, and its administrators among the site's account creators where asked. */
export function accessOwnerInvitationGrants(
  issuer: string,
  tenant: TenantId,
  subject: string,
  createAccounts: boolean,
): readonly ProjectGrant[] {
  return [
    tenantAdministratorGrant(oidcPrincipal(issuer, subject), tenant),
    ...tenantAuthorityDefaults(tenant),
    ...(createAccounts
      ? [
          {
            namespace: projectAccessSiteNamespace,
            object: projectAccessSiteObject,
            relation: accessSiteAuthorityRelations.AccountCreators,
            holder: accessGroupHolder(
              accessTenantPlace(tenant),
              "TenantAdmins",
            ),
          },
        ]
      : []),
  ];
}

export function accessOwnerInvitations(
  ports: AccessOwnerInvitationPorts,
  settings: AccessInvitationSettings,
): AccessOwnerInvitations {
  return {
    invite: async (caller, invitation) => {
      const { directory, github } = ports;
      if (directory === undefined || github === undefined)
        return { invited: "NotConfigured" };
      if (!accessOwnedTenantSchema.safeParse(invitation.tenant).success)
        throw new RangeError(
          "access owner invitation: the tenant is not a name a new tenant may take",
        );
      const tenant = asTenantId(invitation.tenant);
      const refused = await accessOwnerInvitationAdmitted(
        ports.access,
        caller,
        invitation,
      );
      if (refused !== undefined) return refused;
      const result = await accessInvitationPerson(
        { access: ports.access, directory, github },
        settings,
        caller,
        {
          github: invitation.github,
          email: invitation.email,
          tenant,
          standing: (subject) =>
            accessOwnerInvitationStanding(
              ports,
              settings.issuer,
              tenant,
              subject,
            ),
        },
      );
      if (result.invited !== "Invited") return result;
      for (const grant of accessOwnerInvitationGrants(
        settings.issuer,
        tenant,
        result.subject,
        invitation.createAccounts,
      ))
        await ports.grants.write(grant);
      return result;
    },
  };
}
