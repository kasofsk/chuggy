/**
 * The access plane's wire: its routes, the roles a request may name, and what
 * a list answers.
 *
 * IT IS NOT THE PUBLIC API'S CONTRACT. The plane is a process of its own under
 * `accessPlaneBasePath`, so none of this is in `nativeHttpRoutes` or the
 * contract document. It shares that API's media type and error envelope,
 * because the console reads both with the same code.
 *
 * A ROLE IS A CLOSED ROSTER, one for a tenant and one for a project. What
 * relation each names is the interpreter's, in one exhaustive record, so no
 * string a request carries reaches a relation without passing through it.
 *
 * AN AUTHORITY AND A GROUP ARE CLOSED ROSTERS TOO. An authority is a relation
 * saying who may grant a role or manage who may, one roster a level, and a
 * group is the holders of one role named relative to where a list is asked.
 * Each reaches its relation or subject set through one record in the
 * interpreter, which is also what names a holder read back and what a holder
 * added is written as. A person and a group are different paths, so a subject
 * is never read as a group's name.
 *
 * WHAT A CALLER MAY DO IS ANSWERED ABOUT THEM ALONE, at the site, a tenant or
 * a project: each ability is whether they hold the kind it needs there, so a
 * console offers the controls the plane would not refuse.
 *
 * A PERSON IS NAMED BY SUBJECT, the one their token carries. The plane derives
 * the principal from it under its own issuer, and how long a subject may be
 * depends on that issuer, so the schema here bounds it only by the path.
 */

import { z } from "zod";

import { identitySchema, textCodePointsCount } from "./http.ts";

export const accessPlaneBasePath = "/access/v1";

/** The roles a request may grant or remove on a tenant. */
export const accessTenantRoles = ["Admin", "Member"] as const;
export type AccessTenantRole = (typeof accessTenantRoles)[number];

/** The roles a request may grant or remove on a project. */
export const accessProjectRoles = ["Admin", "Developer", "Dispatcher"] as const;
export type AccessProjectRole = (typeof accessProjectRoles)[number];

/** The authorities a site's list answers. */
export const accessSiteAuthorities = [
  "AccountCreators",
  "TenantCreators",
  "AuthorityManagers",
] as const;
export type AccessSiteAuthority = (typeof accessSiteAuthorities)[number];

/** The authorities a tenant's list answers. */
export const accessTenantAuthorities = [
  "AdminGranters",
  "MemberGranters",
  "HostedRunsGranters",
  "AuthorityManagers",
] as const;
export type AccessTenantAuthority = (typeof accessTenantAuthorities)[number];

/** The authorities a project's list answers. */
export const accessProjectAuthorities = [
  "AdminGranters",
  "DeveloperGranters",
  "DispatcherGranters",
  "AuthorityManagers",
] as const;
export type AccessProjectAuthority = (typeof accessProjectAuthorities)[number];

/** The groups a project's list names, every level's being some of them. */
export const accessProjectGroups = [
  "SiteAdmins",
  "TenantAdmins",
  "TenantMembers",
  "ProjectAdmins",
  "ProjectDevelopers",
] as const;
export type AccessGroup = (typeof accessProjectGroups)[number];

/** The groups a tenant's list names, of that tenant and of the site. */
export const accessTenantGroups = [
  "SiteAdmins",
  "TenantAdmins",
  "TenantMembers",
] as const satisfies readonly AccessGroup[];

export type AccessTenantGroup = (typeof accessTenantGroups)[number];

/** The groups the site's list names. */
export const accessSiteGroups = [
  "SiteAdmins",
] as const satisfies readonly AccessGroup[];
export type AccessSiteGroup = (typeof accessSiteGroups)[number];

/** What each of the site's authorities admits. */
export const accessSiteAuthorityAdmits: Readonly<
  Record<
    AccessSiteAuthority,
    {
      readonly groups: readonly AccessSiteGroup[];
      readonly tenants: boolean;
    }
  >
> = {
  AccountCreators: { groups: ["SiteAdmins"], tenants: true },
  TenantCreators: { groups: ["SiteAdmins"], tenants: false },
  AuthorityManagers: { groups: [], tenants: false },
};

