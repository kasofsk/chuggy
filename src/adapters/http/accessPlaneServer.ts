/**
 * The access plane's server: a tenant's and a project's people, granting and
 * removing their roles, and inviting a person by their GitHub account, each
 * for a caller the authority says holds the kind it needs.
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
  accessInvitationCodes,
  accessInvitationProjectsMax,
  accessInvitationSchema,
  accessLastTenantAdministratorCode,
  accessNotPermittedCode,
  accessPlaneRoutes,
  accessProjectRoleGrantSchema,
  accessProjectRoleSchema,
  accessSubjectSchema,
  accessTenantRoleGrantSchema,
  accessTenantRoleSchema,
  type AccessInvited,
  type AccessPlaneRouteName,
} from "../../contract/accessPlane.ts";
import {
  identitySchema,
  nativeHttpError,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
} from "../../contract/http.ts";
import { AccessDirectoryUnavailable } from "../../interpreter/accessDirectory.ts";
import type {
  AccessInvitationResult,
  AccessInvitations,
} from "../../interpreter/accessInvitation.ts";
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
  readonly ready: () => Promise<boolean>;
}

/** The most any route reads but an invitation: a grant names one role and no text of its own. */
export const accessPlaneBodyBytesMax = planeJsonObjectBytesMax();

/** The most an invitation reads: a username, an email, and the most projects it names, each with its roles. */
export const accessInvitationBodyBytesMax =
  planeJsonObjectBytesMax(accessGithubLoginCharsMax, accessEmailCharsMax) +
  accessInvitationProjectsMax *
    planeJsonObjectBytesMax(nativeHttpPathSegmentCharsMax);

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

/** A refusal the same request may be sent again after. */
function accessRetry(reply: FastifyReply, code: string): FastifyReply {
  void reply.header("retry-after", String(authorityRetryAfterSeconds));
  return accessRefused(reply, 503, code, "The request can be retried.");
}

/** The person invited, created by this request or found. */
function accessInvitedSent(
  reply: FastifyReply,
  invited: AccessInvited,
): FastifyReply {
  const body: AccessInvited = {
    subject: invited.subject,
    created: invited.created,
  };
  return reply
    .code(invited.created ? 201 : 200)
    .type(nativeHttpMediaType)
    .send(body);
}

function accessInvited(
  reply: FastifyReply,
  result: AccessInvitationResult,
): FastifyReply {
  const codes = accessInvitationCodes;
  switch (result.invited) {
    case "Invited":
      return accessInvitedSent(reply, result);
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
    case "ProjectUnknown":
      return accessRefused(
        reply,
        422,
        codes.ProjectUnknown,
        "A project named is not the tenant's.",
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
  accessInvitationRoute(app, service);
  return app;
}
