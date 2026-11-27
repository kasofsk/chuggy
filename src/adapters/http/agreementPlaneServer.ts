/**
 * The agreement plane's two servers: its callers', which answers the current
 * policies to anyone and a signed-in caller's standing and agreement about
 * them alone, and its service listener's, which answers one named person's
 * standing to whoever can reach it.
 *
 * IT ANSWERS ITS CALLERS AS THE PUBLIC API DOES, because the console reads
 * both with the same code: the API's media type and envelope, and what a
 * handler throws mapped by `failureResponse`.
 *
 * THE SERVICE LISTENER TAKES NO BEARER, so reach is its whole control, and it
 * serves the person's standing and nothing else. The callers' server does not
 * serve that path, and answers it as it answers any path it does not serve.
 *
 * THE CLIENT ADDRESS IS THE SOCKET'S PEER unless the deployment named one
 * header to take it from. No other header is read for it, and a value that is
 * not one IP address records none rather than refusing the agreement.
 */

import { isIP } from "node:net";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  agreementDigestChars,
  agreementPlaneRoutes,
  agreementPoliciesChangedCode,
  agreementPoliciesMax,
  agreementPolicyCharsMax,
  agreementPrincipalSchema,
  agreementPrincipalSegmentCharsMax,
  agreementRequestSchema,
  agreementUserAgentCharsMax,
  agreementVersionCharsMax,
} from "../../contract/agreementPlane.ts";
import {
  nativeHttpError,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
} from "../../contract/http.ts";
import type {
  AgreementEvidence,
  AgreementPlane,
} from "../../interpreter/agreementPlane.ts";
import type { Principal } from "../../interpreter/principal.ts";
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

export interface AgreementPlaneService {
  readonly authentication: PrincipalAuthentication;
  readonly plane: AgreementPlane;
  /** The one header the client address is taken from, lower-cased, or none to take the socket's peer. */
  readonly clientAddressHeader: string | undefined;
  readonly ready: () => Promise<boolean>;
}

/** What a route reading no body is sent. */
const agreementPlaneBodyBytesMax = planeJsonObjectBytesMax();

/** The most an agreement reads: the most policies, each a slug, a version and a digest. */
export const agreementPlaneAgreementsBodyBytesMax =
  planeJsonObjectBytesMax() +
  agreementPoliciesMax *
    planeJsonObjectBytesMax(
      agreementPolicyCharsMax,
      agreementVersionCharsMax,
      agreementDigestChars,
    );

/** The address the deployment trusts for the request, or none where it is not one IP address. */
function agreementPlaneClientAddress(
  request: FastifyRequest,
  header: string | undefined,
): string | undefined {
  const value =
    header === undefined
      ? request.socket.remoteAddress
      : request.headers[header];
  if (typeof value !== "string") return undefined;
  const address = value.trim();
  return isIP(address) === 0 || address.includes("%") ? undefined : address;
}

/** The request's user agent, cut to the bound a row keeps. */
function agreementPlaneUserAgent(request: FastifyRequest): string | undefined {
  const value = request.headers["user-agent"];
  if (value === undefined || value.length === 0) return undefined;
  return Array.from(value).slice(0, agreementUserAgentCharsMax).join("");
}

function agreementPlaneEvidence(
  request: FastifyRequest,
  service: AgreementPlaneService,
): AgreementEvidence {
  return {
    clientAddress: agreementPlaneClientAddress(
      request,
      service.clientAddressHeader,
    ),
    userAgent: agreementPlaneUserAgent(request),
  };
}

function agreementPlaneAnswered(
  reply: FastifyReply,
  answer: unknown,
): FastifyReply {
  if (answer === undefined) {
    nativeHttpSend(reply, notFound());
    return reply;
  }
  return reply.code(200).type(nativeHttpMediaType).send(answer);
}

/** Serves `handler` at one route for the principal its bearer names, every other caller refused before any of its body is read. */
function agreementPlaneSignedIn(
  app: FastifyInstance,
  service: AgreementPlaneService,
  route: { readonly method: "GET" | "POST"; readonly path: string },
  bodyBytesMax: number,
  handler: (
    request: FastifyRequest,
    reply: FastifyReply,
    caller: Principal,
  ) => Promise<unknown>,
): void {
  planeRouteServed(
    app,
    { method: route.method, url: route.path, bodyBytesMax },
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

function agreementPlaneCallerRoutes(
  app: FastifyInstance,
  service: AgreementPlaneService,
): void {
  const policies = agreementPlaneRoutes.policies;
  planeRouteServed(
    app,
    {
      method: policies.method,
      url: policies.path,
      bodyBytesMax: agreementPlaneBodyBytesMax,
    },
    () => Promise.resolve({}),
    (_request, reply) =>
      Promise.resolve(agreementPlaneAnswered(reply, service.plane.policies())),
  );
  agreementPlaneSignedIn(
    app,
    service,
    agreementPlaneRoutes.standing,
    agreementPlaneBodyBytesMax,
    async (_request, reply, caller) =>
      agreementPlaneAnswered(reply, await service.plane.standing(caller)),
  );
  agreementPlaneSignedIn(
    app,
    service,
    agreementPlaneRoutes.agreements,
    agreementPlaneAgreementsBodyBytesMax,
    async (request, reply, caller) => {
      const agreed = await service.plane.agreed(
        caller,
        agreementRequestSchema.parse(request.body),
        agreementPlaneEvidence(request, service),
      );
      switch (agreed.outcome) {
        case "Absent":
          return agreementPlaneAnswered(reply, undefined);
        case "PoliciesChanged":
          return reply
            .code(409)
            .type(nativeHttpMediaType)
            .send({
              ...nativeHttpError(
                agreementPoliciesChangedCode,
                "The policies have changed since they were shown.",
              ),
              policies: agreed.current.policies,
            });
        case "Agreed":
          return agreementPlaneAnswered(reply, agreed.standing);
      }
    },
  );
}

/** The refusals every server of the plane answers: what a handler throws, and a path it does not serve. */
function agreementPlaneRefusals(app: FastifyInstance): void {
  app.setErrorHandler((failure, _request, reply) => {
    nativeHttpSend(reply, failureResponse(failure));
  });
  app.setNotFoundHandler((_request, reply) => {
    nativeHttpSend(reply, notFound());
  });
}

/** The callers' server, on the plane's first listener. */
export function createAgreementPlaneApp(
  service: AgreementPlaneService,
): FastifyInstance {
  const app = planeApp({ pathSegmentCharsMax: nativeHttpPathSegmentCharsMax });
  nativeHttpMediaTypeServed(app);
  agreementPlaneRefusals(app);
  planeHealthRoutes(app, service.ready);
  agreementPlaneCallerRoutes(app, service);
  return app;
}

/** The service listener's server, answering one named person's standing to a caller holding no bearer. */
export function createAgreementPlaneServiceApp(
  plane: AgreementPlane,
): FastifyInstance {
  const app = planeApp({
    pathSegmentCharsMax: agreementPrincipalSegmentCharsMax,
  });
  nativeHttpMediaTypeServed(app);
  agreementPlaneRefusals(app);
  const route = agreementPlaneRoutes.personStanding;
  planeRouteServed(
    app,
    {
      method: route.method,
      url: route.path,
      bodyBytesMax: agreementPlaneBodyBytesMax,
    },
    () => Promise.resolve({}),
    async (request, reply) => {
      const principal = agreementPrincipalSchema.parse(
        (request.params as Record<string, unknown>)["principal"],
      );
      return agreementPlaneAnswered(
        reply,
        await plane.personStanding(principal),
      );
    },
  );
  return app;
}
