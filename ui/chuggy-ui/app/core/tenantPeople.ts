/**
 * A workspace's people: who each one is, the words what they hold is drawn in
 * on their row, the boxes their editor holds, the line a refused change or
 * invitation is drawn as and whether it reads the list again, which change is
 * asked first, what an invitation's fields may hold before anything is sent,
 * and which changes it offers.
 *
 * What an invitation grants is a form of its own, as the contract's schema is:
 * an invitation of a person adds who they are to it, and an invite link is
 * that part alone. What is held is a shape of its own the same way, so a
 * person's row and a link's draw what they hold from one account of it.
 *
 * Every field rule is the access contract's own schema, so this only spares the
 * reader a round trip to be told what the plane would refuse anyway. Every
 * refusal the plane names has its own line in `accessRefusalLabel`, total over
 * the contract's roster, and a name outside it is printed as one this console
 * does not know.
 *
 * What is offered is decided from the reader's abilities alone, and a reader
 * whose abilities were not read is offered nothing: no person's editor, a box
 * for what they may not change only where it is held, and an invitation only
 * with roles they may grant.
 */

import {
  accessEmailSchema,
  accessGithubLoginSchema,
  accessHolderNotAdmittedCode,
  accessInvitationCodes,
  accessInvitationGrantsSchema,
  accessInvitationProjectsMax,
  accessInvitationSchema,
  accessInviteLinkLimitReachedCode,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessProjectRoles,
  accessTenantRoles,
  type AccessAuthorityPerson,
  type AccessInvitation,
  type AccessInvitationGrants,
  type AccessProjectRole,
  type AccessTenantAbilities,
  type AccessTenantPerson,
  type AccessTenantRole,
} from "../../../../src/contract/accessPlane.ts";

import type { ApiFailure } from "./apiRequest.ts";
import type { Copy } from "./copy.ts";

/** What the page draws for a reader the list is not answered to. */
export const tenantPeopleWithheld: Copy = { id: "settings-people-withheld" };

export const tenantPeopleTruncated: Copy = { id: "settings-people-truncated" };

/** What the invitation says to a reader who may not make an account. */
export const tenantInvitationAccountsLine: Copy = {
  id: "settings-invitation-accounts",
};

/** One workspace role as the label its control carries. */
export function tenantRoleLabel(role: AccessTenantRole): Copy {
  switch (role) {
    case "Admin":
      return { id: "settings-role-admin" };
    case "Member":
      return { id: "settings-role-member" };
  }
}

/** One project role as the label its control carries. */
export function projectRoleLabel(role: AccessProjectRole): Copy {
  switch (role) {
    case "Admin":
      return { id: "settings-role-admin" };
    case "Developer":
      return { id: "settings-role-developer" };
    case "Dispatcher":
      return { id: "settings-role-dispatcher" };
    case "Viewer":
      return { id: "settings-role-viewer" };
  }
}

export type AccessRefusalCode =
  | (typeof accessInvitationCodes)[keyof typeof accessInvitationCodes]
  | typeof accessInviteLinkLimitReachedCode
  | typeof accessLastTenantAdministratorCode
  | typeof accessNotPermittedCode
  | typeof accessHolderNotAdmittedCode;

/** Every name the plane refuses a change, an invitation or an invite link with. */
export const accessRefusalCodes: readonly AccessRefusalCode[] = [
  ...Object.values(accessInvitationCodes),
  accessInviteLinkLimitReachedCode,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessHolderNotAdmittedCode,
];

/** Why the plane refused, as the one line under what was refused. */
export function accessRefusalLabel(code: AccessRefusalCode): Copy {
  switch (code) {
    case "InvitationNotConfigured":
      return { id: "settings-access-invites-unconfigured" };
    case "InvitationProjectUnknown":
      return { id: "settings-access-project-unknown" };
    case "InvitationAccountNotPermitted":
      return { id: "settings-access-account-not-permitted" };
    case "GithubAccountUnknown":
      return { id: "settings-access-github-unknown" };
    case "GithubAccountNotUser":
      return { id: "settings-access-github-not-user" };
    case "InvitationEmailHeld":
      return { id: "settings-access-email-held" };
    case "InvitationEmailRefused":
      return { id: "settings-access-email-refused" };
    case "GithubUnavailable":
      return { id: "settings-access-github-unavailable" };
    case "DirectoryRaced":
      return { id: "settings-access-directory-raced" };
    case "DirectoryUnavailable":
      return { id: "settings-access-directory-unavailable" };
    case "InviteLinkLimitReached":
      return { id: "settings-access-link-limit" };
    case "LastTenantAdministrator":
      return { id: "settings-access-last-admin" };
    case "AccessNotPermitted":
      return { id: "settings-access-not-permitted" };
    case "AccessHolderNotAdmitted":
      return { id: "settings-access-holder-not-admitted" };
  }
}

