/**
 * A workspace's people: who each one is, the words their roles are drawn in,
 * what a role change or an invitation came to, and what an invitation's fields
 * may hold before anything is sent.
 *
 * Every field rule is the access contract's own schema, so this only spares the
 * reader a round trip to be told what the plane would refuse anyway. Every
 * refusal the plane names has its own line in `accessRefusalLabel`, total over
 * the contract's roster, and a name outside it is printed as one this console
 * does not know.
 */

import {
  accessEmailSchema,
  accessGithubLoginSchema,
  accessHolderNotAdmittedCode,
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessInvitationSchema,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  type AccessInvitation,
  type AccessInvited,
  type AccessProjectRole,
  type AccessTenantPerson,
  type AccessTenantRole,
} from "../../../../src/contract/accessPlane.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";

/** What the page draws for a reader the list is not answered to. */
export const tenantPeopleWithheld = "A workspace admin manages people";

export const tenantPeopleTruncated = "List cut short";

/** One workspace role as the label its control carries. */
export function tenantRoleLabel(role: AccessTenantRole): string {
  switch (role) {
    case "Admin":
      return "Admin";
    case "Member":
      return "Member";
  }
}

/** One project role as the label its control carries. */
export function projectRoleLabel(role: AccessProjectRole): string {
  switch (role) {
    case "Admin":
      return "Admin";
    case "Developer":
      return "Developer";
    case "Dispatcher":
      return "Dispatcher";
  }
}

export type AccessRefusalCode =
  | (typeof accessInvitationCodes)[keyof typeof accessInvitationCodes]
  | typeof accessLastTenantAdministratorCode
  | typeof accessNotPermittedCode
  | typeof accessHolderNotAdmittedCode;

/** Every name the plane refuses a change or an invitation with. */
export const accessRefusalCodes: readonly AccessRefusalCode[] = [
  ...Object.values(accessInvitationCodes),
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessHolderNotAdmittedCode,
];

/** Why the plane refused, as the one line under what was refused. */
export function accessRefusalLabel(code: AccessRefusalCode): string {
  switch (code) {
    case "InvitationNotConfigured":
      return "Invitations not configured";
    case "InvitationProjectUnknown":
      return "Project not in this workspace";
    case "InvitationAccountNotPermitted":
      return "Account creation not permitted";
    case "GithubAccountUnknown":
      return "No such GitHub user";
    case "GithubAccountNotUser":
      return "Not a person's GitHub account";
    case "InvitationEmailHeld":
      return "Email held by another account · use another address";
    case "InvitationEmailRefused":
      return "Email refused";
    case "GithubUnavailable":
      return "GitHub unavailable";
    case "DirectoryRaced":
      return "Directory changed · try again";
    case "DirectoryUnavailable":
      return "Directory unavailable";
    case "LastTenantAdministrator":
      return "Only admin · grant another first";
    case "AccessNotPermitted":
      return "Change not permitted";
    case "AccessHolderNotAdmitted":
      return "Holder not admitted";
  }
}

function accessRefusalCodeOf(code: string): AccessRefusalCode | undefined {
  return accessRefusalCodes.find((known) => known === code);
}

/** A name the plane answered with, or the fallback that prints it. */
export function accessCodeLabel(code: string): string {
  const known = accessRefusalCodeOf(code);
  return known === undefined
    ? `Unknown refusal (${code})`
    : accessRefusalLabel(known);
}

/** Any answer but `Ok`, as one or two words or the plane's own line. */
export function accessFailureLabel(failure: ApiFailure): string {
  switch (failure.outcome) {
    case "Unauthenticated":
      return "Not signed in";
    case "Absent":
      return "Not available";
    case "Conflict":
    case "Rejected":
    case "Retryable":
      return accessCodeLabel(failure.code);
    case "Fault":
      return "Failed";
    case "Unreachable":
      return "Unreachable";
    case "Unreadable":
      return "Unreadable";
  }
}

/** What one grant or removal came to: nothing to say, or its line. */
export function tenantRoleChangeNote(
  result: ApiResult<undefined>,
): string | undefined {
  return result.outcome === "Ok" ? undefined : accessFailureLabel(result);
}

/** One role held or not, on the workspace or on one of its projects. */
export type TenantRoleChange =
  | {
      readonly scope: "Tenant";
      readonly role: AccessTenantRole;
      readonly held: boolean;
    }
  | {
      readonly scope: "Project";
      readonly project: string;
      readonly role: AccessProjectRole;
      readonly held: boolean;
    };