/** The groups each of a tenant's authorities admits. */
export const accessTenantAuthorityAdmits: Readonly<
  Record<AccessTenantAuthority, readonly AccessTenantGroup[]>
> = {
  AdminGranters: ["TenantAdmins", "SiteAdmins"],
  MemberGranters: ["TenantAdmins", "SiteAdmins", "TenantMembers"],
  HostedRunsGranters: ["TenantAdmins", "SiteAdmins"],
  AuthorityManagers: ["TenantAdmins"],
};

/** The groups each of a project's authorities admits. */
export const accessProjectAuthorityAdmits: Readonly<
  Record<AccessProjectAuthority, readonly AccessGroup[]>
> = {
  AdminGranters: ["ProjectAdmins", "TenantAdmins", "SiteAdmins"],
  DeveloperGranters: [
    "ProjectAdmins",
    "TenantAdmins",
    "SiteAdmins",
    "ProjectDevelopers",
  ],
  DispatcherGranters: ["ProjectAdmins", "TenantAdmins", "SiteAdmins"],
  AuthorityManagers: ["ProjectAdmins", "TenantAdmins"],
};

/** One route as the plane registers it, its segments named as `:name`. */
export interface AccessPlaneRoute {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
}

const accessTenantPath = `${accessPlaneBasePath}/tenants/:tenant`;
const accessProjectPath = `${accessTenantPath}/projects/:project`;
const accessSitePath = `${accessPlaneBasePath}/site`;

/** One person as a holder of one of the level's authorities, `level` its path. */
const accessHolderPersonPath = (level: string) =>
  `${level}/authorities/:authority/people/:subject`;

/** One group as a holder of one of the level's authorities. */
const accessHolderGroupPath = (level: string) =>
  `${level}/authorities/:authority/groups/:group`;

/** The site's account creators held by one tenant's administrators. */
const accessSiteTenantHolderPath = `${accessSitePath}/authorities/AccountCreators/tenants/:tenant`;

export const accessPlaneRoutes = {
  tenantPeople: { method: "GET", path: `${accessTenantPath}/people` },
  tenantRoleGrant: {
    method: "POST",
    path: `${accessTenantPath}/people/:subject/roles`,
  },
  tenantRoleRemoval: {
    method: "DELETE",
    path: `${accessTenantPath}/people/:subject/roles/:role`,
  },
  tenantHostedRunsGrant: {
    method: "POST",
    path: `${accessTenantPath}/people/:subject/hosted-runs`,
  },
  tenantHostedRunsRemoval: {
    method: "DELETE",
    path: `${accessTenantPath}/people/:subject/hosted-runs`,
  },
  tenantInvitation: {
    method: "POST",
    path: `${accessTenantPath}/invitations`,
  },
  tenantAbilities: { method: "GET", path: `${accessTenantPath}/abilities` },
  projectPeople: { method: "GET", path: `${accessProjectPath}/people` },
  projectRoleGrant: {
    method: "POST",
    path: `${accessProjectPath}/people/:subject/roles`,
  },
  projectRoleRemoval: {
    method: "DELETE",
    path: `${accessProjectPath}/people/:subject/roles/:role`,
  },
  projectAbilities: { method: "GET", path: `${accessProjectPath}/abilities` },
  siteAbilities: {
    method: "GET",
    path: `${accessPlaneBasePath}/site/abilities`,
  },
  tenantAuthorities: { method: "GET", path: `${accessTenantPath}/authorities` },
  projectAuthorities: {
    method: "GET",
    path: `${accessProjectPath}/authorities`,
  },
  siteAuthorities: {
    method: "GET",
    path: `${accessPlaneBasePath}/site/authorities`,
  },
  siteAuthorityPersonAddition: {
    method: "POST",
    path: accessHolderPersonPath(accessSitePath),
  },
  siteAuthorityPersonRemoval: {
    method: "DELETE",
    path: accessHolderPersonPath(accessSitePath),
  },
  siteAuthorityGroupAddition: {
    method: "POST",
    path: accessHolderGroupPath(accessSitePath),
  },
  siteAuthorityGroupRemoval: {
    method: "DELETE",
    path: accessHolderGroupPath(accessSitePath),
  },
  siteAuthorityTenantAddition: {
    method: "POST",
    path: accessSiteTenantHolderPath,
  },
  siteAuthorityTenantRemoval: {
    method: "DELETE",
    path: accessSiteTenantHolderPath,
  },
  tenantAuthorityPersonAddition: {
    method: "POST",
    path: accessHolderPersonPath(accessTenantPath),
  },
  tenantAuthorityPersonRemoval: {
    method: "DELETE",
    path: accessHolderPersonPath(accessTenantPath),
  },
  tenantAuthorityGroupAddition: {
    method: "POST",
    path: accessHolderGroupPath(accessTenantPath),
  },
  tenantAuthorityGroupRemoval: {
    method: "DELETE",
    path: accessHolderGroupPath(accessTenantPath),
  },
  projectAuthorityPersonAddition: {
    method: "POST",
    path: accessHolderPersonPath(accessProjectPath),
  },
  projectAuthorityPersonRemoval: {
    method: "DELETE",
    path: accessHolderPersonPath(accessProjectPath),
  },
  projectAuthorityGroupAddition: {
    method: "POST",
    path: accessHolderGroupPath(accessProjectPath),
  },
  projectAuthorityGroupRemoval: {
    method: "DELETE",
    path: accessHolderGroupPath(accessProjectPath),
  },
} as const satisfies Readonly<Record<string, AccessPlaneRoute>>;

