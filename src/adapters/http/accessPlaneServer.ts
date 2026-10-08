/**
 * The access plane's server: a tenant's and a project's people, and granting
 * and removing their roles, for a caller the authority says administers them.
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
  accessLastTenantAdministratorCode,
  accessPlaneRoutes,
  accessProjectRoleGrantSchema,
  accessProjectRoleSchema,
  accessSubjectSchema,
  accessTenantRoleGrantSchema,
  accessTenantRoleSchema,
  type AccessPlaneRouteName,
} from "../../contract/accessPlane.ts";
import {
  identitySchema,
  nativeHttpError,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
} from "../../contract/http.ts";
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
import { failureResponse, notFound } from "./outcomes.ts";
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
  readonly ready: () => Promise<boolean>;
}

/** The most any route reads: a grant names one role and no text of its own. */
export const accessPlaneBodyBytesMax = planeJsonObjectBytesMax();

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
): void {
  const route = accessPlaneRoutes[name];
  planeRouteServed(
    app,
    {
      method: route.method,
      url: route.path,
      bodyBytesMax: accessPlaneBodyBytesMax,
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
    case "LastTenantAdministrator":
      return reply
        .code(409)
        .type(nativeHttpMediaType)
        .send(
          nativeHttpError(
            accessLastTenantAdministratorCode,
            "A tenant keeps at least one administrator.",
          ),
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
    nativeHttpSend(reply, failureResponse(failure));
  });
  app.setNotFoundHandler((_request, reply) => {
    nativeHttpSend(reply, notFound());
  });
  planeHealthRoutes(app, service.ready);
  accessTenantRoutes(app, service);
  accessProjectRoutes(app, service);
  return app;
}
