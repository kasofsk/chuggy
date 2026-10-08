/**
 * The access plane's server: a tenant's and a project's people, granting and
 * removing their roles, giving and taking a person's hosted runs, inviting a
 * person by their GitHub account into a tenant or into one of their own, and what the caller may do, who holds each
 * authority and adding and removing its holders at the site, a tenant or a
 * project, each for a caller the authority says holds the kind it needs.
 *
 * IT ANSWERS AS THE PUBLIC API DOES, because the console reads both with the
 * same code. A body is read as the API's media type, every refusal carries the
 * API's envelope, and what a handler throws is mapped by `failureResponse`, so
 * an authority that could not answer is a wait and a malformed request is a
 * rejection rather than either being a fault.
 *
 * IT SERVES NO WORKER CONTRACT, so no route checks a release and no answer is
 * stamped with one.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  accessEmailCharsMax,
  accessGithubLoginCharsMax,
  accessGroupSchema,
  accessHolderNotAdmittedCode,
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessInvitationSchema,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessOwnerInvitationSchema,
  accessPlaneRoutes,
  accessProjectAuthoritySchema,
  accessProjectRoleGrantSchema,
  accessProjectRoleSchema,
  accessSiteAuthoritySchema,
  accessSubjectSchema,
  accessTenantAuthoritySchema,
  accessTenantRoleGrantSchema,
  accessTenantRoleSchema,
  accessTenantTakenCode,
  type AccessInvited,
  type AccessOwnerInvited,
  type AccessPlaneRouteName,
} from "../../contract/accessPlane.ts";
import { projectNameCharsMax } from "../../contract/requests.ts";
import {
  identitySchema,
  nativeHttpError,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
} from "../../contract/http.ts";
import type { AccessAbilities } from "../../interpreter/accessAbilities.ts";
import type { AccessAuthorities } from "../../interpreter/accessAuthorities.ts";
import type {
  AccessAuthorityHolders,
  AccessHeld,
  AccessHolder,
  AccessHolderChange,
} from "../../interpreter/accessAuthorityHolders.ts";
import { AccessDirectoryUnavailable } from "../../interpreter/accessDirectory.ts";
import type {
  AccessInvitationRefusal,
  AccessInvitationResult,
  AccessInvitations,
} from "../../interpreter/accessInvitation.ts";
import type { AccessOwnerInvitations } from "../../interpreter/accessOwnerInvitation.ts";
import type {
  AccessChange,
  AccessPlane,
} from "../../interpreter/accessPlane.ts";
import type { Principal } from "../../interpreter/principal.ts";
import {
  asTenantId,
  type Partition,
  type TenantId,
} from "../../interpreter/projectStore.ts";
import { parsePartition } from "./contract.ts";
import {
  authorityRetryAfterSeconds,
  failureResponse,
  notFound,
} from "./outcomes.ts";
import {
  planeApp,
  planeHealthRoutes,
  planeJsonObjectBytesMax,
  planeRouteServed,
} from "./planeRoutes.ts";
import {
  nativeHttpBearerAuthenticated,
  nativeHttpMediaTypeServed,
  nativeHttpSend,
  type PrincipalAuthentication,
} from "./server.ts";

export interface AccessPlaneService {
  readonly authentication: PrincipalAuthentication;
  readonly plane: AccessPlane;
  readonly invitations: AccessInvitations;
  readonly ownerInvitations: AccessOwnerInvitations;
  readonly abilities: AccessAbilities;
  readonly authorities: AccessAuthorities;
  readonly holders: AccessAuthorityHolders;
  readonly ready: () => Promise<boolean>;
}

/** The most any route reads but an invitation: a grant names one role and no text of its own. */
export const accessPlaneBodyBytesMax = planeJsonObjectBytesMax();