function accessRefusalCodeOf(code: string): AccessRefusalCode | undefined {
  return accessRefusalCodes.find((known) => known === code);
}

/** A name the plane answered with, or the fallback that prints it. */
export function accessCodeLabel(code: string): Copy {
  const known = accessRefusalCodeOf(code);
  return known === undefined
    ? { id: "settings-access-unknown", args: { code } }
    : accessRefusalLabel(known);
}

/** Any answer but `Ok`, as one or two words or the plane's own line. */
export function accessFailureLabel(failure: ApiFailure): Copy {
  switch (failure.outcome) {
    case "Unauthenticated":
      return { id: "settings-access-signed-out" };
    case "Absent":
      return { id: "settings-access-absent" };
    case "Conflict":
    case "Rejected":
    case "Retryable":
      return accessCodeLabel(failure.code);
    case "Fault":
      return { id: "settings-access-failed" };
    case "Unreachable":
      return { id: "settings-access-unreachable" };
    case "Unreadable":
      return { id: "settings-access-unreadable" };
  }
}

/** One role held or not, on the workspace or on one of its projects, or
 * hosted runs or personal runners held or not. */
export type TenantPersonChange =
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
    }
  | { readonly scope: "HostedRuns"; readonly held: boolean }
  | { readonly scope: "PersonalRunners"; readonly held: boolean }
  | { readonly scope: "UnscopedChat"; readonly held: boolean };

/** Two removals are asked first: the reader's own workspace admin, after which
 * the list is no longer theirs to read, and hosted runs from a subject that is
 * no account, which may be the identity that starts the workspace's runs. */
export function tenantPersonChangeAsks(
  person: AccessTenantPerson,
  change: TenantPersonChange,
): boolean {
  if (!change.held) return false;
  if (change.scope === "HostedRuns") return person.account === false;
  return person.mine && change.scope === "Tenant" && change.role === "Admin";
}

/** What a change asked first is named for, and the line it is asked with. */
export interface TenantPersonQuestion {
  readonly question: Copy;
  readonly line: Copy;
}

export function tenantPersonQuestion(
  change: TenantPersonChange,
): TenantPersonQuestion {
  return change.scope === "HostedRuns"
    ? {
        question: { id: "settings-person-hosted-runs-question" },
        line: { id: "settings-person-hosted-runs-line" },
      }
    : {
        question: { id: "settings-person-admin-question" },
        line: { id: "settings-person-admin-line" },
      };
}

/** Whether the reader may give and take hosted runs, which a reader whose
 * abilities were not read may not. */
export function tenantHostedRunsOffered(
  abilities: AccessTenantAbilities | undefined,
): boolean {
  return abilities?.grantHostedRuns ?? false;
}

/** Whether the reader may give and take personal runners, which a reader
 * whose abilities were not read may not. */
export function tenantPersonalRunnersOffered(
  abilities: AccessTenantAbilities | undefined,
): boolean {
  return abilities?.grantPersonalRunners ?? false;
}

/** Whether the reader may give and take unscoped chat, which a reader whose
 * abilities were not read may not. */
export function tenantUnscopedChatOffered(
  abilities: AccessTenantAbilities | undefined,
): boolean {
  return abilities?.grantUnscopedChat ?? false;
}

/** Whether the reader may take a member's own runners off, which only an
 * administrator of the workspace may, and a reader whose abilities were not
 * read may not. */
export function tenantRunnerRemovalOffered(
  abilities: AccessTenantAbilities | undefined,
): boolean {
  return abilities?.administerTenant ?? false;
}

/** What a person holds in a workspace, or an invite link carries into one. */
export type TenantHeld = Pick<
  AccessTenantPerson,
  "tenantRoles" | "hostedRuns" | "personalRunners" | "projects"
>;

/** The roles held on one of the workspace's projects. */
export function tenantPersonProjectRoles(
  held: Pick<TenantHeld, "projects">,
  project: string,
): readonly AccessProjectRole[] {
  return held.projects.find((named) => named.project === project)?.roles ?? [];
}

/** Whether the reader may grant and remove one workspace role. */
export function tenantRoleOffered(
  abilities: AccessTenantAbilities | undefined,
  role: AccessTenantRole,
): boolean {
  return abilities?.roles.includes(role) ?? false;
}

/** Whether the reader may grant and remove one role on one project, which an
 * answer cut short before naming it does not say. */