export type AccessPlaneRouteName = keyof typeof accessPlaneRoutes;

/** The path one route is asked at, every segment encoded whole so a subject holding a `/` stays one segment. */
export function accessPlanePath(
  route: AccessPlaneRouteName,
  segments: Readonly<Record<string, string>>,
): string {
  return accessPlaneRoutes[route].path.replace(
    /:([a-z]+)/gu,
    (_whole, name: string) => {
      const value = segments[name];
      if (value === undefined)
        throw new RangeError(`access plane: ${name} is not named`);
      return encodeURIComponent(value);
    },
  );
}

/** A subject as a path names it. */
export const accessSubjectSchema = identitySchema;

export const accessTenantRoleSchema = z.enum(accessTenantRoles);
export const accessProjectRoleSchema = z.enum(accessProjectRoles);

export const accessSiteAuthoritySchema = z.enum(accessSiteAuthorities);
export const accessTenantAuthoritySchema = z.enum(accessTenantAuthorities);
export const accessProjectAuthoritySchema = z.enum(accessProjectAuthorities);

/** A group as a path names it at any level, so one the level does not name is refused as a holder rather than as a request. */
export const accessGroupSchema = z.enum(accessProjectGroups);

/** What a tenant role grant is sent. */
export const accessTenantRoleGrantSchema = z.strictObject({
  role: accessTenantRoleSchema,
});

/** What a project role grant is sent. */
export const accessProjectRoleGrantSchema = z.strictObject({
  role: accessProjectRoleSchema,
});

/** The conflict a removal is refused with when it would leave a tenant no administrator. */
export const accessLastTenantAdministratorCode = "LastTenantAdministrator";

/** The refusal of a change or an invitation to a caller answered the list who may not grant a role it names, or hosted runs, or manage the authority it names. */
export const accessNotPermittedCode = "AccessNotPermitted";

/** The conflict a holder is refused with where the authority does not admit it, or where a removal names a group the level's list cannot. */
export const accessHolderNotAdmittedCode = "AccessHolderNotAdmitted";

/** The longest username GitHub admits. */
export const accessGithubLoginCharsMax = 39;

/**
 * A GitHub username: letters, digits, hyphens and underscores, beginning and
 * ending with a letter or a digit.
 */
export const accessGithubLoginSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/u)
  .refine(
    (login) => textCodePointsCount(login) <= accessGithubLoginCharsMax,
    `a GitHub username is at most ${String(accessGithubLoginCharsMax)} characters`,
  );

/** The longest email the directory's schema holds. */
export const accessEmailCharsMax = 320;

/** An email in an address's shape, within the directory's bound. */
export const accessEmailSchema = z
  .email()
  .refine(
    (email) => textCodePointsCount(email) <= accessEmailCharsMax,
    `an email is at most ${String(accessEmailCharsMax)} characters`,
  );

/** The most projects one invitation names. */
export const accessInvitationProjectsMax = 16;