/** The most an invitation reads: a username, an email, and the most projects it names, each with its roles. */
export const accessInvitationBodyBytesMax =
  planeJsonObjectBytesMax(accessGithubLoginCharsMax, accessEmailCharsMax) +
  accessInvitationProjectsMax *
    planeJsonObjectBytesMax(nativeHttpPathSegmentCharsMax);

/** The most a site's invitation reads: a tenant's name, a username and an email. */
export const accessOwnerInvitationBodyBytesMax = planeJsonObjectBytesMax(
  projectNameCharsMax,
  accessGithubLoginCharsMax,
  accessEmailCharsMax,
);

/** Serves `handler` at one route for the principal its bearer names, every other caller refused before any of its body is read. */
function accessPlaneRoute(
  app: FastifyInstance,
  service: AccessPlaneService,
  name: AccessPlaneRouteName,
  handler: (
    request: FastifyRequest,
    reply: FastifyReply,
    caller: Principal,
  ) => Promise<unknown>,
  bodyBytesMax = accessPlaneBodyBytesMax,
): void {
  const route = accessPlaneRoutes[name];
  planeRouteServed(
    app,
    {
      method: route.method,
      url: route.path,
      bodyBytesMax,
    },
    async (request, reply) => {
      const bearer = await nativeHttpBearerAuthenticated(
        service.authentication,
        request,
        reply,
      );
      return bearer === undefined ? undefined : { principal: bearer.principal };
    },
    (request, reply, caller) => handler(request, reply, caller.principal),
  );
}

function accessParams(request: FastifyRequest): Record<string, unknown> {
  return request.params as Record<string, unknown>;
}

function accessTenantOf(request: FastifyRequest): TenantId {
  return asTenantId(identitySchema.parse(accessParams(request)["tenant"]));
}

function accessPartitionOf(request: FastifyRequest): Partition {
  const params = accessParams(request);
  return parsePartition(
    identitySchema.parse(params["tenant"]),
    identitySchema.parse(params["project"]),
  );
}

function accessSubjectOf(request: FastifyRequest): string {
  return accessSubjectSchema.parse(accessParams(request)["subject"]);
}

/** A list, or absent for a caller the authority refused. */
function accessListed(reply: FastifyReply, listed: unknown): FastifyReply {
  if (listed === undefined) {
    nativeHttpSend(reply, notFound());
    return reply;
  }
  return reply.code(200).type(nativeHttpMediaType).send(listed);
}

/** A refusal in the API's envelope, its message the plane's own and never a remote's. */
function accessRefused(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply
    .code(status)
    .type(nativeHttpMediaType)
    .send(nativeHttpError(code, message));
}

/** The refusal of a change to a caller answered the list, under `code`. */
function accessNotPermitted(reply: FastifyReply, code: string): FastifyReply {
  return accessRefused(reply, 403, code, "The caller may not do this.");
}

function accessChanged(
  reply: FastifyReply,
  change: AccessChange,
): FastifyReply {
  switch (change) {
    case "Absent":
      nativeHttpSend(reply, notFound());
      return reply;
    case "Changed":
      return reply.code(204).send();
    case "Refused":
      return accessNotPermitted(reply, accessNotPermittedCode);
    case "LastTenantAdministrator":
      return accessRefused(
        reply,
        409,
        accessLastTenantAdministratorCode,
        "A tenant keeps at least one administrator.",
      );
  }
}

function accessTenantRoutes(
  app: FastifyInstance,
  service: AccessPlaneService,
): void {
  accessPlaneRoute(
    app,
    service,
    "tenantPeople",
    async (request, reply, caller) =>
      accessListed(
        reply,
        await service.plane.tenantPeople(caller, accessTenantOf(request)),
      ),
  );
  accessPlaneRoute(
    app,
    service,
    "tenantRoleGrant",
    async (request, reply, caller) =>
      accessChanged(
        reply,
        await service.plane.tenantRoleGranted(
          caller,
          accessTenantOf(request),
          accessSubjectOf(request),
          accessTenantRoleGrantSchema.parse(request.body).role,
        ),
      ),
  );
  accessPlaneRoute(
    app,
    service,
    "tenantRoleRemoval",
    async (request, reply, caller) =>
      accessChanged(
        reply,
        await service.plane.tenantRoleRemoved(
          caller,
          accessTenantOf(request),
          accessSubjectOf(request),
          accessTenantRoleSchema.parse(accessParams(request)["role"]),
        ),
      ),
  );
}

