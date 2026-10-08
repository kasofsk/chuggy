/**
 * Inviting a person to a tenant by their GitHub account: the account they
 * sign in as found or created in the directory, then their roles granted.
 *
 * THE GITHUB ACCOUNT IS THE PERSON AND THE EMAIL NEVER IS. An account carrying
 * the GitHub credential is the person whatever email was given; otherwise an
 * email some account holds is a conflict, since nobody verified it and an
 * inviter could name a stranger's address beside an account of their own.
 *
 * IT IS SAFE TO SEND TWICE. The directory and the authority share no
 * transaction: the account is made first and every grant is idempotent, so the
 * same invitation again finds the account and writes the same grants. A
 * creation that conflicts lost a race, and the finding is run once more.
 *
 * NOTHING IS ASKED OF GITHUB OR THE DIRECTORY until the caller may invite to
 * the tenant and every project named is the tenant's, so neither learns of a
 * request the authority would refuse.
 */

import type { AccessInvitation } from "../contract/accessPlane.ts";
import type {
  AccessDirectory,
  AccessGithubAccount,
} from "./accessDirectory.ts";
import {
  accessProjectRoleRelations,
  accessTenantRoleRelations,
  type AccessTupleReader,
} from "./accessPlane.ts";
import { oidcPrincipalSubject, type Principal } from "./principal.ts";
import {
  projectAccessNamespace,
  projectAccessObject,
  projectAccessTenantNamespace,
  projectAccessTenantObject,
  type ProjectAccess,
} from "./projectAccess.ts";
import {
  projectPrincipalGrant,
  projectTenantRelation,
  tenantPrincipalGrant,
  type ProjectGrant,
  type ProjectGrantWriter,
} from "./projectGrant.ts";
import { asProjectId, type Partition, type TenantId } from "./projectStore.ts";

/** The only kind of GitHub account an invitation admits. */
export const accessGithubPersonKind = "User";

/** What GitHub answered for a username: the account and its kind as GitHub names it, no such account, or no answer. */
export type AccessGithubLookup =
  | {
      readonly looked: "Found";
      readonly account: AccessGithubAccount;
      readonly kind: string;
    }
  | { readonly looked: "Unknown" }
  | { readonly looked: "Unavailable" };

/** GitHub's public account lookup, asked afresh every time. */
export interface AccessGithubAccounts {
  lookup(login: string): Promise<AccessGithubLookup>;
}

export interface AccessInvitationPorts {
  readonly access: ProjectAccess;
  readonly tuples: AccessTupleReader;
  readonly grants: ProjectGrantWriter;
  readonly directory?: AccessDirectory | undefined;
  readonly github?: AccessGithubAccounts | undefined;
}

export interface AccessInvitationSettings {
  readonly issuer: string;
}

/** What an invitation came to. Every outcome but `Invited` changed nothing. */
export type AccessInvitationResult =
  | {
      readonly invited: "Invited";
      readonly subject: string;
      readonly created: boolean;
    }
  | {
      readonly invited:
        | "Absent"
        | "NotConfigured"
        | "ProjectUnknown"
        | "GithubAccountUnknown"
        | "GithubAccountNotUser"
        | "GithubUnavailable"
        | "EmailHeld"
        | "EmailRefused"
        | "DirectoryRaced";
    };

export interface AccessInvitations {
  invite(
    caller: Principal,
    tenant: TenantId,
    invitation: AccessInvitation,
  ): Promise<AccessInvitationResult>;
}

/** Whether the authority holds `partition`'s `tenant` link naming its own tenant. */
async function accessInvitationProjectHeld(
  tuples: AccessTupleReader,
  partition: Partition,
): Promise<boolean> {
  const tenantObject = projectAccessTenantObject(partition.tenant);
  const page = await tuples.page(
    {
      query: "Object",
      namespace: projectAccessNamespace,
      object: projectAccessObject(partition),
      relation: projectTenantRelation,
    },
    undefined,
  );
  return page.tuples.some(
    (tuple) =>
      tuple.subject.subject === "Set" &&
      tuple.subject.namespace === projectAccessTenantNamespace &&
      tuple.subject.object === tenantObject,
  );
}