export function projectRoleOffered(
  abilities: AccessTenantAbilities | undefined,
  project: string,
  role: AccessProjectRole,
): boolean {
  const named = abilities?.projects.find((held) => held.project === project);
  return named?.roles.includes(role) ?? false;
}

/** A project is a row of a person's editor where they hold a role there or
 * the reader may grant one there. */
export function tenantPersonProjectDrawn(
  abilities: AccessTenantAbilities | undefined,
  person: AccessTenantPerson,
  project: string,
): boolean {
  return (
    tenantPersonProjectRoles(person, project).length > 0 ||
    accessProjectRoles.some((role) =>
      projectRoleOffered(abilities, project, role),
    )
  );
}

/** What hosted runs are called wherever a person holds them or may be given them. */
export const tenantHostedRunsLabel: Copy = { id: "settings-role-hosted-runs" };

/** What personal runners are called wherever a person holds them or may be given them. */
export const tenantPersonalRunnersLabel: Copy = {
  id: "settings-role-personal-runners",
};

/** What unscoped chat is called wherever a person may be given it. */
export const tenantUnscopedChatLabel: Copy = {
  id: "settings-role-unscoped-chat",
};

/** The list's people, and apart from them its subjects the plane says are no
 * account, each in the list's order. */
export interface TenantPeopleParted {
  readonly people: readonly AccessTenantPerson[];
  readonly identities: readonly AccessTenantPerson[];
}

export function tenantPeopleParted(
  listed: readonly AccessTenantPerson[],
): TenantPeopleParted {
  return {
    people: listed.filter((person) => person.account !== false),
    identities: listed.filter((person) => person.account === false),
  };
}

/** How many people the table under this line holds. */
export function tenantPeopleCountLine(count: number): Copy {
  return { id: "settings-people-count", args: { count } };
}

/** What is held in the workspace, as the words a row draws: each role in the
 * roster's order, then hosted runs, then personal runners. */
export function tenantHeldWords(held: TenantHeld): readonly Copy[] {
  return [
    ...accessTenantRoles
      .filter((role) => held.tenantRoles.includes(role))
      .map(tenantRoleLabel),
    ...(held.hostedRuns ? [tenantHostedRunsLabel] : []),
    ...(held.personalRunners ? [tenantPersonalRunnersLabel] : []),
  ];
}

/** What a row says where every project of the workspace is administered. */
export const tenantHeldEveryProjectLine: Copy = {
  id: "settings-people-every-project",
};

/** Whether every project of the workspace is administered with no role
 * there, which `.chug/tasks/keto/namespaces.ts` gives a workspace admin
 * through each project's tenant. */
export function tenantHeldEveryProject(held: TenantHeld): boolean {
  return held.tenantRoles.includes("Admin");
}

/** One project a role is held on, as a row's line: the project, then its
 * roles in the roster's order. */
export interface TenantHeldProjectLine {
  readonly project: string;
  readonly roles: readonly Copy[];
}

/** A line for each of `projects` a role is held on, in their order. */
export function tenantHeldProjectLines(
  held: TenantHeld,
  projects: readonly string[],
): readonly TenantHeldProjectLine[] {
  return projects
    .map((project) => {
      const roles = tenantPersonProjectRoles(held, project);
      return {
        project,
        roles: accessProjectRoles
          .filter((role) => roles.includes(role))
          .map(projectRoleLabel),
      };
    })
    .filter((line) => line.roles.length > 0);
}

/** Whether the reader may change anything a person holds, which is whether a
 * row offers their editor. */
export function tenantPersonEditOffered(
  abilities: AccessTenantAbilities | undefined,
  projects: readonly string[],
): boolean {
  return (
    tenantHostedRunsOffered(abilities) ||
    tenantPersonalRunnersOffered(abilities) ||
    tenantUnscopedChatOffered(abilities) ||
    tenantRunnerRemovalOffered(abilities) ||
    accessTenantRoles.some((role) => tenantRoleOffered(abilities, role)) ||
    projects.some((project) =>
      accessProjectRoles.some((role) =>
        projectRoleOffered(abilities, project, role),
      ),
    )
  );
}

/** One box of a person's editor: the change a press on it asks for, `held` in
 * it being what the list holds now, and whether the reader may make it. */
export interface TenantPersonBox {
  readonly label: Copy;
  readonly change: TenantPersonChange;
  readonly offered: boolean;
}

function tenantPersonBoxDrawn(box: TenantPersonBox): boolean {
  return box.offered || box.change.held;
}