function accessHostedRunsRoutes(
  app: FastifyInstance,
  service: AccessPlaneService,
): void {
  accessPlaneRoute(
    app,
    service,
    "tenantHostedRunsGrant",
    async (request, reply, caller) =>
      accessChanged(
        reply,
        await service.plane.tenantHostedRunsGiven(
          caller,
          accessTenantOf(request),
          accessSubjectOf(request),
        ),
      ),
  );
  accessPlaneRoute(
    app,
    service,
    "tenantHostedRunsRemoval",
    async (request, reply, caller) =>
      accessChanged(
        reply,
        await service.plane.tenantHostedRunsTaken(
          caller,
          accessTenantOf(request),
          accessSubjectOf(request),
        ),
      ),
  );
}

/** What the caller may do and who holds each authority at each level, absent to a caller the authority does not answer. */
function accessAnsweredRoutes(
  app: FastifyInstance,
  service: AccessPlaneService,
): void {
  const answered: readonly (readonly [
    AccessPlaneRouteName,
    (request: FastifyRequest, caller: Principal) => Promise<unknown>,
  ])[] = [
    [
      "tenantAbilities",
      (request, caller) =>
        service.abilities.tenantAbilities(caller, accessTenantOf(request)),
    ],
    [
      "projectAbilities",
      (request, caller) =>
        service.abilities.projectAbilities(caller, accessPartitionOf(request)),
    ],
    [
      "siteAbilities",
      (_request, caller) => service.abilities.siteAbilities(caller),
    ],
    [
      "tenantAuthorities",
      (request, caller) =>
        service.authorities.tenantAuthorities(caller, accessTenantOf(request)),
    ],
    [
      "projectAuthorities",
      (request, caller) =>
        service.authorities.projectAuthorities(
          caller,
          accessPartitionOf(request),
        ),
    ],
    [
      "siteAuthorities",
      (_request, caller) => service.authorities.siteAuthorities(caller),
    ],
  ];
  for (const [name, abilities] of answered)
    accessPlaneRoute(app, service, name, async (request, reply, caller) =>
      accessListed(reply, await abilities(request, caller)),
    );
}

function accessHolderChanged(
  reply: FastifyReply,
  change: AccessHolderChange,
): FastifyReply {
  return change === "NotAdmitted"
    ? accessRefused(
        reply,
        409,
        accessHolderNotAdmittedCode,
        "The authority does not admit that holder.",
      )
    : accessChanged(reply, change);
}

/** One authority at the level a path names, held by `holder`. */
type AccessHeldOf = (
  request: FastifyRequest,
  holder: AccessHolder,
) => AccessHeld;

const accessHeldAt: Readonly<
  Record<"site" | "creators" | "tenant" | "project", AccessHeldOf>
> = {
  site: (request, holder) => ({
    level: "Site",
    authority: accessSiteAuthoritySchema.parse(
      accessParams(request)["authority"],
    ),
    holder,
  }),
  creators: (_request, holder) => ({
    level: "Site",
    authority: "AccountCreators",
    holder,
  }),
  tenant: (request, holder) => ({
    level: "Tenant",
    tenant: accessTenantOf(request),
    authority: accessTenantAuthoritySchema.parse(
      accessParams(request)["authority"],
    ),
    holder,
  }),
  project: (request, holder) => ({
    level: "Project",
    partition: accessPartitionOf(request),
    authority: accessProjectAuthoritySchema.parse(
      accessParams(request)["authority"],
    ),
    holder,
  }),
};

