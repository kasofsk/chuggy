/**
 * The document `GET /api/v1/contract` answers with: the wire's own description
 * of itself, generated from the checked request schemas rather than written
 * beside them.
 */

import { z } from "zod";

import {
  nativeHttpBasePath,
  nativeHttpMediaType,
  nativeHttpRoutes,
  nativeHttpVersion,
} from "./http.ts";
import {
  configurationCreationSchema,
  draftCreationSchema,
  draftRevisionSchema,
  publicMutationSchema,
  repositoryConfigurationImportSchema,
} from "./requests.ts";

export function nativeHttpContractDocument(): unknown {
  return {
    version: nativeHttpVersion,
    basePath: nativeHttpBasePath,
    mediaType: nativeHttpMediaType,
    authentication: {
      scheme: "Bearer",
      format: "OIDC JWT",
      principal: "length-prefixed issuer and subject",
    },
    notifications: "bounded-polling",
    events: "sse",
    caching: "no-store",
    cors: "same-origin",
    credentials: "authorization bearer header; no cookies",
    ticketPhaseFilter: {
      query: "phase",
      all: "omit phase",
      nonTerminal: "phase=NonTerminal",
      selected: "repeat phase with one or more exact phase names",
    },
    identities: {
      installation: "canonical UUID authority identity",
      tenant: "percent-encoded opaque UTF-8 path segment",
      project: "percent-encoded opaque UTF-8 path segment",
      ticket: "canonical positive decimal integer",
      operation: "percent-encoded opaque UTF-8 path segment",
      cursor: "opaque canonical base64url",
    },
    routes: nativeHttpRoutes,
    schemas: {
      publicMutation: z.toJSONSchema(publicMutationSchema),
      configurationCreation: z.toJSONSchema(configurationCreationSchema),
      repositoryConfigurationImport: z.toJSONSchema(
        repositoryConfigurationImportSchema,
      ),
      draftCreation: z.toJSONSchema(draftCreationSchema),
      draftRevision: z.toJSONSchema(draftRevisionSchema),
    },
  };
}