/** Every grant the invitation writes for `subject`: the tenant role, then each project's. */
function accessInvitationGrants(
  issuer: string,
  tenant: TenantId,
  invitation: AccessInvitation,
  subject: string,
): readonly ProjectGrant[] {
  return [
    tenantPrincipalGrant({
      issuer,
      subject,
      tenant,
      relation: accessTenantRoleRelations[invitation.role],
    }),
    ...(invitation.projects ?? []).flatMap((named) =>
      named.roles.map((projectRole) =>
        projectPrincipalGrant({
          issuer,
          subject,
          tenant,
          project: asProjectId(named.project),
          relation: accessProjectRoleRelations[projectRole],
        }),
      ),
    ),
  ];
}

/** What finding the person came to: their account, an email held by another, or neither. */
type AccessFound =
  | { readonly found: "Account"; readonly subject: string }
  | { readonly found: "EmailHeld" }
  | { readonly found: "Neither" };

async function accessInvitationFound(
  directory: AccessDirectory,
  github: AccessGithubAccount,
  email: string,
): Promise<AccessFound> {
  const subject = await directory.githubHolder(github);
  if (subject !== undefined) return { found: "Account", subject };
  return (await directory.emailHeld(email))
    ? { found: "EmailHeld" }
    : { found: "Neither" };
}

/** The account the person signs in as, found or created, or why there is none. */
async function accessInvitationAccount(
  directory: AccessDirectory,
  github: AccessGithubAccount,
  creation: {
    readonly email: string;
    readonly invitedBy: string;
    readonly tenant: TenantId;
  },
): Promise<AccessInvitationResult> {
  const found = await accessInvitationFound(directory, github, creation.email);
  if (found.found === "Account")
    return { invited: "Invited", subject: found.subject, created: false };
  if (found.found === "EmailHeld") return { invited: "EmailHeld" };
  const created = await directory.create({ ...creation, github });
  switch (created.created) {
    case "Created":
      return { invited: "Invited", subject: created.subject, created: true };
    case "EmailRefused":
      return { invited: "EmailRefused" };
    case "Conflict": {
      const again = await accessInvitationFound(
        directory,
        github,
        creation.email,
      );
      if (again.found === "Account")
        return { invited: "Invited", subject: again.subject, created: false };
      return again.found === "EmailHeld"
        ? { invited: "EmailHeld" }
        : { invited: "DirectoryRaced" };
    }
  }
}

/** The person's GitHub account, or the outcome refusing it. */
async function accessInvitationGithub(
  github: AccessGithubAccounts,
  login: string,
): Promise<AccessGithubAccount | AccessInvitationResult> {
  const looked = await github.lookup(login);
  switch (looked.looked) {
    case "Unknown":
      return { invited: "GithubAccountUnknown" };
    case "Unavailable":
      return { invited: "GithubUnavailable" };
    case "Found":
      return looked.kind === accessGithubPersonKind
        ? looked.account
        : { invited: "GithubAccountNotUser" };
  }
}

/** Whether the caller may invite to the tenant and every project named is the tenant's, as an outcome refusing it where not. */
async function accessInvitationAdmitted(
  ports: AccessInvitationPorts,
  caller: Principal,
  tenant: TenantId,
  invitation: AccessInvitation,
): Promise<AccessInvitationResult | undefined> {
  if (
    (await ports.access.authorizeTenant(caller, tenant, "InviteToTenant")) ===
    undefined
  )
    return { invited: "Absent" };
  for (const named of invitation.projects ?? [])
    if (
      !(await accessInvitationProjectHeld(ports.tuples, {
        tenant,
        project: asProjectId(named.project),
      }))
    )
      return { invited: "ProjectUnknown" };
  return undefined;
}

export function accessInvitations(
  ports: AccessInvitationPorts,
  settings: AccessInvitationSettings,
): AccessInvitations {
  return {
    invite: async (caller, tenant, invitation) => {
      const { directory, github } = ports;
      if (directory === undefined || github === undefined)
        return { invited: "NotConfigured" };
      const refused = await accessInvitationAdmitted(
        ports,
        caller,
        tenant,
        invitation,
      );
      if (refused !== undefined) return refused;
      const invitedBy = oidcPrincipalSubject(settings.issuer, caller);
      if (invitedBy === undefined)
        throw new RangeError(
          "access invitation: the caller is not a subject of the plane's issuer",
        );
      const account = await accessInvitationGithub(github, invitation.github);
      if ("invited" in account) return account;
      const result = await accessInvitationAccount(directory, account, {
        email: invitation.email,
        invitedBy,
        tenant,
      });
      if (result.invited !== "Invited") return result;
      for (const grant of accessInvitationGrants(
        settings.issuer,
        tenant,
        invitation,
        result.subject,
      ))
        await ports.grants.write(grant);
      return result;
    },
  };
}