/** The workspace's boxes in a person's editor: each role, then hosted runs,
 * then personal runners, one the reader may not change drawn only where it is
 * held, then unscoped chat, drawn only where the reader may change it, since
 * every member holds it until it is taken. */
export function tenantPersonWorkspaceBoxes(
  abilities: AccessTenantAbilities | undefined,
  person: AccessTenantPerson,
): readonly TenantPersonBox[] {
  const roles = accessTenantRoles.map((role): TenantPersonBox => ({
    label: tenantRoleLabel(role),
    change: {
      scope: "Tenant",
      role,
      held: person.tenantRoles.includes(role),
    },
    offered: tenantRoleOffered(abilities, role),
  }));
  const hostedRuns: TenantPersonBox = {
    label: tenantHostedRunsLabel,
    change: { scope: "HostedRuns", held: person.hostedRuns },
    offered: tenantHostedRunsOffered(abilities),
  };
  const personalRunners: TenantPersonBox = {
    label: tenantPersonalRunnersLabel,
    change: { scope: "PersonalRunners", held: person.personalRunners },
    offered: tenantPersonalRunnersOffered(abilities),
  };
  const unscopedChat: TenantPersonBox = {
    label: tenantUnscopedChatLabel,
    change: { scope: "UnscopedChat", held: person.unscopedChat },
    offered: tenantUnscopedChatOffered(abilities),
  };
  return [
    ...[...roles, hostedRuns, personalRunners].filter(tenantPersonBoxDrawn),
    ...(unscopedChat.offered ? [unscopedChat] : []),
  ];
}

/** One project's box for one role in a person's editor, absent where the
 * reader may not change it and the person does not hold it. */
export function tenantPersonProjectBox(
  abilities: AccessTenantAbilities | undefined,
  person: AccessTenantPerson,
  project: string,
  role: AccessProjectRole,
): TenantPersonBox | undefined {
  const box: TenantPersonBox = {
    label: projectRoleLabel(role),
    change: {
      scope: "Project",
      project,
      role,
      held: tenantPersonProjectRoles(person, project).includes(role),
    },
    offered: projectRoleOffered(abilities, project, role),
  };
  return tenantPersonBoxDrawn(box) ? box : undefined;
}

function tenantPersonChangeNamed(change: TenantPersonChange): string {
  switch (change.scope) {
    case "HostedRuns":
    case "PersonalRunners":
    case "UnscopedChat":
      return change.scope;
    case "Tenant":
      return `${change.scope} ${change.role}`;
    case "Project":
      return `${change.scope} ${change.project} ${change.role}`;
  }
}

/** Whether a box is drawn checked: as the list holds it, or as the change
 * being sent will leave it, whether or not the list has been read again. */
export function tenantPersonBoxChecked(
  box: TenantPersonBox,
  sending: TenantPersonChange | undefined,
): boolean {
  if (
    sending !== undefined &&
    tenantPersonChangeNamed(sending) === tenantPersonChangeNamed(box.change)
  )
    return !sending.held;
  return box.change.held;
}

/** The workspace roles an invitation offers, in the roster's order. */
export function tenantInvitationRoles(
  abilities: AccessTenantAbilities | undefined,
): readonly AccessTenantRole[] {
  return accessTenantRoles.filter((role) => tenantRoleOffered(abilities, role));
}

/** The workspace role an invitation opens on, where it offers any. */
export function tenantInvitationRoleOpening(
  abilities: AccessTenantAbilities | undefined,
): AccessTenantRole | undefined {
  const offered = tenantInvitationRoles(abilities);
  return offered.includes("Member") ? "Member" : offered[0];
}

export function tenantInvitationOffered(
  abilities: AccessTenantAbilities | undefined,
): boolean {
  return tenantInvitationRoleOpening(abilities) !== undefined;
}

/** The list's projects an invitation offers, each with the roles it offers
 * there, a project with none left out. */
export function tenantInvitationProjects(
  abilities: AccessTenantAbilities | undefined,
  projects: readonly string[],
): readonly {
  readonly project: string;
  readonly roles: readonly AccessProjectRole[];
}[] {
  return projects
    .map((project) => ({
      project,
      roles: accessProjectRoles.filter((role) =>
        projectRoleOffered(abilities, project, role),
      ),
    }))
    .filter((offered) => offered.roles.length > 0);
}

/** The line an invitation draws under the GitHub field, where it draws one:
 * for a reader whose abilities, a workspace's or the site's, make no account. */
export function tenantInvitationAccountLine(
  abilities: { readonly createAccount: boolean } | undefined,
): Copy | undefined {
  return abilities === undefined || abilities.createAccount
    ? undefined
    : tenantInvitationAccountsLine;
}