/** Removing the reader's own workspace admin is the one change asked first,
 * because once it is done the list is no longer theirs to read. */
export function tenantRoleChangeAsks(
  person: AccessTenantPerson,
  change: TenantRoleChange,
): boolean {
  return (
    person.mine &&
    change.scope === "Tenant" &&
    change.role === "Admin" &&
    change.held
  );
}

/** The roles one person holds on one of the workspace's projects. */
export function tenantPersonProjectRoles(
  person: AccessTenantPerson,
  project: string,
): readonly AccessProjectRole[] {
  return person.projects.find((held) => held.project === project)?.roles ?? [];
}

/** Who one person is: an account by its email, or the subject itself, marked
 * where the plane says it is no account. */
export interface TenantPersonName {
  readonly name: string;
  readonly subject: boolean;
  readonly githubLogin: string | undefined;
  readonly noAccount: boolean;
}

export function tenantPersonName(person: AccessTenantPerson): TenantPersonName {
  const email = person.account === true ? person.email : undefined;
  return {
    name: email ?? person.subject,
    subject: email === undefined,
    githubLogin: person.account === true ? person.githubLogin : undefined,
    noAccount: person.account === false,
  };
}

/** The line counting principals from another sign-in, where there are any. */
export function tenantPeopleOtherIssuersLine(
  otherIssuers: number,
): string | undefined {
  return otherIssuers === 0
    ? undefined
    : `${String(otherIssuers)} more from another sign-in`;
}

/** An invitation as the dialog holds it, every project's roles kept even
 * where none is chosen. */
export interface TenantInvitationForm {
  readonly github: string;
  readonly email: string;
  readonly role: AccessTenantRole;
  readonly projects: readonly {
    readonly project: string;
    readonly roles: readonly AccessProjectRole[];
  }[];
}

export function tenantInvitationGithubFault(
  github: string,
): string | undefined {
  if (github === "") return undefined;
  return accessGithubLoginSchema.safeParse(github).success
    ? undefined
    : "Not a GitHub username";
}

export function tenantInvitationEmailFault(email: string): string | undefined {
  if (email === "") return undefined;
  return accessEmailSchema.safeParse(email).success
    ? undefined
    : "Not an email";
}

function tenantInvitationProjectsChosen(
  form: TenantInvitationForm,
): AccessInvitation["projects"] {
  return form.projects
    .filter((chosen) => chosen.roles.length > 0)
    .map((chosen) => ({ project: chosen.project, roles: [...chosen.roles] }));
}

export function tenantInvitationProjectsFault(
  form: TenantInvitationForm,
): string | undefined {
  const projects = tenantInvitationProjectsChosen(form);
  if (accessInvitationSchema.shape.projects.safeParse(projects).success)
    return undefined;
  return (projects?.length ?? 0) > accessInvitationProjectsMax
    ? `At most ${String(accessInvitationProjectsMax)} projects`
    : "Each project once";
}

/** What the plane is sent, projects named only where one is chosen. */
export function tenantInvitationBody(
  form: TenantInvitationForm,
): AccessInvitation {
  const projects = tenantInvitationProjectsChosen(form) ?? [];
  return {
    github: form.github,
    email: form.email,
    role: form.role,
    ...(projects.length === 0 ? {} : { projects }),
  };
}

export function tenantInvitationSendable(form: TenantInvitationForm): boolean {
  return accessInvitationSchema.safeParse(tenantInvitationBody(form)).success;
}

/** One project role chosen or let go in the dialog. */
export function tenantInvitationProjectToggled(
  form: TenantInvitationForm,
  project: string,
  role: AccessProjectRole,
): TenantInvitationForm {
  return {
    ...form,
    projects: form.projects.map((chosen) => {
      if (chosen.project !== project) return chosen;
      const roles = chosen.roles.includes(role)
        ? chosen.roles.filter((held) => held !== role)
        : [...chosen.roles, role];
      return { project, roles };
    }),
  };
}

/** What one invitation came to. An absent answer is a plane that invites
 * nobody or a reader no longer an admin, and reading the list again is what
 * tells the two apart. */
export type TenantInvitationOutcome =
  | { readonly outcome: "Invited" }
  | {
      readonly outcome: "Refused";
      readonly status: string;
      readonly reread: boolean;
    };

export function tenantInvitationOutcome(
  result: ApiResult<AccessInvited>,
): TenantInvitationOutcome {
  if (result.outcome === "Ok") return { outcome: "Invited" };
  return {
    outcome: "Refused",
    status: accessFailureLabel(result),
    reread: result.outcome === "Absent",
  };
}