/** The holder a path names. */
const accessHolderOf: Readonly<
  Record<
    "person" | "group" | "tenant",
    (request: FastifyRequest) => AccessHolder
  >
> = {
  person: (request) => ({
    holder: "Person",
    subject: accessSubjectOf(request),
  }),
  group: (request) => ({
    holder: "Group",
    group: accessGroupSchema.parse(accessParams(request)["group"]),
  }),
  tenant: (request) => ({ holder: "Tenant", tenant: accessTenantOf(request) }),
};

/** Each route adding or removing a holder, the level its path names and the holder. */
const accessHolderRouteTable: readonly (readonly [
  AccessPlaneRouteName,
  keyof typeof accessHeldAt,
  keyof typeof accessHolderOf,
])[] = [
  ["siteAuthorityPersonAddition", "site", "person"],
  ["siteAuthorityPersonRemoval", "site", "person"],
  ["siteAuthorityGroupAddition", "site", "group"],
  ["siteAuthorityGroupRemoval", "site", "group"],
  ["siteAuthorityTenantAddition", "creators", "tenant"],
  ["siteAuthorityTenantRemoval", "creators", "tenant"],
  ["tenantAuthorityPersonAddition", "tenant", "person"],
  ["tenantAuthorityPersonRemoval", "tenant", "person"],
  ["tenantAuthorityGroupAddition", "tenant", "group"],
  ["tenantAuthorityGroupRemoval", "tenant", "group"],
  ["projectAuthorityPersonAddition", "project", "person"],
  ["projectAuthorityPersonRemoval", "project", "person"],
  ["projectAuthorityGroupAddition", "project", "group"],
  ["projectAuthorityGroupRemoval", "project", "group"],
];

function accessHolderRoutes(
  app: FastifyInstance,
  service: AccessPlaneService,
): void {
  for (const [name, level, holder] of accessHolderRouteTable) {
    const verb =
      accessPlaneRoutes[name].method === "POST"
        ? "holderAdded"
        : "holderRemoved";
    accessPlaneRoute(app, service, name, async (request, reply, caller) =>
      accessHolderChanged(
        reply,
        await service.holders[verb](
          caller,
          accessHeldAt[level](request, accessHolderOf[holder](request)),
        ),
      ),
    );
  }
}

/** A refusal the same request may be sent again after. */
function accessRetry(reply: FastifyReply, code: string): FastifyReply {
  void reply.header("retry-after", String(authorityRetryAfterSeconds));
  return accessRefused(reply, 503, code, "The request can be retried.");
}

/** The person invited, created by this request or found. */
function accessInvitedSent(
  reply: FastifyReply,
  body: AccessInvited | AccessOwnerInvited,
): FastifyReply {
  return reply
    .code(body.created ? 201 : 200)
    .type(nativeHttpMediaType)
    .send(body);
}

/** A refusal every invitation answers alike. */
function accessInvitationRefused(
  reply: FastifyReply,
  result: AccessInvitationRefusal,
): FastifyReply {
  const codes = accessInvitationCodes;
  switch (result.invited) {
    case "Absent":
      nativeHttpSend(reply, notFound());
      return reply;
    case "NotConfigured":
      return accessRefused(
        reply,
        404,
        codes.NotConfigured,
        "This deployment invites nobody.",
      );
    case "Refused":
      return accessNotPermitted(reply, accessNotPermittedCode);
    case "AccountNotPermitted":
      return accessNotPermitted(reply, codes.AccountNotPermitted);
    case "GithubAccountUnknown":
      return accessRefused(
        reply,
        422,
        codes.GithubAccountUnknown,
        "GitHub has no account of that name.",
      );
    case "GithubAccountNotUser":
      return accessRefused(
        reply,
        422,
        codes.GithubAccountNotUser,
        "The GitHub account is not a person's.",
      );
    case "EmailHeld":
      return accessRefused(
        reply,
        409,
        codes.EmailHeld,
        "Another account holds the email.",
      );
    case "EmailRefused":
      return accessRefused(
        reply,
        422,
        codes.EmailRefused,
        "The directory does not hold that email.",
      );
    case "GithubUnavailable":
      return accessRetry(reply, codes.GithubUnavailable);
    case "DirectoryRaced":
      return accessRetry(reply, codes.DirectoryRaced);
  }
}