/** The roles an invitation grants on one of the tenant's projects. */
export const accessInvitationProjectSchema = z.strictObject({
  project: identitySchema,
  roles: z.array(accessProjectRoleSchema).min(1).max(accessProjectRoles.length),
});

/**
 * What an invitation is sent: the person's GitHub username and email, the
 * tenant role, and roles on projects of the tenant, each project named once.
 */
export const accessInvitationSchema = z.strictObject({
  github: accessGithubLoginSchema,
  email: accessEmailSchema,
  role: accessTenantRoleSchema,
  projects: z
    .array(accessInvitationProjectSchema)
    .max(accessInvitationProjectsMax)
    .refine(
      (projects) =>
        new Set(projects.map((named) => named.project)).size ===
        projects.length,
      "each project is named once",
    )
    .optional(),
});

/** What an invitation answers: the invited subject, and whether this request created its account. */
export const accessInvitedSchema = z.strictObject({
  subject: z.string().min(1),
  created: z.boolean(),
});

/** The code each refusal of an invitation is answered with. */
export const accessInvitationCodes = {
  NotConfigured: "InvitationNotConfigured",
  ProjectUnknown: "InvitationProjectUnknown",
  AccountNotPermitted: "InvitationAccountNotPermitted",
  GithubAccountUnknown: "GithubAccountUnknown",
  GithubAccountNotUser: "GithubAccountNotUser",
  EmailHeld: "InvitationEmailHeld",
  EmailRefused: "InvitationEmailRefused",
  GithubUnavailable: "GithubUnavailable",
  DirectoryRaced: "DirectoryRaced",
  DirectoryUnavailable: "DirectoryUnavailable",
} as const;

/**
 * Who a subject is, where the plane has a directory to ask: whether it is an
 * account, its email, and the GitHub login its account records. All three are
 * absent from a plane with no directory and from a subject past the bound one
 * answer asks about.
 */
const accessAccountFields = {
  account: z.boolean().optional(),
  email: accessEmailSchema.optional(),
  githubLogin: accessGithubLoginSchema.optional(),
};

/** The roles one person holds on one of the tenant's projects. */
export const accessProjectRolesHeldSchema = z.strictObject({
  project: identitySchema,
  roles: z.array(accessProjectRoleSchema),
});

/**
 * One person in a tenant. `hostedRuns` is whether the tenant grants them
 * hosted runs, which the plane's own route gives and takes, and `mine` is the
 * server's answer to whether this is the caller.
 */
export const accessTenantPersonSchema = z.strictObject({
  subject: z.string().min(1),
  mine: z.boolean(),
  tenantRoles: z.array(accessTenantRoleSchema),
  hostedRuns: z.boolean(),
  projects: z.array(accessProjectRolesHeldSchema),
  ...accessAccountFields,
});

/**
 * What a tenant's people list answers. `otherIssuers` counts the principals
 * derived under an issuer other than the plane's, which it does not name.
 */
