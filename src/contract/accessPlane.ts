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

import { identitySchema } from "./http.ts";

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
