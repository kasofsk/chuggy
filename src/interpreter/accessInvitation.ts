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
 * NOTHING IS ASKED OF GITHUB OR THE DIRECTORY until every project named is the
 * tenant's and the caller holds the kind granting every role named, so neither
 * learns of a request the authority would refuse. A caller who may not be
 * answered the tenant's list is answered as absent, as the plane answers them.
 *
 * MAKING AN ACCOUNT ASKS `CreateAccount`, as soon as no account carries the
 * credential and before the email is asked about, so a caller refused it learns
 * nothing of who holds an address. They do learn whether the GitHub user has an
 * account here, as `created` tells whoever may invite.
 */

import type { AccessInvitation } from "../contract/accessPlane.ts";
import type {
  AccessDirectory,
  AccessGithubAccount,
} from "./accessDirectory.ts";
import {
  accessProjectHeld,
  accessProjectRoleGrantKinds,
  accessProjectRoleRelations,
  accessTenantHeld,
  accessTenantListed,
  accessTenantRoleGrantKinds,
  accessTenantRoleRelations,
  accessTupleLinkRelation,
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
        | "Refused"
        | "AccountNotPermitted"
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

/** Whether the authority holds `partition`'s `tenant` link naming its own tenant, and not the holders of a role there. */
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
      tuple.subject.object === tenantObject &&
      tuple.subject.relation === accessTupleLinkRelation,
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

/** What finding the person came to: their account, no account the caller may make, an email held by another, or neither. */
type AccessFound =
  | { readonly found: "Account"; readonly subject: string }
  | { readonly found: "NotPermitted" }
  | { readonly found: "EmailHeld" }
  | { readonly found: "Neither" };

/** What an invitation makes an account under: the email, who invited, the tenant, and whether the caller may make one. */
interface AccessCreation {
  readonly email: string;
  readonly invitedBy: string;
  readonly tenant: TenantId;
  readonly permitted: () => Promise<boolean>;
}

async function accessInvitationFound(
  directory: AccessDirectory,
  github: AccessGithubAccount,
  creation: AccessCreation,
): Promise<AccessFound> {
  const subject = await directory.githubHolder(github);
  if (subject !== undefined) return { found: "Account", subject };
  if (!(await creation.permitted())) return { found: "NotPermitted" };
  return (await directory.emailHeld(creation.email))
    ? { found: "EmailHeld" }
    : { found: "Neither" };
}

/** The account the person signs in as, found or created, or why there is none. */
async function accessInvitationAccount(
  directory: AccessDirectory,
  github: AccessGithubAccount,
  creation: AccessCreation,
): Promise<AccessInvitationResult> {
  const found = await accessInvitationFound(directory, github, creation);
  if (found.found === "Account")
    return { invited: "Invited", subject: found.subject, created: false };
  if (found.found === "NotPermitted") return { invited: "AccountNotPermitted" };
  if (found.found === "EmailHeld") return { invited: "EmailHeld" };
  const created = await directory.create({
    email: creation.email,
    invitedBy: creation.invitedBy,
    tenant: creation.tenant,
    github,
  });
  switch (created.created) {
    case "Created":
      return { invited: "Invited", subject: created.subject, created: true };
    case "EmailRefused":
      return { invited: "EmailRefused" };
    case "Conflict": {
      const again = await accessInvitationFound(directory, github, creation);
      if (again.found === "Account")
        return { invited: "Invited", subject: again.subject, created: false };
      if (again.found === "NotPermitted")
        return { invited: "AccountNotPermitted" };
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

/** Whether the caller holds the kind granting every role the invitation names, each on the tenant or the project it is named on. */
async function accessInvitationGrantable(
  access: ProjectAccess,
  caller: Principal,
  tenant: TenantId,
  invitation: AccessInvitation,
): Promise<boolean> {
  if (
    !(await accessTenantHeld(
      access,
      caller,
      tenant,
      accessTenantRoleGrantKinds[invitation.role],
    ))
  )
    return false;
  for (const named of invitation.projects ?? [])
    for (const role of named.roles)
      if (
        !(await accessProjectHeld(
          access,
          caller,
          { tenant, project: asProjectId(named.project) },
          accessProjectRoleGrantKinds[role],
        ))
      )
        return false;
  return true;
}

/** Whether the caller may be answered the tenant's list, every project named is the tenant's, and the caller may grant every role named, as an outcome refusing it where not. */
async function accessInvitationAdmitted(
  ports: AccessInvitationPorts,
  caller: Principal,
  tenant: TenantId,
  invitation: AccessInvitation,
): Promise<AccessInvitationResult | undefined> {
  if (!(await accessTenantListed(ports.access, caller, tenant)))
    return { invited: "Absent" };
  for (const named of invitation.projects ?? [])
    if (
      !(await accessInvitationProjectHeld(ports.tuples, {
        tenant,
        project: asProjectId(named.project),
      }))
    )
      return { invited: "ProjectUnknown" };
  return (await accessInvitationGrantable(
    ports.access,
    caller,
    tenant,
    invitation,
  ))
    ? undefined
    : { invited: "Refused" };
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
        permitted: async () =>
          (await ports.access.authorizeSite(caller, "CreateAccount")) !==
          undefined,
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