/** A subject and what the directory says of it, which is all a person is named from. */
export type TenantSubject = Omit<AccessAuthorityPerson, "mine">;

/** Who one person is, in a People row, holding a permission or beside an
 * invite link: an account by its email, or the subject itself, marked where the plane says it is no account. */
export interface TenantPersonName {
  readonly name: string;
  readonly subject: boolean;
  readonly githubLogin: string | undefined;
  readonly noAccount: boolean;
}

export function tenantPersonName(person: TenantSubject): TenantPersonName {
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
): Copy | undefined {
  return otherIssuers === 0
    ? undefined
    : { id: "settings-people-other-issuers", args: { count: otherIssuers } };
}

/** What an invitation grants as a dialog holds it, every project's roles kept
 * even where none is chosen. */
export interface TenantInvitationGrantsForm {
  readonly role: AccessTenantRole;
  readonly projects: readonly {
    readonly project: string;
    readonly roles: readonly AccessProjectRole[];
  }[];
}

/** An invitation of one person as the dialog holds it: who they are, and what
 * it grants them. */
export interface TenantInvitationForm extends TenantInvitationGrantsForm {
  readonly github: string;
  readonly email: string;
}

/** An invitation as each opening of the dialog starts it: nothing typed, the
 * role it opens on, and every project it offers with no role chosen. */
export function tenantInvitationBlank(
  role: AccessTenantRole,
  offered: readonly { readonly project: string }[],
): TenantInvitationForm {
  return {
    github: "",
    email: "",
    role,
    projects: offered.map((held) => ({ project: held.project, roles: [] })),
  };
}

export function tenantInvitationGithubFault(github: string): Copy | undefined {
  if (github === "") return undefined;
  return accessGithubLoginSchema.safeParse(github).success
    ? undefined
    : { id: "settings-invitation-github-fault" };
}

export function tenantInvitationEmailFault(email: string): Copy | undefined {
  if (email === "") return undefined;
  return accessEmailSchema.safeParse(email).success
    ? undefined
    : { id: "settings-invitation-email-fault" };
}

function tenantInvitationProjectsChosen(
  form: TenantInvitationGrantsForm,
): AccessInvitationGrants["projects"] {
  return form.projects
    .filter((chosen) => chosen.roles.length > 0)
    .map((chosen) => ({ project: chosen.project, roles: [...chosen.roles] }));
}

export function tenantInvitationProjectsFault(
  form: TenantInvitationGrantsForm,
): Copy | undefined {
  const projects = tenantInvitationProjectsChosen(form);
  if (accessInvitationGrantsSchema.shape.projects.safeParse(projects).success)
    return undefined;
  return (projects?.length ?? 0) > accessInvitationProjectsMax
    ? {
        id: "settings-invitation-projects-most",
        args: { count: accessInvitationProjectsMax },
      }
    : { id: "settings-invitation-projects-once" };
}

/** What an invitation grants as the plane is sent it, projects named only
 * where one is chosen, and nothing else the form holds. */
export function tenantInvitationGrantsBody(
  form: TenantInvitationGrantsForm,
): AccessInvitationGrants {
  const projects = tenantInvitationProjectsChosen(form) ?? [];
  return {
    role: form.role,
    ...(projects.length === 0 ? {} : { projects }),
  };
}

/** What the plane is sent to invite a person. */
export function tenantInvitationBody(
  form: TenantInvitationForm,
): AccessInvitation {
  return {
    github: form.github,
    email: form.email,
    ...tenantInvitationGrantsBody(form),
  };
}

export function tenantInvitationSendable(form: TenantInvitationForm): boolean {
  return accessInvitationSchema.safeParse(tenantInvitationBody(form)).success;
}

/** One project role chosen or let go in the dialog. */
export function tenantInvitationProjectToggled<
  Form extends TenantInvitationGrantsForm,
>(form: Form, project: string, role: AccessProjectRole): Form {
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

/** Whether the dialog holds one project role chosen. */
export function tenantInvitationRoleChosen(
  form: TenantInvitationGrantsForm,
  project: string,
  role: AccessProjectRole,
): boolean {
  return (
    form.projects
      .find((chosen) => chosen.project === project)
      ?.roles.includes(role) ?? false
  );
}

/** Whether an invitation or an invite link the plane did not take leaves the
 * list to be read again: an absent answer is a plane that invites nobody or a
 * reader no longer an admin, and reading the list again tells the two apart. */
export function tenantInvitationRefusalRereads(failure: ApiFailure): boolean {
  return failure.outcome === "Absent";
}