function accessInvited(
  reply: FastifyReply,
  result: AccessInvitationResult,
): FastifyReply {
  if (result.invited === "Invited")
    return accessInvitedSent(reply, {
      subject: result.subject,
      created: result.created,
    });
  if (result.invited === "ProjectUnknown")
    return accessRefused(
      reply,
      422,
      accessInvitationCodes.ProjectUnknown,
      "A project named is not the tenant's.",
    );
  return accessInvitationRefused(reply, result);
}

function accessInvitationRoute(
  app: FastifyInstance,
  service: AccessPlaneService,
): void {
  accessPlaneRoute(
    app,
    service,
    "tenantInvitation",
    async (request, reply, caller) =>
      accessInvited(
        reply,
        await service.invitations.invite(
          caller,
          accessTenantOf(request),
          accessInvitationSchema.parse(request.body),
        ),
      ),
    accessInvitationBodyBytesMax,
  );
  accessPlaneRoute(
    app,
    service,
    "siteOwnerInvitation",
    async (request, reply, caller) => {
      const invitation = accessOwnerInvitationSchema.parse(request.body);
      const result = await service.ownerInvitations.invite(caller, invitation);
      if (result.invited === "Invited")
        return accessInvitedSent(reply, {
          tenant: invitation.tenant,
          subject: result.subject,
          created: result.created,
        });
      if (result.invited === "TenantTaken")
        return accessRefused(
          reply,
          409,
          accessTenantTakenCode,
          "Something already holds the tenant.",
        );
      return accessInvitationRefused(reply, result);
    },
    accessOwnerInvitationBodyBytesMax,
  );
}

function accessProjectRoutes(
  app: FastifyInstance,
  service: AccessPlaneService,
): void {
  accessPlaneRoute(
    app,
    service,
    "projectPeople",
    async (request, reply, caller) =>
      accessListed(
        reply,
        await service.plane.projectPeople(caller, accessPartitionOf(request)),
      ),
  );
  accessPlaneRoute(
    app,
    service,
    "projectRoleGrant",
    async (request, reply, caller) =>
      accessChanged(
        reply,
        await service.plane.projectRoleGranted(
          caller,
          accessPartitionOf(request),
          accessSubjectOf(request),
          accessProjectRoleGrantSchema.parse(request.body).role,
        ),
      ),
  );
  accessPlaneRoute(
    app,
    service,
    "projectRoleRemoval",
    async (request, reply, caller) =>
      accessChanged(
        reply,
        await service.plane.projectRoleRemoved(
          caller,
          accessPartitionOf(request),
          accessSubjectOf(request),
          accessProjectRoleSchema.parse(accessParams(request)["role"]),
        ),
      ),
  );
}

export function createAccessPlaneApp(
  service: AccessPlaneService,
): FastifyInstance {
  const app = planeApp({ pathSegmentCharsMax: nativeHttpPathSegmentCharsMax });
  nativeHttpMediaTypeServed(app);
  app.setErrorHandler((failure, _request, reply) => {
    if (failure instanceof AccessDirectoryUnavailable)
      accessRetry(reply, accessInvitationCodes.DirectoryUnavailable);
    else nativeHttpSend(reply, failureResponse(failure));
  });
  app.setNotFoundHandler((_request, reply) => {
    nativeHttpSend(reply, notFound());
  });
  planeHealthRoutes(app, service.ready);
  accessTenantRoutes(app, service);
  accessProjectRoutes(app, service);
  accessHostedRunsRoutes(app, service);
  accessInvitationRoute(app, service);
  accessAnsweredRoutes(app, service);
  accessHolderRoutes(app, service);
  return app;
}
