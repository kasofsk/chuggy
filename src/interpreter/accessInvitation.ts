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

import type {
  AccessInvitation,
  AccessInvitationGrants,
} from "../contract/accessPlane.ts";
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

/** The person an invitation found or made, and whether this request made their account. */
export interface AccessPersonInvited {
  readonly invited: "Invited";
  readonly subject: string;
  readonly created: boolean;
}

/** Why GitHub or the directory gave an invitation no person. */
export interface AccessPersonRefusal {
  readonly invited:
    | "AccountNotPermitted"
    | "GithubAccountUnknown"
    | "GithubAccountNotUser"
    | "GithubUnavailable"
    | "EmailHeld"
    | "EmailRefused"
    | "DirectoryRaced";
}

/** The refusals every invitation shares: who may, a plane with no directory, and the person refused. */
export type AccessInvitationRefusal =
  | AccessPersonRefusal
  | { readonly invited: "Absent" | "NotConfigured" | "Refused" };

/** What an invitation came to. Every outcome but `Invited` changed nothing. */
export type AccessInvitationResult =
  | AccessPersonInvited
  | { readonly invited: "ProjectUnknown" }
  | AccessInvitationRefusal;

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

/** Every grant an invitation writes for `subject`: the tenant role, then each project's. */
export function accessInvitationGrants(
  issuer: string,
  tenant: TenantId,
  invitation: AccessInvitationGrants,
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

/** What finding the person came to: their account, a refusal of where they stand, no account the caller may make, an email held by another, or neither. */
type AccessFound<Refusal> =
  | { readonly found: "Account"; readonly subject: string }
  | { readonly found: "Standing"; readonly refusal: Refusal }
  | { readonly found: "NotPermitted" }
  | { readonly found: "EmailHeld" }
  | { readonly found: "Neither" };

/**
 * Who an invitation names and for which tenant, and what it asks of the account
 * carrying the credential, or of there being none, before anything is made.
 * `standing` answers a refusal where the invitation stops there.
 */
export interface AccessInvitationPerson<Refusal extends object> {
  readonly github: string;
  readonly email: string;
  readonly tenant: TenantId;
  readonly standing: (
    subject: string | undefined,
  ) => Promise<Refusal | undefined>;
}

/** What an invitation makes an account under: the person named, who invited, and whether the caller may make one. */
interface AccessCreation<Refusal extends object> {
  readonly person: AccessInvitationPerson<Refusal>;
  readonly invitedBy: string;
  readonly permitted: () => Promise<boolean>;
}

async function accessInvitationFound<Refusal extends object>(
  directory: AccessDirectory,
  github: AccessGithubAccount,
  creation: AccessCreation<Refusal>,
): Promise<AccessFound<Refusal>> {
  const subject = await directory.githubHolder(github);
  const refusal = await creation.person.standing(subject);
  if (refusal !== undefined) return { found: "Standing", refusal };
  if (subject !== undefined) return { found: "Account", subject };
  if (!(await creation.permitted())) return { found: "NotPermitted" };
  return (await directory.emailHeld(creation.person.email))
    ? { found: "EmailHeld" }
    : { found: "Neither" };
}

/** The outcome a finding ends the invitation with, or nothing where neither the credential nor the email is held. */
function accessInvitationFoundEnded<Refusal extends object>(
  found: AccessFound<Refusal>,
): AccessPersonInvited | AccessPersonRefusal | Refusal | undefined {
  switch (found.found) {
    case "Account":
      return { invited: "Invited", subject: found.subject, created: false };
    case "Standing":
      return found.refusal;
    case "NotPermitted":
      return { invited: "AccountNotPermitted" };
    case "EmailHeld":
      return { invited: "EmailHeld" };
    case "Neither":
      return undefined;
  }
}

/** The account the person signs in as, found or created, or why there is none. */
async function accessInvitationAccount<Refusal extends object>(
  directory: AccessDirectory,
  github: AccessGithubAccount,
  creation: AccessCreation<Refusal>,
): Promise<AccessPersonInvited | AccessPersonRefusal | Refusal> {
  const ended = accessInvitationFoundEnded(
    await accessInvitationFound(directory, github, creation),
  );
  if (ended !== undefined) return ended;
  const created = await directory.create({
    email: creation.person.email,
    invitedBy: creation.invitedBy,
    tenant: creation.person.tenant,
    github,
  });
  switch (created.created) {
    case "Created":
      return { invited: "Invited", subject: created.subject, created: true };
    case "EmailRefused":
      return { invited: "EmailRefused" };
    case "Conflict":
      return (
        accessInvitationFoundEnded(
          await accessInvitationFound(directory, github, creation),
        ) ?? { invited: "DirectoryRaced" }
      );
  }
}

/** The person's GitHub account, or the outcome refusing it. */
async function accessInvitationGithub(
  github: AccessGithubAccounts,
  login: string,
): Promise<AccessGithubAccount | AccessPersonRefusal> {
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

/** What finding or making the person reaches. */
export interface AccessInvitationPersonPorts {
  readonly access: ProjectAccess;
  readonly directory: AccessDirectory;
  readonly github: AccessGithubAccounts;
}

/**
 * The person an admitted invitation names: their GitHub account resolved, then
 * the account carrying it found, or made where `caller` may `CreateAccount`.
 * Nothing is made where `standing` refuses.
 */
export async function accessInvitationPerson<Refusal extends object>(
  ports: AccessInvitationPersonPorts,
  settings: AccessInvitationSettings,
  caller: Principal,
  person: AccessInvitationPerson<Refusal>,
): Promise<AccessPersonInvited | AccessPersonRefusal | Refusal> {
  const invitedBy = oidcPrincipalSubject(settings.issuer, caller);
  if (invitedBy === undefined)
    throw new RangeError(
      "access invitation: the caller is not a subject of the plane's issuer",
    );
  const account = await accessInvitationGithub(ports.github, person.github);
  if ("invited" in account) return account;
  return accessInvitationAccount(ports.directory, account, {
    person,
    invitedBy,
    permitted: async () =>
      (await ports.access.authorizeSite(caller, "CreateAccount")) !== undefined,
  });
}

/** Whether the caller holds the kind granting every role an invitation names, each on the tenant or the project it is named on. */
export async function accessInvitationGrantable(
  access: ProjectAccess,
  caller: Principal,
  tenant: TenantId,
  invitation: AccessInvitationGrants,
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

/** Why an invitation's grants are not the caller's to give: the tenant's list is not answered them, a project named is not the tenant's, or a role named is not theirs to grant. */
export interface AccessInvitationNotAdmitted {
  readonly invited: "Absent" | "ProjectUnknown" | "Refused";
}

/** Whether the caller may be answered the tenant's list, every project named is the tenant's, and the caller may grant every role named, as an outcome refusing it where not. */
export async function accessInvitationAdmitted(
  ports: Pick<AccessInvitationPorts, "access" | "tuples">,
  caller: Principal,
  tenant: TenantId,
  invitation: AccessInvitationGrants,
): Promise<AccessInvitationNotAdmitted | undefined> {
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
      const result = await accessInvitationPerson<never>(
        { access: ports.access, directory, github },
        settings,
        caller,
        {
          github: invitation.github,
          email: invitation.email,
          tenant,
          standing: () => Promise.resolve(undefined),
        },
      );
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
