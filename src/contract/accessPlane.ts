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

/** One route as the plane registers it, its segments named as `:name`. */
export interface AccessPlaneRoute {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
}

const accessTenantPath = `${accessPlaneBasePath}/tenants/:tenant`;
const accessProjectPath = `${accessTenantPath}/projects/:project`;

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
  tenantInvitation: {
    method: "POST",
    path: `${accessTenantPath}/invitations`,
  },
  projectPeople: { method: "GET", path: `${accessProjectPath}/people` },
  projectRoleGrant: {
    method: "POST",
    path: `${accessProjectPath}/people/:subject/roles`,
  },
  projectRoleRemoval: {
    method: "DELETE",
    path: `${accessProjectPath}/people/:subject/roles/:role`,
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
 * One person in a tenant. `hostedRuns` is read and never granted here, and
 * `mine` is the server's answer to whether this is the caller.
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

export type AccessTenantPerson = z.infer<typeof accessTenantPersonSchema>;
export type AccessTenantPeople = z.infer<typeof accessTenantPeopleSchema>;
export type AccessProjectPerson = z.infer<typeof accessProjectPersonSchema>;
export type AccessProjectPeople = z.infer<typeof accessProjectPeopleSchema>;
export type AccessInvitation = z.infer<typeof accessInvitationSchema>;
export type AccessInvited = z.infer<typeof accessInvitedSchema>;