export const accessTenantPeopleSchema = z.strictObject({
  tenant: identitySchema,
  projects: z.array(identitySchema),
  people: z.array(accessTenantPersonSchema),
  otherIssuers: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

/** One person in a project, where `tenantAdmin` is a tenant's administrator reaching it through the tenant. */
export const accessProjectPersonSchema = z.strictObject({
  subject: z.string().min(1),
  mine: z.boolean(),
  tenantAdmin: z.boolean(),
  roles: z.array(accessProjectRoleSchema),
  ...accessAccountFields,
});

/** What a project's people list answers. */
export const accessProjectPeopleSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
  people: z.array(accessProjectPersonSchema),
  otherIssuers: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

/** What the caller may do on one project: the roles they may grant and remove there, and whether they may change who holds its authorities. */
export const accessProjectAbilitiesHeldSchema = z.strictObject({
  project: identitySchema,
  roles: z.array(accessProjectRoleSchema),
  manageAuthorities: z.boolean(),
});

/**
 * What the caller may do in a tenant: the tenant roles they may grant and
 * remove, whether they may give hosted runs, make an account, change who holds
 * the tenant's authorities and the ones the site holds over it, and what they
 * may do on each of the tenant's projects the answer names.
 */
export const accessTenantAbilitiesSchema = z.strictObject({
  tenant: identitySchema,
  roles: z.array(accessTenantRoleSchema),
  grantHostedRuns: z.boolean(),
  createAccount: z.boolean(),
  manageAuthorities: z.boolean(),
  manageSiteHeldAuthorities: z.boolean(),
  projects: z.array(accessProjectAbilitiesHeldSchema),
  truncated: z.boolean(),
});

/** What the caller may do in one project. */
export const accessProjectAbilitiesSchema = z.strictObject({
  tenant: identitySchema,
  ...accessProjectAbilitiesHeldSchema.shape,
});

/** What the caller may do on the site: administer it, make an account, make a tenant, and change who holds its authorities. */
export const accessSiteAbilitiesSchema = z.strictObject({
  administer: z.boolean(),
  createAccount: z.boolean(),
  createTenant: z.boolean(),
  manageAuthorities: z.boolean(),
});

/** One person holding an authority, `mine` the server's answer to whether this is the caller. */
export const accessAuthorityPersonSchema = z.strictObject({
  subject: z.string().min(1),
  mine: z.boolean(),
  ...accessAccountFields,
});

/**
 * Who holds one authority: each person, each group, and how many holders no
 * roster names, a principal under another issuer among them.
 */
function accessAuthorityHeldShape<
  const Authority extends readonly [string, ...string[]],
  const Group extends readonly [string, ...string[]],
>(authorities: Authority, groups: Group) {
  return {
    authority: z.enum(authorities),
    people: z.array(accessAuthorityPersonSchema),
    groups: z.array(z.enum(groups)),
    unnamed: z.number().int().nonnegative(),
  };
}

/** Who holds one of the site's authorities, `tenants` naming each tenant whose administrators hold it. */
export const accessSiteAuthorityHeldSchema = z.strictObject({
  ...accessAuthorityHeldShape(accessSiteAuthorities, accessSiteGroups),
  tenants: z.array(identitySchema),
});

export const accessTenantAuthorityHeldSchema = z.strictObject(
  accessAuthorityHeldShape(accessTenantAuthorities, accessTenantGroups),
);

export const accessProjectAuthorityHeldSchema = z.strictObject(
  accessAuthorityHeldShape(accessProjectAuthorities, accessProjectGroups),
);

/** What the site's authority list answers: every authority in roster order. */
export const accessSiteAuthoritiesSchema = z.strictObject({
  authorities: z.array(accessSiteAuthorityHeldSchema),
  truncated: z.boolean(),
});

/** What a tenant's authority list answers. */
export const accessTenantAuthoritiesSchema = z.strictObject({
  tenant: identitySchema,
  authorities: z.array(accessTenantAuthorityHeldSchema),
  truncated: z.boolean(),
});

/** What a project's authority list answers. */
export const accessProjectAuthoritiesSchema = z.strictObject({
  tenant: identitySchema,
  project: identitySchema,
  authorities: z.array(accessProjectAuthorityHeldSchema),
  truncated: z.boolean(),
});

export type AccessTenantPerson = z.infer<typeof accessTenantPersonSchema>;
export type AccessTenantPeople = z.infer<typeof accessTenantPeopleSchema>;
export type AccessProjectPerson = z.infer<typeof accessProjectPersonSchema>;
export type AccessProjectPeople = z.infer<typeof accessProjectPeopleSchema>;
export type AccessInvitation = z.infer<typeof accessInvitationSchema>;
export type AccessInvited = z.infer<typeof accessInvitedSchema>;
export type AccessProjectAbilitiesHeld = z.infer<
  typeof accessProjectAbilitiesHeldSchema
>;
export type AccessTenantAbilities = z.infer<typeof accessTenantAbilitiesSchema>;
export type AccessProjectAbilities = z.infer<
  typeof accessProjectAbilitiesSchema
>;
export type AccessSiteAbilities = z.infer<typeof accessSiteAbilitiesSchema>;
export type AccessAuthorityPerson = z.infer<typeof accessAuthorityPersonSchema>;
export type AccessSiteAuthorities = z.infer<typeof accessSiteAuthoritiesSchema>;
export type AccessTenantAuthorities = z.infer<
  typeof accessTenantAuthoritiesSchema
>;
export type AccessProjectAuthorities = z.infer<
  typeof accessProjectAuthoritiesSchema
>;
